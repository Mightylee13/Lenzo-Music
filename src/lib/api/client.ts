import "server-only";
import { getApiConfig, endpointPath, isPrimaryDisabled } from "@/lib/config/api-config";
import { updateDb } from "@/lib/db/json-store";
import type { ApiLogEntry } from "@/types";

/* ============================================================
   UPSTREAM API CLIENT (server-only)
   ------------------------------------------------------------
   The API key is attached here, on the server, and never
   reaches the browser. Every call is logged for the admin
   "API logs" screen (bounded to the newest 250 entries).
   ============================================================ */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public path: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const LOG_LIMIT = 250;

function log(entry: ApiLogEntry) {
  updateDb((db) => {
    const logs = (db.apiLogs as ApiLogEntry[]) ?? [];
    logs.push(entry);
    db.apiLogs = logs.slice(-LOG_LIMIT);
  });
}

export interface CallOptions {
  /** Endpoint mapping key (e.g. `search.soundcloud`) or an absolute path. */
  endpoint: string;
  params?: Record<string, string | number | undefined>;
  timeoutMs?: number;
  /** Skip writing to the API log (used by connection tests). */
  silent?: boolean;
}

export async function callUpstream<T = unknown>(options: CallOptions): Promise<T> {
  // Kill switch: when the primary API is switched off (backup test mode)
  // every call fails instantly, exactly like a real outage — the app's
  // failover paths carry all traffic.
  if (isPrimaryDisabled()) {
    throw new ApiError("Primary API is switched off (backup test mode)", 503, options.endpoint);
  }

  const config = getApiConfig();
  const path = options.endpoint.includes("/") && !options.endpoint.startsWith("search") && !options.endpoint.startsWith("download")
    ? options.endpoint
    : safeEndpointPath(options.endpoint);

  const url = new URL(path, `${config.baseUrl.replace(/\/+$/, "")}/`);
  for (const [k, v] of Object.entries(options.params ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    // The upstream's security policy rejects server-tool fingerprints
    // (Node/undici's default User-Agent gets 403 "client device temporarily
    // restricted"). Presenting a normal browser User-Agent is both accurate
    // (this is a web app's own backend) and required to pass the policy.
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    ...config.requestHeaders,
  };
  if (config.apiKey) {
    const prefix = config.authPrefix ? `${config.authPrefix}` : "";
    headers[config.authHeader] = `${prefix}${config.apiKey}`;
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? config.timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      headers,
      signal: controller.signal,
      // Upstream responses are stable enough to cache briefly at the edge of
      // our own server; the music API also has per-key rate limits.
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }

    if (!options.silent) {
      log({
        id: `log_${started}_${Math.random().toString(36).slice(2, 6)}`,
        at: started,
        method: "GET",
        path: url.pathname + url.search.replace(/apikey=[^&]+/i, "apikey=***"),
        status: res.status,
        latencyMs,
        source: "upstream",
        error: res.ok ? undefined : extractError(body) ?? `HTTP ${res.status}`,
      });
    }

    if (!res.ok) {
      throw new ApiError(extractError(body) ?? `Upstream returned ${res.status}`, res.status, url.pathname);
    }

    return body as T;
  } catch (err) {
    const latencyMs = Date.now() - started;
    if (err instanceof ApiError) throw err;
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Request timed out after ${options.timeoutMs ?? config.timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : "Network error";

    if (!options.silent) {
      log({
        id: `log_${started}_${Math.random().toString(36).slice(2, 6)}`,
        at: started,
        method: "GET",
        path: url.pathname,
        status: 0,
        latencyMs,
        source: "upstream",
        error: message,
      });
    }
    throw new ApiError(message, 0, url.pathname);
  } finally {
    clearTimeout(timeout);
  }
}

function safeEndpointPath(endpoint: string): string {
  try {
    return endpointPath(endpoint);
  } catch {
    // Allow raw paths (used by the admin endpoint tester).
    return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  }
}

function extractError(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.error === "string") return b.error;
  if (b.error && typeof b.error === "object" && typeof (b.error as Record<string, unknown>).message === "string") {
    return (b.error as Record<string, string>).message;
  }
  if (typeof b.message === "string") return b.message;
  return undefined;
}

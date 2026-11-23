/* ============================================================
   BROWSER FETCH HELPER
   JSON in, JSON out, typed errors with server messages intact.
   ============================================================ */

export class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "HttpError";
  }
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(body?.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export async function apiSend<T>(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  payload?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(body?.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return "–:––";
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** "12.3K" style counts. */
export function formatCount(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late listening";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

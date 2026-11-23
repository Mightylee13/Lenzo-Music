import { NextResponse } from "next/server";

/* ============================================================
   AUDIO STREAM PROXY
   Some converter CDNs (e.g. the ytmp3 host) serve MP3s WITHOUT
   Range support (plain HTTP 200). An <audio> element cannot seek
   cleanly in such a stream — dragging forward snaps playback
   back toward the start. This proxy adds real range support:
   it forwards Range to range-capable upstreams, and manually
   slices the byte stream for those that ignore the header.
   ============================================================ */

/** Hosts the resolver may produce — no open relay. */
const ALLOWED_HOSTS = ["api.theresav.eu", "spotidown.app", "googlevideo.com", "soundcloud.cloud", "sndcdn.com"];

function hostAllowed(hostname: string): boolean {
  return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

/** Skip `start` bytes, then emit at most `length` bytes (when finite). */
function sliceStream(
  body: ReadableStream<Uint8Array>,
  start: number,
  length: number | undefined,
): ReadableStream<Uint8Array> {
  let skipped = 0;
  let sent = 0;
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (length !== undefined && sent >= length) {
        controller.terminate();
        return;
      }
      let piece = chunk;
      if (skipped < start) {
        const need = start - skipped;
        if (piece.length <= need) {
          skipped += piece.length;
          return;
        }
        piece = piece.subarray(need);
        skipped = start;
      }
      if (length !== undefined && piece.length > length - sent) {
        piece = piece.subarray(0, length - sent);
      }
      sent += piece.length;
      controller.enqueue(piece);
      if (length !== undefined && sent >= length) controller.terminate();
    },
  });
  return body.pipeThrough(transform);
}

export async function GET(request: Request) {
  const rawTarget = new URL(request.url).searchParams.get("url");
  let parsed: URL | null = null;
  if (rawTarget) {
    try {
      parsed = new URL(rawTarget);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || parsed.protocol !== "https:" || !hostAllowed(parsed.hostname)) {
    return NextResponse.json({ error: "A valid allow-listed audio url is required" }, { status: 403 });
  }

  const rangeHeader = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      headers: rangeHeader ? { Range: rangeHeader } : undefined,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Upstream audio unavailable" }, { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206 || !upstream.body) {
    return NextResponse.json({ error: "Upstream audio unavailable" }, { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  });

  const upstreamHonoursRange = upstream.status === 206 && upstream.headers.has("content-range");

  if (rangeHeader && upstreamHonoursRange) {
    // Pass the upstream's range answer straight through.
    headers.set("Content-Range", upstream.headers.get("content-range") as string);
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    return new Response(upstream.body, { status: 206, headers });
  }

  if (rangeHeader) {
    // Upstream ignored Range (returned 200 full body) — slice it ourselves.
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : undefined;

    const total = upstream.headers.get("content-length");
    const lastByte = end !== undefined ? end : total ? parseInt(total, 10) - 1 : undefined;
    const length = lastByte !== undefined ? lastByte - start + 1 : undefined;

    if (total) headers.set("Content-Range", `bytes ${start}-${lastByte ?? "*"}/${total}`);
    else headers.set("Content-Range", `bytes ${start}-${lastByte ?? "*"}/*`);
    if (lastByte !== undefined) headers.set("Content-Length", String(length));

    return new Response(sliceStream(upstream.body, start, length), { status: 206, headers });
  }

  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  return new Response(upstream.body, { status: 200, headers });
}

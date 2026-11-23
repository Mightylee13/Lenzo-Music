import "server-only";

/* ============================================================
   AUDIO PROBE — shared by the music service and the backup
   engine. Verifies a converter/stream URL actually serves
   bytes before handing it to the player, and reports whether
   the host honours Range requests (sources that do not
   cannot be seeked forward by the browser).
   ============================================================ */

export async function probeAudioUrl(url: string, timeoutMs = 7000): Promise<{ ok: boolean; range: boolean }> {
  const attempt = async (): Promise<{ ok: boolean; range: boolean }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { Range: "bytes=0-2047" }, signal: controller.signal });
      if (!res.ok && res.status !== 206) return { ok: false, range: false };
      return { ok: (await res.arrayBuffer()).byteLength > 0, range: res.status === 206 };
    } catch {
      return { ok: false, range: false };
    } finally {
      clearTimeout(timer);
    }
  };
  // Converter CDNs sometimes stall once while they prepare the file on their
  // side — a single cold probe must not disqualify an otherwise perfect
  // source (that abandonment is what sent listeners to wrong-song fallbacks).
  const first = await attempt();
  if (first.ok) return first;
  await new Promise((r) => setTimeout(r, 800));
  return attempt();
}

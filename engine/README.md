# LENZO ENGINE — standalone Spotify+YouTube playback engine

This is the same engine that runs inside the Next.js app
(src/lib/server/spotifyEngine.ts), packaged as a tiny standalone
Node service so it can run 24/7 on Railway with a STABLE IP.

Why it must run somewhere with a stable IP:
  Googlevideo stream URLs are locked to the IP that fetched them.
  Vercel rotates IPs every request, so direct playback there dies.
  Railway gives one persistent IP -> direct audio playback works.

## Endpoints

  GET  /health                       -> { ok: true, blocked: bool }
  POST /resolve                      -> { videoId, title, durationSec, streamUrl }
       body: { title, artist }
       Spotify canonicalises the song, YouTube is searched, the best
       candidate is identity-judged and PROVEN playable. Response
       includes a ready /stream URL (same-instance rule is satisfied
       because THIS service fetched the googlevideo url itself).
  GET  /stream/:videoId              -> pipes the audio bytes (206 range)
  GET  /search?q=&limit=             -> Spotify catalogue search
  GET  /track/:videoId               -> proof audio for one id

Optional: set ENGINE_TOKEN to require header `x-engine-token` on all
requests (recommended so strangers cannot use your Railway instance).

## Deploy on Railway (railway.app)

  1. Push this repo to GitHub.
  2. railway.app -> New Project -> Deploy from GitHub repo -> pick repo.
  3. In the service settings, set ROOT DIRECTORY = engine
     (or use `railway up` from this folder with the CLI).
  4. Variables -> add ENGINE_TOKEN=<any long secret> (optional but advised).
  5. Settings -> Networking -> Generate Domain -> copy the URL.
  6. Put the URL + token into Vercel env vars for the main app:
        ENGINE_URL=https://<your-railway-domain>
        ENGINE_TOKEN=<same secret>
     Redeploy the Vercel app. Done — resolve chain now:
     Railway engine -> mirror converters -> backup.

## Run locally (one command)

  node engine/server.js            # http://localhost:8799

## No native dependencies, no yt-dlp, no ffmpeg.

Node 18+ only (uses global fetch). youtubei search + player, IP-locked
googlevideo piped by the same process that fetched it.

# Lenzo Music

Your sound. Your wave. — a complete premium music streaming platform built on Next.js (App Router), TypeScript, Tailwind CSS and Zustand.

Deep-navy UI, electric-blue identity, mobile-first layouts, a genuinely persistent global player, and a server-side API adapter that keeps your music API key off the client.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in your music API credentials
npm run dev                  # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

## Environment variables (.env.local)

| Variable | Purpose | Default |
| --- | --- | --- |
| `MUSIC_API_BASE_URL` | Base URL of the music API | `https://api.theresav.eu` |
| `MUSIC_API_KEY` | Server-side API key | `Lenzorah` |
| `MUSIC_API_AUTH_HEADER` | Header the key travels in | `x-apikey` |
| `MUSIC_API_DOCS_URL` | Where the adapter docs live | `https://api.theresav.eu/docs` |
| `MUSIC_API_TIMEOUT_MS` | Upstream request timeout | `15000` |

Every value is read **only** on the server (`src/lib/config/api-config.ts`). The browser never sees the key — the admin UI (`/admin/api`) shows only a "key stored" flag. Settings changed through `/admin/api` persist in the JSON store (`.data/`) while env vars take precedence for base URL and key.

## Connecting the music API

The app ships with an adapter architecture in `src/lib/api/`:

- `client.ts` — one upstream caller (`callUpstream`) with auth header, timeout and a bounded request log.
- `music.ts` — search, artist, album and audio-resolution flows.
- `normalizers.ts` — maps each provider's raw payload onto shared models (`Track`, `Artist`, `Album`, `Playlist`).

Playback strategy (per project instructions):

- **Search** uses SoundCloud (`api/search/soundcloud`).
- **Audio** uses Spotify v2 with a YouTube (ytmp3) fallback — no 30-second previews are ever used: the track enters a "resolving" state, and playback starts only once a full-stream MP3 URL resolves. Spotify-sourced tracks go straight to Spotify v2 (with Spotify v1 retry); YouTube-sourced tracks go to ytmp3; SoundCloud-sourced tracks search Spotify by title + artist, then YouTube. Tracks that cannot resolve are skipped automatically (with a circuit breaker after 3 consecutive failures so the queue never skips in a loop).
- The player never fakes playback: if audio cannot be resolved it says so.
- Every resolved audio URL is **probed server-side** (range request) before it is handed to the player, so a failing converter CDN automatically falls through to the next provider.

**Albums** are derived by grouping real track catalogue data (shared album name + main artist) — the upstream search endpoints only return flat track lists, so album pages are always backed by playable tracks.

Endpoint mappings are editable at `/admin/api` without code changes.

## Routes

| Route | What it is |
| --- | --- |
| `/` | Personalized home: greeting, recently played, made-for-you, trending, genres |
| `/discover` | Charts, viral, curated collections |
| `/search` | Debounced search across SoundCloud / Spotify / YouTube with suggestions + history |
| `/explore`, `/explore/[genre]` | Genre & mood collections |
| `/radio` | Song/artist/genre/mood radio stations |
| `/library` | Full library with filters, grid/list, search |
| `/liked`, `/recently-played`, `/downloads`, `/queue`, `/now-playing`, `/lyrics` | Collection and playback pages |
| `/playlists`, `/playlists/[id]` | Playlist management (create, edit, reorder, duplicate, delete, public/private) |
| `/artists/[id]`, `/albums/[id]` | Artist & album profiles with follow/save |
| `/podcasts`, `/podcasts/[id]` | Demo podcast catalogue and show pages |
| `/profile`, `/settings` | Account, avatar, listening stats, playback prefs |
| `/login`, `/signup`, `/forgot-password`, `/reset-password` | Auth |
| `/admin`, `/admin/api`, `/admin/users`, `/admin/content`, `/admin/settings` | Admin: config, users, homepage sections, feature flags, logs |

## Data & storage

User accounts, sessions, playlists, likes and app settings live in a JSON store under `.data/` (`src/lib/db/json-store.ts`) — zero external database needed. Passwords are salted-and-hashed; sessions are httpOnly cookies. Swap in Postgres later by replacing the `src/lib/db` layer; routes and UI stay unchanged.

The first registered user gets the admin role; later promotions happen in `/admin/users`.

## Tech

Next.js (App Router) · TypeScript · Tailwind CSS · Zustand · Lucide icons · Media Session API · PWA manifest

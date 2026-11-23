"""
Lenzo Music — Backup scraper backend (v2)
In-memory standby engine for when the primary API is down.
YouTube / SoundCloud via yt-dlp, album/EP/single metadata via iTunes.
No API keys. Full tracks. Stream + download.

Run:   run.bat   (or)   uvicorn main:app --host 0.0.0.0 --port 8765
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote
import urllib.request

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from yt_dlp import YoutubeDL

try:  # optional: bundles ffmpeg so /api/download works without a system install
    from static_ffmpeg import run as _static_ffmpeg_run
except Exception:  # pragma: no cover
    _static_ffmpeg_run = None

# ─── Paths ───────────────────────────────────────────────────────────────────
BASE = Path(__file__).parent
DATA = BASE / "data"
DOWNLOADS = BASE / "downloads"
DOWNLOADS.mkdir(exist_ok=True)
DATA.mkdir(exist_ok=True)

LIBRARY_FILE = DATA / "library.json"
HISTORY_FILE = DATA / "history.json"
PLAYLISTS_FILE = DATA / "playlists.json"

# ─── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Lenzo Music Backup API",
    description="Standalone yt-dlp fallback engine. No API keys.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Small helpers ───────────────────────────────────────────────────────────
def load_json(path: Path, default: Any) -> Any:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return default


def save_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def http_json(url: str, timeout: int = 12, headers: Optional[dict] = None) -> Any:
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "LenzoMusic/2.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def clean_title(title: str) -> str:
    patterns = [
        r"\(official\s*(video|audio|lyric|music\s*video|visualizer|hd)?\)",
        r"\[official\s*(video|audio|lyric|hd)?\]",
        r"\((lyrics?|visualizer|audio|hd|4k)\)",
        r"\[(lyrics?|visualizer|audio|hd|4k)\]",
        r"#\w+",
    ]
    t = title
    for p in patterns:
        t = re.sub(p, "", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip()


STOPWORD_TOKENS = {"the", "a", "an", "of", "and", "feat", "ft", "official", "video", "audio", "music"}


def tokens(text: str) -> set[str]:
    ws = re.sub(r"[^\w\s']", " ", text.lower())
    return {w for w in ws.split() if w and w not in STOPWORD_TOKENS}


def norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


# ─── Junk / relevance scoring (mirrors the Next.js app) ──────────────────────
JUNK_RE = re.compile(
    r"(full album|greatest hits|top \d+|best of|mix(?!tape)?\b|megamix|mashup|"
    r"interview|reaction|karaoke|instrumental|cover(s)?\b|remix(es)?\b|"
    r"slowed|sped up|reverb|nightcore|8d audio|clean bandit|compilation|"
    r"playlist|live set|dj |podcast|episode|full concert|concert|live from|album stream|"
    r"performance|hop am|virals?|trending\s+\d{4}|all songs|nonstop)",
    re.I,
)
OFFICIAL_RE = re.compile(r"(official (audio|video|music video)|topic|vevo|\blyrics?\b)", re.I)


def score_result(query: str, t: dict) -> int:
    """Relevance score. Same idea as the app's rel(): exact song ranks above
    mixes, compilations, reactions and interviews."""
    q = tokens(query)
    if not q:
        return 0

    title = norm_ws(t.get("title") or "")
    artist = norm_ws(t.get("artist") or "")
    title_tokens = tokens(title)
    artist_tokens = tokens(artist)

    covered = sum(1 for w in q if any(w in tt or tt in w for tt in title_tokens))
    coverage = covered / len(q)
    s = round(coverage * 60)

    if artist_tokens and any(w in artist_tokens for w in q):
        s += 15
    # title starts with the query — strong exactness signal
    if title.lower().startswith(query.lower().split(" - ")[0][:12]):
        s += 8
    if OFFICIAL_RE.search(f"{title} {artist}"):
        s += 10
    if JUNK_RE.search(title) or JUNK_RE.search(artist):
        s -= 60

    d = t.get("duration") or 0
    if d:
        if d < 60:
            s -= 30  # clips/shorts
        elif d > 600:
            s -= 30  # mixes / full albums / live sets
        elif 120 <= d <= 420:
            s += 8  # typical song length
    if t.get("view_count") and t["view_count"] > 1_000_000:
        s += 5
    # Uploader-channel tell: the title covers the whole query but the artist
    # field ("LatinHype", "Best Pop Music"…) shares nothing with it — that is
    # a curator channel re-uploading, not the song's real page.
    if len(q) > 1 and covered == len(q) and artist_tokens and not (q & artist_tokens):
        s -= 15
    return s


MIN_SCORE = 25


def rank_tracks(query: str, tracks: list[dict]) -> list[dict]:
    for t in tracks:
        t["_score"] = score_result(query, t)
    tracks.sort(key=lambda t: t["_score"], reverse=True)
    return [t for t in tracks if t["_score"] >= MIN_SCORE]


# ─── Single-flight TTL cache ──────────────────────────────────────────────────
# The Next.js app fires the same query at us up to 3x in parallel (one per
# source) and every play re-resolves the video. Without caching that means
# 3 concurrent yt-dlp extractions per keystroke. This makes repeats instant
# and collapses in-flight duplicates into one extraction.
CACHE: dict[str, tuple[float, Any]] = {}
INFLIGHT: dict[str, asyncio.Task] = {}
SEARCH_TTL = 600.0  # ranked results — fresh enough, huge win


def _cache_get(key: str) -> Any:
    hit = CACHE.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    return None


def _cache_put(key: str, ttl: float, value: Any) -> None:
    # keep the map from growing forever
    if len(CACHE) > 500:
        now = time.time()
        for k in [k for k, (exp, _) in CACHE.items() if exp <= now]:
            del CACHE[k]
    CACHE[key] = (time.time() + ttl, value)


async def cached_call(key: str, ttl: float, run):
    value = _cache_get(key)
    if value is not None:
        return value
    task = INFLIGHT.get(key)
    if task is None:

        async def _run() -> Any:
            try:
                value = await run()
                _cache_put(key, ttl, value)
                return value
            finally:
                INFLIGHT.pop(key, None)

        task = asyncio.ensure_future(_run())
        INFLIGHT[key] = task
    return await asyncio.shield(task)


# ─── Track resolution cache ──────────────────────────────────────────────────
# id -> webpage url, filled by every search/track call, so stream/download work
# with just an id even for SoundCloud.
RESOLVED: dict[str, str] = {}


def remember(t: dict) -> None:
    url = t.get("url")
    tid = t.get("id")
    if tid and url:
        RESOLVED[tid] = url


def resolve_target(track_id: str, source: str, url: Optional[str]) -> str:
    if url:
        return url
    if source in ("youtube", "ytmusic"):
        return f"https://www.youtube.com/watch?v={track_id}"
    cached = RESOLVED.get(track_id)
    if cached:
        return cached
    raise HTTPException(
        404,
        "Non-YouTube track needs its page URL (pass ?url=) — play it once via search/track to cache it.",
    )


def track_from_info(info: dict, source: str = "youtube") -> Optional[dict]:
    if not info or not isinstance(info, dict) or info.get("_type") in ("playlist", "multi_video"):
        return None
    duration = info.get("duration") or 0
    thumb = None
    if info.get("thumbnails"):
        thumbs = [x for x in info["thumbnails"] if x.get("url")]
        thumbs.sort(key=lambda x: x.get("height") or 0, reverse=True)
        thumb = thumbs[0].get("url") if thumbs else None
    elif info.get("thumbnail"):
        thumb = info["thumbnail"]

    artist = (
        info.get("artist")
        or info.get("uploader")
        or info.get("channel")
        or info.get("creator")
        or "Unknown"
    )
    title = clean_title(info.get("track") or info.get("title") or "Unknown")

    webpage = info.get("webpage_url") or info.get("original_url") or info.get("url")
    return {
        "id": info.get("id") or str(uuid.uuid4())[:12],
        "title": title,
        "artist": artist,
        "album": info.get("album") or "",
        "duration": int(duration),
        "artwork": thumb,
        "thumbnail": thumb,
        "source": source,
        "url": webpage,
        "view_count": info.get("view_count"),
        "upload_date": info.get("upload_date"),
        "is_live": bool(info.get("is_live")),
    }


# ─── yt-dlp option sets ──────────────────────────────────────────────────────
BASE_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
    "geo_bypass": True,
    "socket_timeout": 20,
    "retries": 2,
    "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
}


def search_opts(limit: int) -> dict:
    return {
        **BASE_OPTS,
        "extract_flat": "in_playlist",
        "playlistend": limit,
    }


def stream_opts() -> dict:
    return {**BASE_OPTS, "format": "bestaudio/best"}


def ffmpeg_dir() -> Optional[str]:
    """Locate ffmpeg dir: system PATH first, then the bundled static-ffmpeg package."""
    if shutil.which("ffmpeg") and shutil.which("ffprobe"):
        return None  # already on PATH
    if _static_ffmpeg_run is not None:
        try:
            ff, _fp = _static_ffmpeg_run.get_or_fetch_platform_executables_else_raise()
            return str(Path(ff).parent)
        except Exception:
            return None
    return None


class _NoFFmpeg(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            503,
            "MP3 download needs ffmpeg. Install it (winget install ffmpeg) "
            "or 'pip install static-ffmpeg' in the backend venv — bundled binaries are picked up automatically.",
        )


# ─── Search ──────────────────────────────────────────────────────────────────
async def _yt_flat_search(url: str, limit: int) -> list[dict]:
    out: list[dict] = []
    try:
        with YoutubeDL(search_opts(limit)) as ydl:
            data = await asyncio.to_thread(ydl.extract_info, url, download=False)
            src = "soundcloud" if url.startswith("scsearch") else "youtube"
            for e in (data or {}).get("entries") or []:
                t = track_from_info(e, src)
                if t and not t.get("is_live") and (t.get("duration") or 0) > 30:
                    remember(t)
                    out.append(t)
    except Exception as ex:
        print(f"[search:{src}] {ex}")
    return out


def dedupe(tracks: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for t in tracks:
        key = (norm_ws(t["title"]).lower(), norm_ws(t["artist"]).lower()[:30])
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
    return out


@app.get("/api/health")
async def health():
    ff_ok = shutil.which("ffmpeg") is not None or ffmpeg_dir() is not None
    return {
        "status": "ok",
        "engine": "yt-dlp",
        "role": "backup",
        "version": "3",
        "ffmpeg": "ok" if ff_ok else "missing (downloads will 503)",
    }


@app.get("/api/search")
async def search(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=50),
):
    query = q.strip()
    if not query:
        raise HTTPException(400, "empty query")

    async def run() -> list[dict]:
        n = min(limit + 10, 40)
        yt_task = _yt_flat_search(f"ytsearch{n}:{query}", n)
        sc_task = _yt_flat_search(f"scsearch{min(12, n)}:{query}", min(12, n))
        raw = await asyncio.gather(yt_task, sc_task)
        return rank_tracks(query, dedupe(raw[0] + raw[1]))

    ranked = await cached_call(f"search:{norm_ws(query).lower()}", SEARCH_TTL, run)
    return {
        "query": query,
        "count": len(ranked[:limit]),
        "tracks": ranked[:limit],
    }


# ─── Titles-relevance search of the current catalogue ────────────────────────
@app.get("/api/related/{track_id}")
async def related(track_id: str, url: Optional[str] = None):
    try:
        target = resolve_target(track_id, "youtube", url)
        with YoutubeDL({**stream_opts(), "skip_download": True, "extract_flat": False}) as ydl:
            info = await asyncio.to_thread(ydl.extract_info, target, download=False)
        if not info:
            return {"tracks": []}
        title = clean_title(info.get("title") or "")
        artist = info.get("artist") or info.get("uploader") or ""
        query = f"{artist} {title}".strip()
        results = await _yt_flat_search(f"ytsearch12:{query}", 12)
        # drop the track itself and rank
        page_url = info.get("webpage_url") or target
        results = [t for t in results if t.get("url") != page_url and t.get("id") != track_id]
        return {"tracks": rank_tracks(query, dedupe(results))[:12]}
    except HTTPException:
        raise
    except Exception as e:
        return {"tracks": [], "error": str(e)}


# ─── Track / stream ──────────────────────────────────────────────────────────
@app.get("/api/track/{track_id}")
async def get_track(track_id: str, url: Optional[str] = None, source: str = "youtube"):
    target = resolve_target(track_id, source, url)
    try:
        with YoutubeDL(stream_opts()) as ydl:
            info = await asyncio.to_thread(ydl.extract_info, target, download=False)
            if not info:
                raise HTTPException(404, "track not found")
            t = track_from_info(info, source)
            if t:
                remember(t)
            return t
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(404, f"resolve failed: {e}")


@app.get("/api/stream/{track_id}")
async def stream_track(track_id: str, url: Optional[str] = None, source: str = "youtube"):
    """Resolve a direct, Range-capable full-track audio URL. No 30s previews."""
    target = resolve_target(track_id, source, url)
    # googlevideo stream URLs are valid ~6h; SoundCloud CDN URLs shorter.
    ttl = 5400.0 if source in ("youtube", "ytmusic") else 2400.0

    async def run() -> dict:
        with YoutubeDL(stream_opts()) as ydl:
            info = await asyncio.to_thread(ydl.extract_info, target, download=False)
        if not info:
            raise HTTPException(404, "no stream")

        formats = [f for f in (info.get("formats") or []) if f.get("url")]
        audio = [f for f in formats if f.get("acodec") != "none" and f.get("vcodec") in (None, "none")]
        if not audio:
            audio = [f for f in formats if f.get("acodec") != "none"]
        if not audio:
            raise HTTPException(404, "no audio format")

        def score(f: dict) -> float:
            ext = f.get("ext") or ""
            abr = f.get("abr") or f.get("tbr") or 0
            if ext in ("m4a", "mp4"):
                return 10000 + abr  # m4a/aac ships with in-file seeking
            if ext in ("webm", "opus"):
                return 5000 + abr
            return abr

        best = max(audio, key=score)
        return {
            "stream_url": best["url"],
            "format": best.get("ext"),
            "abr": best.get("abr") or best.get("tbr"),
            "duration": info.get("duration"),
            "title": info.get("title"),
            "artist": info.get("artist") or info.get("uploader"),
            "thumbnail": info.get("thumbnail"),
        }

    try:
        return await cached_call(f"stream:{target}", ttl, run)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"stream resolve failed: {e}")


# ─── MP3 download ────────────────────────────────────────────────────────────
@app.get("/api/download/{track_id}")
async def download_track(
    track_id: str,
    url: Optional[str] = None,
    source: str = "youtube",
    title: Optional[str] = None,
):
    target = resolve_target(track_id, source, url)
    safe = re.sub(r"[^\w\s\-\.]", "", title or track_id)[:80].strip() or track_id
    out_path = DOWNLOADS / f"{track_id} - {safe}.%(ext)s"

    existing = list(DOWNLOADS.glob(f"{track_id} - {safe}.mp3"))
    if existing:
        return FileResponse(existing[0], media_type="audio/mpeg", filename=f"{safe}.mp3")

    ff_dir = ffmpeg_dir()
    if ff_dir is None and shutil.which("ffmpeg") is None:
        raise _NoFFmpeg()

    opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bestaudio/best",
        "outtmpl": str(out_path),
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
        "geo_bypass": True,
        "socket_timeout": 30,
        "retries": 3,
    }
    if ff_dir:
        opts["ffmpeg_location"] = ff_dir
    try:
        with YoutubeDL(opts) as ydl:
            await asyncio.to_thread(ydl.download, [target])
        produced = list(DOWNLOADS.glob(f"{track_id} - {safe}.mp3"))
        if produced:
            return FileResponse(produced[0], media_type="audio/mpeg", filename=f"{safe}.mp3")
        # conversion may have kept the raw ext — return that rather than nothing
        raw = [p for p in DOWNLOADS.glob(f"{track_id} - {safe}.*") if p.suffix != ".part"]
        if raw:
            return FileResponse(raw[0], media_type="application/octet-stream", filename=raw[0].name)
        raise HTTPException(500, "download produced no file")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"download failed: {e}")


# ─── Albums / EP / Singles via iTunes (no key) ───────────────────────────────
def itunes_album_type(item: dict) -> str:
    """'Album' | 'EP' | 'Single'. iTunes stamps almost everything 'Album',
    so the truth is in the title suffix and the track count."""
    name = item.get("collectionName") or ""
    if re.search(r"(- Single|\bSingle\b)$", name, re.I):
        return "single"
    if re.search(r"(?-i:\b(?:EP|E\.P\.)$)|-\s*EP\b", name, re.I):
        return "ep"
    n = item.get("trackCount") or 0
    if n <= 1:
        return "single"
    if n <= 6:
        return "ep"
    return "album"


def itunes_collection_entry(item: dict) -> dict:
    return {
        "id": item.get("collectionId"),
        "name": item.get("collectionName"),
        "artist": item.get("artistName"),
        "type": itunes_album_type(item),
        "releaseDate": (item.get("releaseDate") or "")[:10],
        "trackCount": item.get("trackCount"),
        "genre": item.get("primaryGenreName"),
        "artwork": (item.get("artworkUrl100") or "").replace("100x100bb", "600x600bb"),
        "url": item.get("collectionViewUrl"),
    }


async def _itunes_album_search(term: str, limit: int) -> Any:
    return await asyncio.to_thread(
        http_json,
        f"https://itunes.apple.com/search?term={quote(term)}&entity=album&limit={limit * 2}",
    )


@app.get("/api/albums")
async def album_search(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=25),
):
    """Albums / EPs / singles for a query — powers the 'Album · artist' /
    'EP · artist' / 'Single · artist' search rows in the app."""
    term = q.strip()
    data = None
    # iTunes barely matches "artist album" combined terms — retry with the
    # second word onward, then the last two words.
    attempts = [term]
    words = term.split()
    if len(words) > 1:
        attempts += [" ".join(words[1:]), " ".join(words[-2:]), words[0]]
    err = None
    for attempt in attempts:
        try:
            candidate = await _itunes_album_search(attempt, limit)
            if candidate.get("resultCount"):
                data = candidate
                break
        except Exception as e:
            err = e
    if data is None:
        raise HTTPException(502, f"album search failed: {err or 'no results'}")
    seen: set[int] = set()
    out: list[dict] = []
    for item in data.get("results", []):
        if item.get("wrapperType") != "collection":
            continue
        cid = item.get("collectionId")
        if cid in seen:
            continue
        seen.add(cid)
        out.append(itunes_collection_entry(item))
        if len(out) >= limit:
            break
    return {"query": q, "count": len(out), "albums": out}


@app.get("/api/album/{collection_id}")
async def album_tracks(collection_id: int):
    """Full track list for an album/EP/single."""
    try:
        data = http_json(
            f"https://itunes.apple.com/lookup?id={collection_id}&entity=song&limit=50"
        )
    except Exception as e:
        raise HTTPException(502, f"album lookup failed: {e}")
    results = data.get("results", [])
    album = next((r for r in results if r.get("wrapperType") == "collection"), None)
    if not album:
        raise HTTPException(404, "album not found")

    tracks: list[dict] = []
    for r in results:
        if r.get("wrapperType") != "track":
            continue
        tracks.append(
            {
                "id": r.get("trackId"),
                "title": r.get("trackName"),
                "artist": r.get("artistName"),
                "album": r.get("collectionName"),
                "trackNumber": r.get("trackNumber"),
                "duration": round((r.get("trackTimeMillis") or 0) / 1000),
                "releaseDate": (r.get("releaseDate") or "")[:10],
                "artwork": (r.get("artworkUrl100") or "").replace("100x100bb", "600x600bb"),
                "url": r.get("trackViewUrl"),
            }
        )
    entry = itunes_collection_entry(album)
    entry["tracks"] = tracks
    return entry


@app.get("/api/song")
async def song_lookup(q: str = Query(..., min_length=1), limit: int = Query(10, ge=1, le=25)):
    """Canonical song metadata (exact title, album, release date, album type).
    Used to decorate search results and detect fresh releases (< 28 days)."""
    try:
        data = http_json(
            f"https://itunes.apple.com/search?term={quote(q.strip())}&entity=song&limit={limit * 2}"
        )
    except Exception as e:
        raise HTTPException(502, f"song lookup failed: {e}")
    out: list[dict] = []
    for r in data.get("results", []):
        if r.get("wrapperType") != "track":
            continue
        out.append(
            {
                "title": r.get("trackName"),
                "artist": r.get("artistName"),
                "album": r.get("collectionName"),
                "artwork": (r.get("artworkUrl100") or "").replace("100x100bb", "600x600bb"),
                "releaseDate": (r.get("releaseDate") or "")[:10],
                "duration": round((r.get("trackTimeMillis") or 0) / 1000),
                "url": r.get("trackViewUrl"),
            }
        )
        if len(out) >= limit:
            break
    return {"query": q, "count": len(out), "songs": out}


# ─── Artists ─────────────────────────────────────────────────────────────────
@app.get("/api/artist")
async def artist_details(q: str = Query(..., min_length=1)):
    try:
        data = http_json(
            f"https://itunes.apple.com/search?term={quote(q.strip())}&entity=musicArtist&limit=5"
        )
    except Exception as e:
        raise HTTPException(502, f"artist search failed: {e}")

    artists: list[dict] = []
    for a in data.get("results", []):
        artist_id = a.get("artistId")
        entry: dict = {
            "name": a.get("artistName"),
            "id": artist_id,
            "genre": a.get("primaryGenreName"),
            "url": a.get("artistLinkUrl"),
            "albums": [],
            "bio": None,
        }
        if artist_id:
            try:
                albums_data = http_json(
                    f"https://itunes.apple.com/lookup?id={artist_id}&entity=album&limit=20"
                )
                for item in albums_data.get("results", []):
                    if item.get("wrapperType") == "collection":
                        entry["albums"].append(itunes_collection_entry(item))
            except Exception:
                pass
        artists.append(entry)

    # Wikipedia bio: exact title first, then "{name} musician"
    if artists:
        for candidate in [artists[0]["name"], f"{artists[0]['name']} musician"]:
            if not candidate:
                continue
            try:
                w = http_json(
                    "https://en.wikipedia.org/api/rest_v1/page/summary/" + quote(candidate),
                    timeout=8,
                )
                if w.get("extract") and w.get("type") != "disambiguation":
                    artists[0]["bio"] = w["extract"]
                    if w.get("thumbnail"):
                        artists[0]["image"] = w["thumbnail"].get("source")
                    break
            except Exception:
                pass

    return {"query": q, "artists": artists}


# ─── Suggestions ─────────────────────────────────────────────────────────────
DEFAULT_SUGGESTIONS = [
    "Afrobeats 2026", "Amapiano mix", "Lo-fi beats", "Burna Boy", "Wizkid",
    "Asake", "Tems", "Rema",
]


@app.get("/api/suggestions")
async def suggestions(q: str = Query("", min_length=0)):
    if not q.strip():
        return {"suggestions": DEFAULT_SUGGESTIONS}
    try:
        results = await _yt_flat_search(f"ytsearch8:{q.strip()}", 8)
        titles = [norm_ws(t["title"]) for t in results]
        return {"suggestions": titles[:8] or [q]}
    except Exception:
        return {"suggestions": [q]}


# ─── Library / History / Playlists ───────────────────────────────────────────
@app.get("/api/library")
async def get_library():
    lib = load_json(LIBRARY_FILE, {"tracks": []})
    if isinstance(lib, dict) and "tracks" not in lib:
        lib["tracks"] = []
    return lib


@app.post("/api/library")
async def add_to_library(track: dict):
    lib = load_json(LIBRARY_FILE, {"tracks": []})
    if "tracks" not in lib:
        lib["tracks"] = []
    ids = {t.get("id") for t in lib["tracks"]}
    if track.get("id") not in ids:
        lib["tracks"].insert(0, track)
        save_json(LIBRARY_FILE, lib)
    return {"ok": True, "count": len(lib["tracks"])}


@app.delete("/api/library/{track_id}")
async def remove_from_library(track_id: str):
    lib = load_json(LIBRARY_FILE, {"tracks": []})
    lib["tracks"] = [t for t in lib["tracks"] if t.get("id") != track_id]
    save_json(LIBRARY_FILE, lib)
    return {"ok": True}


@app.get("/api/history")
async def get_history():
    h = load_json(HISTORY_FILE, {"tracks": []})
    if isinstance(h, dict) and "tracks" not in h:
        h["tracks"] = []
    return h


@app.post("/api/history")
async def add_history(track: dict):
    hist = load_json(HISTORY_FILE, {"tracks": []})
    hist["tracks"] = [t for t in hist.get("tracks", []) if t.get("id") != track.get("id")]
    hist["tracks"].insert(0, track)
    hist["tracks"] = hist["tracks"][:100]
    save_json(HISTORY_FILE, hist)
    return {"ok": True}


@app.get("/api/playlists")
async def get_playlists():
    p = load_json(PLAYLISTS_FILE, {"playlists": []})
    if isinstance(p, dict) and "playlists" not in p:
        p["playlists"] = []
    return p


class PlaylistCreate(BaseModel):
    name: str
    tracks: list[dict] = []


@app.post("/api/playlists")
async def create_playlist(body: PlaylistCreate):
    data = load_json(PLAYLISTS_FILE, {"playlists": []})
    pl = {
        "id": str(uuid.uuid4())[:8],
        "name": body.name,
        "tracks": body.tracks,
        "created": int(time.time()),
    }
    data.setdefault("playlists", []).append(pl)
    save_json(PLAYLISTS_FILE, data)
    return pl


@app.post("/api/playlists/{playlist_id}/tracks")
async def add_to_playlist(playlist_id: str, track: dict):
    data = load_json(PLAYLISTS_FILE, {"playlists": []})
    for pl in data.get("playlists", []):
        if pl["id"] == playlist_id:
            ids = {t.get("id") for t in pl.get("tracks", [])}
            if track.get("id") not in ids:
                pl.setdefault("tracks", []).append(track)
            save_json(PLAYLISTS_FILE, data)
            return {"ok": True}
    raise HTTPException(404, "playlist not found")


@app.delete("/api/playlists/{playlist_id}")
async def delete_playlist(playlist_id: str):
    data = load_json(PLAYLISTS_FILE, {"playlists": []})
    before = len(data.get("playlists", []))
    data["playlists"] = [p for p in data.get("playlists", []) if p["id"] != playlist_id]
    save_json(PLAYLISTS_FILE, data)
    return {"ok": True, "removed": before - len(data["playlists"])}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8765)

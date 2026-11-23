import { generateArtwork } from "@/lib/artwork";
import type { Album, Artist, Chart, Genre, Playlist, Track } from "@/types";

/* ============================================================
   DEMO CATALOGUE
   ------------------------------------------------------------
   Used for charts, radio seeds, curated shelves and whenever
   the upstream API is unavailable. Every entry carries a real
   title + artist, so pressing play resolves genuine audio
   through the YouTube fallback rather than pretending to play.
   ============================================================ */

interface Seed {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}

export function demoTrack(seed: Seed, index = 0): Track {
  const key = `${seed.artist}-${seed.title}`;
  return {
    id: `tr_demo_${key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}_${index}`,
    title: seed.title,
    artist: seed.artist,
    artistId: `ar_${seed.artist.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    album: seed.album,
    albumId: seed.album ? `al_${seed.album.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined,
    duration: seed.duration ?? 0,
    artwork: generateArtwork(key, seed.title),
    source: "demo",
    plays: 0,
  };
}

function seedTracks(seeds: Seed[]): Track[] {
  return seeds.map((s, i) => demoTrack(s, i));
}

function makePlaylist(id: string, name: string, description: string, seeds: Seed[]): Playlist {
  const tracks = seedTracks(seeds);
  const now = Date.now();
  return {
    id,
    name,
    description,
    artwork: generateArtwork(`${id}-${name}`, name),
    owner: "Lenzo Music",
    public: true,
    collaborative: false,
    tracks,
    createdAt: now - Math.floor(Math.random() * 1000),
    updatedAt: now,
    followers: 4200 + (id.length * 7919) % 90000,
  };
}

/* ------------------------------------------------------------------ */
/* Charts                                                              */
/* ------------------------------------------------------------------ */

export const CHARTS: Chart[] = [
  {
    id: "chart-top-50",
    name: "Lenzo Top 50",
    description: "The most played tracks across the platform right now.",
    artwork: generateArtwork("chart-top-50", "50"),
    tracks: seedTracks([
      { title: "Last Last", artist: "Burna Boy", album: "Love, Damini", duration: 172 },
      { title: "Essence (feat. Tems & Wizkid)", artist: "Wizkid", album: "Made in Lagos", duration: 248 },
      { title: "Calm Down", artist: "Rema", album: "Rave & Roses", duration: 239 },
      { title: "Free Mind", artist: "Tems", album: "If Orange Was a Place", duration: 204 },
      { title: "Love Nwantiti (feat. ElGrandeToto)", artist: "CKay", duration: 163 },
      { title: "Unavailable (feat. Davido)", artist: "Musical Chairs", album: "Timeless", duration: 184 },
      { title: "Rush", artist: "Ayra Starr", album: "19 & Dangerous", duration: 173 },
      { title: "Soweto", artist: "Victony", duration: 178 },
      { title: "Buga (Kizz Daniel & Tekno)", artist: "Kizz Daniel", duration: 203 },
      { title: "Electricity (feat. Davido)", artist: "Pheelz", duration: 180 },
      { title: "Cough (Odo)", artist: "Rema", duration: 167 },
      { title: "Peru (Remix)", artist: "Fireboy DML & Ed Sheeran", duration: 194 },
      { title: "Ku Lo Sa", artist: "Oxlade", duration: 176 },
      { title: "Who's That Boy", artist: "Ayra Starr", duration: 169 },
      { title: "Tested", artist: "Bnxn fka Buju", duration: 187 },
    ]),
  },
  {
    id: "chart-nigeria",
    name: "Nigeria Daily",
    description: "What Nigeria is streaming today.",
    artwork: generateArtwork("chart-nigeria", "NG"),
    tracks: seedTracks([
      { title: "God's Plan", artist: "Drake", duration: 198 },
      { title: "Love Overdose", artist: "Davido", duration: 201 },
      { title: "Evedado", artist: "Zinoleesky", duration: 189 },
      { title: "Kolo", artist: "Zinoleesky", duration: 175 },
      { title: "Billionaires Club", artist: "Omah Lay", duration: 192 },
      { title: "Comforter", artist: "Chike", duration: 223 },
      { title: "Running (To You)", artist: "Simi & Wale", duration: 210 },
      { title: "Majo", artist: "Victony", duration: 171 },
      { title: "Decline", artist: "Ruger", duration: 196 },
      { title: "Asiwaju", artist: "Ruger", duration: 185 },
    ]),
  },
  {
    id: "chart-viral",
    name: "Viral Wave",
    description: "Tracks blowing up across social feeds.",
    artwork: generateArtwork("chart-viral", "VIRAL"),
    tracks: seedTracks([
      { title: "Paint The Town Red", artist: "Doja Cat", duration: 230 },
      { title: "Flowers", artist: "Miley Cyrus", duration: 200 },
      { title: "Creepin'", artist: "Metro Boomin, The Weeknd & 21 Savage", duration: 222 },
      { title: "Boy's a Liar Pt. 2", artist: "PinkPantheress & Ice Spice", duration: 131 },
      { title: "Kill Bill", artist: "SZA", duration: 153 },
      { title: "Anti-Hero", artist: "Taylor Swift", duration: 200 },
      { title: "Unholy", artist: "Sam Kim & Kim Petras", duration: 156 },
      { title: "Made You Look", artist: "Meghan Trainor", duration: 147 },
    ]),
  },
  {
    id: "chart-afrobeats",
    name: "Afrobeats Chart",
    description: "The pulse of Afrobeats worldwide.",
    artwork: generateArtwork("chart-afrobeats", "AFRO"),
    tracks: seedTracks([
      { title: "Essence (feat. Tems & Wizkid)", artist: "Wizkid", album: "Made in Lagos", duration: 248 },
      { title: "Last Last", artist: "Burna Boy", album: "Love, Damini", duration: 172 },
      { title: "Calm Down", artist: "Rema", album: "Rave & Roses", duration: 239 },
      { title: "Love Nwantiti", artist: "CKay", duration: 163 },
      { title: "Soweto", artist: "Victony", duration: 178 },
      { title: "Rush", artist: "Ayra Starr", duration: 173 },
      { title: "Buga (Kizz Daniel & Tekno)", artist: "Kizz Daniel", duration: 203 },
      { title: "Ku Lo Sa", artist: "Oxlade", duration: 176 },
      { title: "Peru", artist: "Fireboy DML", duration: 194 },
      { title: "Free Mind", artist: "Tems", duration: 204 },
    ]),
  },
];

/* ------------------------------------------------------------------ */
/* Playlists                                                           */
/* ------------------------------------------------------------------ */

export const PLAYLISTS: Playlist[] = [
  makePlaylist("pl-afrobeats-now", "Afrobeats Now", "The tracks defining Afrobeats this week.", [
    { title: "Essence (feat. Tems & Wizkid)", artist: "Wizkid", album: "Made in Lagos", duration: 248 },
    { title: "Last Last", artist: "Burna Boy", album: "Love, Damini", duration: 172 },
    { title: "Calm Down", artist: "Rema", album: "Rave & Roses", duration: 239 },
    { title: "Rush", artist: "Ayra Starr", album: "19 & Dangerous", duration: 173 },
    { title: "Soweto", artist: "Victony", duration: 178 },
    { title: "Ku Lo Sa", artist: "Oxlade", duration: 176 },
    { title: "Free Mind", artist: "Tems", album: "If Orange Was a Place", duration: 204 },
    { title: "Buga (Kizz Daniel & Tekno)", artist: "Kizz Daniel", duration: 203 },
  ]),
  makePlaylist("pl-amapiano-groove", "Amapiano Groove", "Log drums, deep bass and endless summer.", [
    { title: "Ke Star (feat. Focalistic)", artist: "Vigro Deep", duration: 284 },
    { title: "Essence (Remix)", artist: "Wizkid & Justin Bieber", duration: 252 },
    { title: "Sponono", artist: "Kabza De Small & Wizkid", duration: 331 },
    { title: "Tanzania", artist: "Uncle Waffles & Tony Duardo", duration: 296 },
    { title: "Yaba Buluku (Remix)", artist: "DJ Tarico, Burna Boy & Preck", duration: 244 },
    { title: "Ameno Amapiano (Remix)", artist: "Goya Menor & Nektunez", duration: 236 },
    { title: "Loading (feat. Headie One)", artist: "Burna Boy", duration: 231 },
    { title: "Piano Person", artist: "Sha Sha & Kabza De Small", duration: 268 },
  ]),
  makePlaylist("pl-hip-hop-daily", "Hip-Hop Daily", "Fresh bars and heavy production.", [
    { title: "Sicko Mode", artist: "Travis Scott", album: "Astroworld", duration: 315 },
    { title: "God's Plan", artist: "Drake", album: "Scorpion", duration: 198 },
    { title: "HUMBLE.", artist: "Kendrick Lamar", album: "DAMN.", duration: 177 },
    { title: "Starboy", artist: "The Weeknd, Daft Punk", duration: 230 },
    { title: "Sicko Mode", artist: "Travis Scott", duration: 315 },
    { title: "First Class", artist: "Jack Harlow", duration: 177 },
    { title: "Way 2 Sexy", artist: "Drake, Future & Young Thug", duration: 254 },
    { title: "Knife Talk", artist: "Drake, 21 Savage & Project Pat", duration: 258 },
  ]),
  makePlaylist("pl-rnb-slow", "R&B After Dark", "Slow burns for late nights.", [
    { title: "Blinding Lights", artist: "The Weeknd", album: "After Hours", duration: 200 },
    { title: "Peaky Blinders", artist: "SZA", duration: 194 },
    { title: "Good Days", artist: "SZA", duration: 279 },
    { title: "Pick Up Your Feelings", artist: "Jazmine Sullivan", duration: 209 },
    { title: "Damage", artist: "H.E.R.", duration: 224 },
    { title: "Leave the Door Open", artist: "Silk Sonic", duration: 190 },
    { title: "Best Part", artist: "Daniel Caesar & H.E.R.", duration: 204 },
    { title: "Focus", artist: "H.E.R.", duration: 197 },
  ]),
  makePlaylist("pl-gospel-lift", "Gospel Lift", "Uplifting voices and big arrangements.", [
    { title: "Goodness of God", artist: "CeCe Winans", duration: 291 },
    { title: "Jireh", artist: "Elevation Worship & Maverick City", duration: 401 },
    { title: "Way Maker", artist: "Sinach", duration: 327 },
    { title: "Nara (feat. Tim Godfrey)", artist: "Mercy Chinwo", duration: 254 },
    { title: "Excess Love", artist: "Mercy Chinwo", duration: 305 },
    { title: "Kabiyesi", artist: "Dunsin Oyekan", duration: 336 },
    { title: "The Blessing", artist: "Kari Jobe, Cody Carnes & Elevation Worship", duration: 340 },
  ]),
  makePlaylist("pl-pop-rising", "Pop Rising", "The chorus you can't shake.", [
    { title: "Flowers", artist: "Miley Cyrus", duration: 200 },
    { title: "Anti-Hero", artist: "Taylor Swift", duration: 200 },
    { title: "As It Was", artist: "Harry Styles", duration: 167 },
    { title: "About Damn Time", artist: "Lizzo", duration: 193 },
    { title: "Watermelon Sugar", artist: "Harry Styles", duration: 174 },
    { title: "Levitating", artist: "Dua Lipa", duration: 203 },
    { title: "good 4 u", artist: "Olivia Rodrigo", duration: 178 },
    { title: "Stay", artist: "The Kid LAROI & Justin Bieber", duration: 141 },
  ]),
  makePlaylist("pl-electronic-pulse", "Electronic Pulse", "Synths, builds and release.", [
    { title: "Faded", artist: "Alan Walker", album: "Different World", duration: 213 },
    { title: "On My Way", artist: "Alan Walker", duration: 195 },
    { title: "The Nights", artist: "Avicii", duration: 177 },
    { title: "Lean On", artist: "Major Lazer & DJ Snake", duration: 166 },
    { title: "Clarity", artist: "Zedd ft. Foxes", duration: 271 },
    { title: "Silence", artist: "Marshmello & Khalid", duration: 182 },
    { title: "Something Just Like This", artist: "The Chainsmokers & Coldplay", duration: 247 },
  ]),
  makePlaylist("pl-chill-vibe", "Chill Wave", "Low-key tracks for unwinding.", [
    { title: "Sunflower", artist: "Post Malone & Swae Lee", duration: 158 },
    { title: "Ivy", artist: "Frank Ocean", duration: 249 },
    { title: "Electric Feel", artist: "MGMT", duration: 229 },
    { title: "The Less I Know the Better", artist: "Tame Impala", duration: 216 },
    { title: "Nights", artist: "Frank Ocean", duration: 307 },
    { title: "Slow Dancing in the Dark", artist: "Joji", duration: 209 },
    { title: "After the Storm", artist: "Kali Uchis", duration: 199 },
  ]),
  makePlaylist("pl-workout-power", "Workout Power", "Tempo up. Excuses down.", [
    { title: "HUMBLE.", artist: "Kendrick Lamar", duration: 177 },
    { title: "Power", artist: "Kanye West", duration: 291 },
    { title: "Till I Collapse", artist: "Eminem", duration: 298 },
    { title: "Stronger", artist: "Kanye West", duration: 311 },
    { title: "Can't Hold Us", artist: "Macklemore & Ryan Lewis", duration: 258 },
    { title: "Thunder", artist: "Imagine Dragons", duration: 187 },
    { title: "Believer", artist: "Imagine Dragons", duration: 204 },
  ]),
  makePlaylist("pl-focus-deep", "Deep Focus", "Instrumental beds for concentration.", [
    { title: "Time", artist: "Hans Zimmer", duration: 275 },
    { title: "Experience", artist: "Ludovico Einaudi", duration: 308 },
    { title: "Nuvole Bianche", artist: "Ludovico Einaudi", duration: 352 },
    { title: "On the Nature of Daylight", artist: "Max Richter", duration: 383 },
    { title: "Arrival of the Birds", artist: "The Cinematic Orchestra", duration: 238 },
    { title: "Raag Yaman (Meditation)", artist: "Anoushka Shankar", duration: 421 },
  ]),
  makePlaylist("pl-naija-street", "Naija Street Heat", "From Lagos to the world.", [
    { title: "Asiwaju", artist: "Ruger", duration: 185 },
    { title: "Evedado", artist: "Zinoleesky", duration: 189 },
    { title: "Kolo", artist: "Zinoleesky", duration: 175 },
    { title: "Comforter", artist: "Chike", duration: 223 },
    { title: "Majo", artist: "Victony", duration: 171 },
    { title: "Decline", artist: "Ruger", duration: 196 },
    { title: "Tested", artist: "Bnxn fka Buju", duration: 187 },
    { title: "Electricity (feat. Davido)", artist: "Pheelz", duration: 180 },
  ]),
];

/* ------------------------------------------------------------------ */
/* Genres / moods                                                      */
/* ------------------------------------------------------------------ */

export const GENRES: Genre[] = [
  { id: "afrobeats", name: "Afrobeats", color: "#287bff", gradient: "linear-gradient(135deg,#287bff,#52c8ff)" },
  { id: "amapiano", name: "Amapiano", color: "#398cff", gradient: "linear-gradient(135deg,#1f5fd6,#b7deff)" },
  { id: "nigerian", name: "Nigerian", color: "#52c8ff", gradient: "linear-gradient(135deg,#0f63d4,#7fd4ff)" },
  { id: "hiphop", name: "Hip-hop", color: "#2a4fd0", gradient: "linear-gradient(135deg,#2a4fd0,#6f9bff)" },
  { id: "rnb", name: "R&B", color: "#3f7dff", gradient: "linear-gradient(135deg,#3f7dff,#b7deff)" },
  { id: "gospel", name: "Gospel", color: "#1747a8", gradient: "linear-gradient(135deg,#1747a8,#52c8ff)" },
  { id: "pop", name: "Pop", color: "#398cff", gradient: "linear-gradient(135deg,#398cff,#e6f2ff)" },
  { id: "electronic", name: "Electronic", color: "#0f63d4", gradient: "linear-gradient(135deg,#0f63d4,#52c8ff)" },
  { id: "chill", name: "Chill", color: "#287bff", gradient: "linear-gradient(135deg,#0b1425,#398cff)" },
  { id: "workout", name: "Workout", color: "#2a4fd0", gradient: "linear-gradient(135deg,#2a4fd0,#52c8ff)" },
  { id: "focus", name: "Focus", color: "#1f5fd6", gradient: "linear-gradient(135deg,#1f5fd6,#b7deff)" },
  { id: "dancehall", name: "Dancehall", color: "#52c8ff", gradient: "linear-gradient(135deg,#1747a8,#b7deff)" },
  { id: "reggae", name: "Reggae", color: "#287bff", gradient: "linear-gradient(135deg,#0f63d4,#7fd4ff)" },
  { id: "jazz", name: "Jazz", color: "#398cff", gradient: "linear-gradient(135deg,#091222,#398cff)" },
  { id: "classical", name: "Classical", color: "#1f5fd6", gradient: "linear-gradient(135deg,#0b1425,#52c8ff)" },
  { id: "rock", name: "Rock", color: "#2a4fd0", gradient: "linear-gradient(135deg,#2a4fd0,#0b1425)" },
  { id: "latin", name: "Latin", color: "#52c8ff", gradient: "linear-gradient(135deg,#0f63d4,#e6f2ff)" },
  { id: "podcasts", name: "Podcasts", color: "#398cff", gradient: "linear-gradient(135deg,#162541,#398cff)" },
];

/* ------------------------------------------------------------------ */
/* Artists + albums (curated; live detail pages resolve via search)    */
/* ------------------------------------------------------------------ */

const ARTIST_SEEDS: Array<[string, string, number]> = [
  ["Burna Boy", "Afrobeats", 28400000],
  ["Wizkid", "Afrobeats", 24100000],
  ["Rema", "Afrobeats", 19700000],
  ["Tems", "R&B", 16400000],
  ["Ayra Starr", "Afrobeats", 11200000],
  ["Davido", "Afrobeats", 21800000],
  ["The Weeknd", "R&B", 98400000],
  ["SZA", "R&B", 72300000],
  ["Drake", "Hip-hop", 88100000],
  ["Kendrick Lamar", "Hip-hop", 64500000],
  ["Taylor Swift", "Pop", 104000000],
  ["Ayra Starr", "Afrobeats", 11200000],
  ["Tems", "R&B", 16400000],
];

export const ARTISTS: Artist[] = Array.from(
  new Map(
    ARTIST_SEEDS.map(([name, genre, listeners]): [string, Artist] => [
      name,
      {
        id: `ar_${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name,
        image: generateArtwork(`artist-${name}`, name),
        genre,
        monthlyListeners: listeners,
        verified: true,
        source: "demo",
      },
    ])
  ).values()
);

export const NEW_RELEASES: Album[] = [
  ["Love, Damini", "Burna Boy", 2022, "album"],
  ["Rave & Roses", "Rema", 2022, "album"],
  ["If Orange Was a Place", "Tems", 2021, "ep"],
  ["19 & Dangerous", "Ayra Starr", 2021, "album"],
  ["Made in Lagos", "Wizkid", 2020, "album"],
  ["After Hours", "The Weeknd", 2020, "album"],
  ["SOS", "SZA", 2022, "album"],
  ["Different World", "Alan Walker", 2018, "album"],
].map(([title, artist, year, type], i) => {
  const albumArtist = String(artist);
  const albumTitle = String(title);
  return {
    id: `al_${albumTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    title: albumTitle,
    artist: albumArtist,
    artistId: `ar_${albumArtist.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    artwork: generateArtwork(`${albumTitle}-${albumArtist}`, albumTitle),
    year: Number(year),
    type: type as Album["type"],
    trackCount: 8 + (i % 5) * 2,
    duration: 1800 + i * 140,
    source: "demo",
  };
});

/* ------------------------------------------------------------------ */
/* Home shelves (demo fallback when live search is unavailable)        */
/* ------------------------------------------------------------------ */

export const HEAVY_ROTATION = seedTracks([
  { title: "Last Last", artist: "Burna Boy", album: "Love, Damini", duration: 172 },
  { title: "Essence (feat. Tems & Wizkid)", artist: "Wizkid", album: "Made in Lagos", duration: 248 },
  { title: "Calm Down", artist: "Rema", duration: 239 },
  { title: "Blinding Lights", artist: "The Weeknd", album: "After Hours", duration: 200 },
  { title: "Faded", artist: "Alan Walker", duration: 213 },
  { title: "Rush", artist: "Ayra Starr", duration: 173 },
  { title: "Kill Bill", artist: "SZA", duration: 153 },
  { title: "HUMBLE.", artist: "Kendrick Lamar", duration: 177 },
]);

export const TRENDING = seedTracks([
  { title: "Sicko Mode", artist: "Travis Scott", duration: 315 },
  { title: "Flowers", artist: "Miley Cyrus", duration: 200 },
  { title: "Soweto", artist: "Victony", duration: 178 },
  { title: "Good Days", artist: "SZA", duration: 279 },
  { title: "The Nights", artist: "Avicii", duration: 177 },
  { title: "Ku Lo Sa", artist: "Oxlade", duration: 176 },
  { title: "Levitating", artist: "Dua Lipa", duration: 203 },
  { title: "Buga (Kizz Daniel & Tekno)", artist: "Kizz Daniel", duration: 203 },
]);

export const NIGERIAN = seedTracks([
  { title: "Asiwaju", artist: "Ruger", duration: 185 },
  { title: "Evedado", artist: "Zinoleesky", duration: 189 },
  { title: "Comforter", artist: "Chike", duration: 223 },
  { title: "Decline", artist: "Ruger", duration: 196 },
  { title: "Majo", artist: "Victony", duration: 171 },
  { title: "Tested", artist: "Bnxn fka Buju", duration: 187 },
  { title: "Electricity (feat. Davido)", artist: "Pheelz", duration: 180 },
  { title: "Running (To You)", artist: "Simi & Wale", duration: 210 },
]);

export const PODCASTS_SEED = [
  ["The Afrobeats Podcast", "Media Republic", "Conversations with the people shaping African sound."],
  ["Deep Focus Radio", "Lenzo Studios", "Ambient sessions and interviews for concentrated work."],
  ["Tech Signals", "Signal Network", "Weekly analysis of the products and platforms moving culture."],
  ["Late Night Lyrics", "Blue Room", "Songwriters break down the lines that defined their careers."],
  ["Business of Music", "Waveform Media", "How records get made, marketed and monetised."],
  ["Amapiano Diaries", "Piano Republic", "Mixes, producers and the log-drum movement."],
].map(([title, publisher, description], i) => ({
  id: `pod_${i + 1}`,
  title,
  publisher,
  description,
  artwork: generateArtwork(`podcast-${title}`, title),
  episodeCount: 24 + i * 7,
  source: "demo" as const,
}));

export function playlistById(id: string): Playlist | undefined {
  return PLAYLISTS.find((p) => p.id === id);
}

export function chartById(id: string): Chart | undefined {
  return CHARTS.find((c) => c.id === id);
}

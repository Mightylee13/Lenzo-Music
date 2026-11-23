import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* ============================================================
   APP STORE — Supabase-backed (file fallback)
   ------------------------------------------------------------
   Same sync interface the app has always used; the driver is
   chosen by environment:

     SUPABASE_URL + SUPABASE_SERVICE_KEY present -> Supabase
     otherwise (or on Supabase failure)          -> local db.json

   SUPABASE LAYOUT — one general table, db.json semantics 1:1:
     store(collection, id, data jsonb, updated_at)
   Collection rows carry the item's `id`; a special "settings"
   collection stores admin config keys (id = setting name).

   Consistency model: an in-memory snapshot hydrates from Supabase
   (refreshed on reads when staleness exceeds the window). Every mutation
   is diffed against the pre-mutation snapshot and flushed as a PRECISE
   per-mutation diff (only the rows this instance actually created,
   changed or removed) through a serial queue. Flushing whole snapshots
   instead caused a stale instance to resurrect rows other instances had
   deleted (worker-resurrection) — never do that.
   ============================================================ */

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
const SUPABASE_MODE = Boolean(SUPABASE_URL && SUPABASE_KEY);
const SETTINGS_COLLECTION = "__settings__";

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "db.json");

let cache: Record<string, unknown> | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let supabase: SupabaseClient | null = null;
/** Resolves once the snapshot is ready (Supabase hydrate done, or file loaded). */
let hydrate: Promise<void> | null = null;
/** When the current snapshot was pulled from Supabase (0 = never/file). */
let hydratedAt = 0;

if (SUPABASE_MODE) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });
  // Hydrate as soon as the module is imported, so cold serverless
  // starts warm the snapshot while the first request is in flight.
  void ensureDbLoaded();
}

/** Await once before reads/writes in async entry points (routes, session). */
export function ensureDbLoaded(): Promise<void> {
  return hydrate ?? loadSync();
}

function loadSync(allowRetry = false): Promise<void> {
  if (!hydrate || allowRetry) {
    // A failed Supabase hydrate used to fall back to an empty file store
    // and stick forever — on serverless that wiped out logins and data for
    // that instance's whole lifetime. Supabase is the only real store in
    // production, so failures stay retryable instead of sticky (the file
    // driver remains for local dev without env vars).
    if (SUPABASE_MODE) {
      const previous = allowRetry ? hydrate : null;
      hydrate = (previous ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => hydrateFromSupabase())
        .then(() => {
          hydratedAt = Date.now();
        });
    } else {
      hydrate = Promise.resolve(loadFile());
    }
  }
  return hydrate;
}

/**
 * Serverless consistency: each instance snapshots the DB at boot and never
 * hears about writes flushed by other instances, so a playlist created on
 * instance A was invisible to instances B and C ("playlist not found" /
 * missing from library). Reads refresh the snapshot when it is older than
 * `maxAgeMs` — one cheap query at most every window, per instance.
 */
export async function refreshDbIfStale(maxAgeMs = 15_000): Promise<void> {
  if (!SUPABASE_MODE) return;
  if (Date.now() - hydratedAt < maxAgeMs && cache) return;
  await loadSync(true).catch(() => undefined);
}

/* ---------- Supabase driver ---------- */

interface StoreRow {
  collection: string;
  id: string;
  data: unknown;
}

async function hydrateFromSupabase(): Promise<void> {
  try {
    const snap: Record<string, unknown> = {};
    let from = 0;
    for (;;) {
      const { data, error } = await supabase!
        .from("store")
        .select("collection,id,data")
        .range(from, from + 999)
        .order("collection", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as StoreRow[];
      for (const row of rows) {
        if (row.collection === SETTINGS_COLLECTION) {
          snap[row.id] = row.data;
        } else {
          if (!Array.isArray(snap[row.collection])) snap[row.collection] = [];
          (snap[row.collection] as unknown[]).push(row.data);
        }
      }
      if (!rows.length || rows.length < 1000) break;
      from += rows.length;
    }
    cache = snap;
  } catch (err) {
    // Supabase unreachable right now (network blip, fresh project without
    // tables): leave the snapshot empty but keep the client alive so the
    // next refreshDbIfStale/ensureDbLoaded can retry. (Sticky file fallback
    // here would serve an empty DB for the instance's whole lifetime.)
    console.error("[db] supabase hydrate failed — will retry on next read:", err instanceof Error ? err.message : err);
    if (!cache) cache = {};
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}

/** Stable per-item row id: the item's `id`, else its array position. */
function rowId(item: unknown, index: number): string {
  const id = (item as { id?: unknown } | null)?.id;
  return typeof id === "string" && id ? id : `row_${index}`;
}

function collectionMap(value: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (Array.isArray(value)) value.forEach((item, i) => map.set(rowId(item, i), item));
  return map;
}

/**
 * Diff the pre-mutation snapshot against the post-mutation one. Only rows
 * this instance actually created/changed (collection + settings) and rows it
 * actually removed end up in the flush — a stale snapshot alone never writes
 * anything (that's what resurrected deleted data before).
 */
function diffSnapshots(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { upserts: StoreRow[]; deletes: Array<{ collection: string; id: string }> } {
  const upserts: StoreRow[] = [];
  const deletes: Array<{ collection: string; id: string }> = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    const b = before[key];
    const a = after[key];

    if (Array.isArray(b) || Array.isArray(a)) {
      const bm = collectionMap(b);
      const am = collectionMap(a);
      for (const [id, item] of am) {
        if (!bm.has(id) || stableJson(bm.get(id)) !== stableJson(item)) {
          upserts.push({ collection: key, id, data: item });
        }
      }
      if (Array.isArray(b)) {
        for (const id of bm.keys()) {
          if (!am.has(id)) deletes.push({ collection: key, id });
        }
      }
      if (Array.isArray(b) && !Array.isArray(a)) {
        // collection became a scalar setting — remove every old row
        for (const id of bm.keys()) deletes.push({ collection: key, id });
      }
    } else if (stableJson(b) !== stableJson(a)) {
      if (a !== undefined) {
        upserts.push({ collection: SETTINGS_COLLECTION, id: key, data: a });
      } else if (b !== undefined) {
        deletes.push({ collection: SETTINGS_COLLECTION, id: key });
      }
    }
  }
  return { upserts, deletes };
}

async function persistToSupabase(
  upserts: StoreRow[],
  deletes: Array<{ collection: string; id: string }>,
): Promise<void> {
  try {
    const pageSize = 500;
    for (let i = 0; i < upserts.length; i += pageSize) {
      const { error } = await supabase!
        .from("store")
        .upsert(upserts.slice(i, i + pageSize), { onConflict: "collection,id" });
      if (error) throw new Error(error.message);
    }
    const byCollection = new Map<string, string[]>();
    for (const del of deletes) {
      const ids = byCollection.get(del.collection) ?? [];
      ids.push(del.id);
      byCollection.set(del.collection, ids);
    }
    for (const [collection, ids] of byCollection) {
      const { error } = await supabase!
        .from("store")
        .delete()
        .eq("collection", collection)
        .in("id", ids);
      if (error) throw new Error(error.message);
    }
  } catch (err) {
    console.error("[db] supabase persist failed:", err instanceof Error ? err.message : err);
  }
}

/* ---------- File driver (dev / fallback) ---------- */

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "{}", "utf8");
}

function loadFile(): void {
  ensureFile();
  try {
    cache = JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as Record<string, unknown>;
  } catch {
    cache = {};
  }
}

function persistFile(): void {
  const snapshot = JSON.stringify(cache ?? {}, null, 2);
  try {
    ensureFile();
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, snapshot, "utf8");
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error("[db] file write failed", err);
  }
}

/* ---------- public interface (unchanged) ---------- */

export function readDb<T = Record<string, unknown>>(): T {
  if (cache) return cache as T;
  loadSync();
  return (cache ?? {}) as T;
}

/** Mutate the store; ONLY the precise change is flushed (Supabase or disk). */
export function updateDb<T = Record<string, unknown>>(mutator: (db: Record<string, unknown>) => T): T {
  const db = readDb();
  if (supabase && cache) {
    const before = structuredClone(cache);
    const result = mutator(db);
    const { upserts, deletes } = diffSnapshots(before, cache);
    if (upserts.length || deletes.length) {
      writeQueue = writeQueue.then(() => persistToSupabase(upserts, deletes));
    }
    return result;
  }
  const result = mutator(db);
  if (!supabase) writeQueue = writeQueue.then(() => persistFile());
  return result;
}

export function collection<T>(name: string, fallback: T[] = []): T[] {
  const db = readDb<Record<string, unknown>>();
  if (!Array.isArray(db[name])) db[name] = fallback;
  return db[name] as T[];
}

export function getSetting<K extends string, D>(name: K, fallback: D): D {
  const db = readDb<Record<string, unknown>>();
  return (db[name] as D) ?? fallback;
}

export function setSetting(name: string, value: unknown): void {
  updateDb((db) => {
    db[name] = value;
  });
}

/** Await until every queued mutation has reached Supabase (or the file). */
export function flushWrites(): Promise<void> {
  return writeQueue;
}

/** Test/ops helper — wipes all persisted application data. */
export function resetDb(): void {
  cache = {};
  if (supabase) {
    writeQueue = writeQueue.then(async () => {
      try {
        await supabase!.from("store").delete().neq("collection", "__none__");
      } catch (err) {
        console.error("[db] supabase reset failed", err);
      }
    });
  }
}

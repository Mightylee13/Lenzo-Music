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

   Consistency model: an in-memory snapshot hydrates from
   Supabase once per server instance. Every mutation runs on the
   snapshot and is flushed as a precise diff (upserts + deletes)
   through a serial queue — cheap at this scale, and safe
   against concurrent serverless instances (no delete-all).
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
/** Known remote ids per collection — the baseline for delete diffs. */
const remoteIds = new Map<string, Set<string>>();

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
    remoteIds.clear();
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
        const ids = remoteIds.get(row.collection) ?? new Set<string>();
        ids.add(row.id);
        remoteIds.set(row.collection, ids);
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

function settingsRow(name: string): StoreRow {
  return { collection: SETTINGS_COLLECTION, id: name, data: getSetting(name, undefined) };
}

function collectionRows(name: string): StoreRow[] {
  return collection<Record<string, unknown>>(name, []).map((item, i) => ({
    collection: name,
    id: typeof item.id === "string" ? item.id : `row_${i}`,
    data: item,
  }));
}

function persistToSupabase(): Promise<void> {
  if (!supabase || !cache) return Promise.resolve();

  // Upsert every row we now hold; delete remote rows that vanished.
  const upserts: StoreRow[] = [];
  const deletes: Array<{ collection: string; ids: string[] }> = [];
  for (const [key, value] of Object.entries(cache)) {
    if (Array.isArray(value)) {
      const rows = collectionRows(key);
      for (const row of rows) upserts.push(row);
      const ids = new Set(rows.map((r) => r.id));
      const stale = [...(remoteIds.get(key) ?? [])].filter((id) => !ids.has(id));
      if (stale.length) deletes.push({ collection: key, ids: stale });
      remoteIds.set(key, ids);
    } else {
      upserts.push(settingsRow(key));
      const ids = remoteIds.get(SETTINGS_COLLECTION) ?? new Set<string>();
      ids.add(key);
      remoteIds.set(SETTINGS_COLLECTION, ids);
    }
  }

  const work = (async () => {
    try {
      const pageSize = 500;
      for (let i = 0; i < upserts.length; i += pageSize) {
        const { error } = await supabase!
          .from("store")
          .upsert(upserts.slice(i, i + pageSize), { onConflict: "collection,id" });
        if (error) throw new Error(error.message);
      }
      for (const del of deletes) {
        const { error } = await supabase!
          .from("store")
          .delete()
          .eq("collection", del.collection)
          .in("id", del.ids);
        if (error) throw new Error(error.message);
      }
    } catch (err) {
      console.error("[db] supabase persist failed:", err instanceof Error ? err.message : err);
    }
  })();
  return work;
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

function persist() {
  if (supabase) writeQueue = writeQueue.then(() => persistToSupabase());
  else writeQueue = writeQueue.then(() => persistFile());
  return writeQueue;
}

/** Mutate the store; the change is flushed (Supabase or disk) asynchronously. */
export function updateDb<T = Record<string, unknown>>(mutator: (db: Record<string, unknown>) => T): T {
  const db = readDb();
  const result = mutator(db);
  void persist();
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
  remoteIds.clear();
  if (supabase) {
    writeQueue = writeQueue.then(async () => {
      try {
        await supabase!.from("store").delete().neq("collection", "__none__");
      } catch (err) {
        console.error("[db] supabase reset failed", err);
      }
    });
  } else {
    void persist();
  }
}

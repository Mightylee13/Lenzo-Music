import "server-only";
import fs from "node:fs";
import path from "node:path";

/* ============================================================
   JSON FILE STORE
   ------------------------------------------------------------
   Zero-setup persistence for accounts, playlists, sessions and
   admin state. Writes are serialised through a small queue so
   concurrent route handlers never interleave a partial write.

   Swap this module for a real driver (Postgres/SQLite) and the
   rest of the application is unaffected — every caller goes
   through `db()`.
   ============================================================ */

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "db.json");

let cache: Record<string, unknown> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, "{}", "utf8");
  }
}

export function readDb<T = Record<string, unknown>>(): T {
  if (cache) return cache as T;
  ensure();
  try {
    cache = JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as Record<string, unknown>;
  } catch {
    cache = {};
  }
  return cache as T;
}

function persist() {
  const snapshot = JSON.stringify(cache ?? {}, null, 2);
  writeQueue = writeQueue.then(
    () =>
      new Promise<void>((resolve) => {
        try {
          ensure();
          const tmp = `${DB_FILE}.tmp`;
          fs.writeFileSync(tmp, snapshot, "utf8");
          fs.renameSync(tmp, DB_FILE);
        } catch (err) {
          console.error("[db] write failed", err);
        }
        resolve();
      })
  );
  return writeQueue;
}

/** Mutate the store; the change is flushed to disk asynchronously. */
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

/** Test/ops helper — wipes all persisted application data. */
export function resetDb(): void {
  cache = {};
  void persist();
}

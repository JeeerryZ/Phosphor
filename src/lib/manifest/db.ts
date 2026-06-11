import Database from "better-sqlite3";
import { manifestDbFile } from "./paths";

let db: Database.Database | null = null;

/** Returns a singleton, read-only connection to the cached manifest SQLite DB. */
export function getManifestDb(): Database.Database {
  if (!db) {
    db = new Database(manifestDbFile, { readonly: true, fileMustExist: true });
  }
  return db;
}

/**
 * Bungie hashes are unsigned 32-bit integers, but the manifest SQLite tables
 * store their `id` column as signed 32-bit integers. This converts an
 * unsigned hash to its signed equivalent for use in queries.
 */
export function hashToSignedInt32(hash: number): number {
  return hash > 0x7fffffff ? hash - 0x100000000 : hash;
}

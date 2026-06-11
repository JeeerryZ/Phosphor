import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), "data", "manifest");

export const manifestCacheDir = CACHE_DIR;
export const manifestVersionFile = path.join(CACHE_DIR, "manifest-version.json");
export const manifestDbFile = path.join(CACHE_DIR, "world.sqlite3");

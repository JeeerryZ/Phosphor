import os from "node:os";
import path from "node:path";

// Vercel (and most serverless hosts) mount the deployment bundle read-only —
// only the OS temp dir is writable, and it's wiped between cold starts. Local
// dev keeps using a real project-relative cache dir so it survives restarts.
const CACHE_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "phosphor-manifest")
  : path.join(process.cwd(), "data", "manifest");

export const manifestCacheDir = CACHE_DIR;
export const manifestVersionFile = path.join(CACHE_DIR, "manifest-version.json");
export const manifestDbFile = path.join(CACHE_DIR, "world.sqlite3");

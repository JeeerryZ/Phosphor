import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { getDestinyManifest } from "bungie-api-ts/destiny2";
import { createBungieClient } from "../bungie/client";
import { BUNGIE_BASE_URL } from "../bungie/config";
import { manifestCacheDir, manifestDbFile, manifestVersionFile } from "./paths";

const MANIFEST_LANGUAGE = "en";

interface ManifestVersionFile {
  version: string;
}

async function readCachedVersion(): Promise<string | null> {
  try {
    const raw = await fsPromises.readFile(manifestVersionFile, "utf-8");
    return (JSON.parse(raw) as ManifestVersionFile).version;
  } catch {
    return null;
  }
}

async function downloadAndExtractManifest(contentPath: string): Promise<void> {
  const response = await fetch(`${BUNGIE_BASE_URL}${contentPath}`);
  if (!response.ok) {
    throw new Error(`Failed to download Destiny manifest: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  if (entries.length === 0) {
    throw new Error("Destiny manifest archive contained no entries");
  }

  // The manifest .content file is a zip with a single entry containing the sqlite DB.
  const dbEntry = entries[0];
  const tempFile = `${manifestDbFile}.tmp`;

  await fsPromises.mkdir(manifestCacheDir, { recursive: true });
  await fsPromises.writeFile(tempFile, dbEntry.getData());
  await fsPromises.rename(tempFile, manifestDbFile);
}

/**
 * Ensures the local manifest SQLite cache matches the current Bungie manifest
 * version, downloading and extracting it if it's missing or stale.
 */
export async function ensureManifestUpToDate(): Promise<void> {
  const http = createBungieClient();
  const { Response: manifest } = await getDestinyManifest(http);

  const cachedVersion = await readCachedVersion();
  const dbExists = fs.existsSync(manifestDbFile);

  if (cachedVersion === manifest.version && dbExists) {
    return;
  }

  const contentPath = manifest.mobileWorldContentPaths[MANIFEST_LANGUAGE];
  if (!contentPath) {
    throw new Error(`No manifest content path for language "${MANIFEST_LANGUAGE}"`);
  }

  await downloadAndExtractManifest(contentPath);

  await fsPromises.mkdir(path.dirname(manifestVersionFile), { recursive: true });
  await fsPromises.writeFile(
    manifestVersionFile,
    JSON.stringify({ version: manifest.version } satisfies ManifestVersionFile)
  );
}

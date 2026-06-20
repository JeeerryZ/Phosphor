import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.resolve(__dirname, "../data/manifest/world.sqlite3"), { readonly: true });
const toU32 = n => n >>> 0;
const toS32 = n => n | 0;

// Armor bucket hashes (unsigned)
const ARMOR_BUCKETS = new Set([3448274439, 3551918588, 14239492, 20886954, 1585787867]);

// Find all socket types used in armor items and what socket category they belong to
console.log("=== SOCKET TYPE HASHES USED IN ARMOR ITEMS ===");

// Get all armor items that have sockets
const armorItems = db.prepare(
  "SELECT id, json FROM DestinyInventoryItemDefinition WHERE json LIKE '%socketEntries%' LIMIT 5000"
).all();

// Count socket type usage across armor items
const sockTypeCounts = new Map();
const sockTypeByItem = new Map(); // sockTypeHash -> sample item name

for (const row of armorItems) {
  let def;
  try { def = JSON.parse(row.json); } catch { continue; }

  const bucketHash = toU32(def.inventory?.bucketTypeHash ?? 0);
  if (!ARMOR_BUCKETS.has(bucketHash)) continue;

  const entries = def.sockets?.socketEntries ?? [];
  const name = def.displayProperties?.name ?? "";

  for (let i = 0; i < entries.length; i++) {
    const stHash = toU32(entries[i].socketTypeHash);
    if (stHash === 0) continue;
    sockTypeCounts.set(stHash, (sockTypeCounts.get(stHash) ?? 0) + 1);
    if (!sockTypeByItem.has(stHash)) sockTypeByItem.set(stHash, { name, socketIndex: i });
  }
}

// Resolve each socket type to its category name
console.log("Socket types found in armor (by frequency):");
const sorted = [...sockTypeCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [stHash, count] of sorted.slice(0, 30)) {
  const stRow = db.prepare("SELECT json FROM DestinySocketTypeDefinition WHERE id = ?").get(toS32(stHash));
  if (!stRow) continue;
  const stDef = JSON.parse(stRow.json);
  const catHash = toU32(stDef.socketCategoryHash);
  const catRow = db.prepare("SELECT json FROM DestinySocketCategoryDefinition WHERE id = ?").get(toS32(catHash));
  const catName = catRow ? (JSON.parse(catRow.json).displayProperties?.name ?? "") : "?";
  const plugCats = (stDef.plugWhitelist ?? []).map(w => w.categoryIdentifier).join(" | ");
  const sample = sockTypeByItem.get(stHash);
  console.log(`  sockType=${stHash}  count=${count}  sockCat="${catName}"  plugCats="${plugCats}"  (e.g. "${sample?.name}" idx=${sample?.socketIndex})`);
}

// Look for any socket type in armor items matching "ARMOR TIER"
const ARMOR_TIER_CAT = 760375309;
console.log("\n=== SOCKET TYPES WITH socketCategoryHash=ARMOR TIER (760375309) ===");
for (const [stHash] of sorted) {
  const stRow = db.prepare("SELECT json FROM DestinySocketTypeDefinition WHERE id = ?").get(toS32(stHash));
  if (!stRow) continue;
  const stDef = JSON.parse(stRow.json);
  if (toU32(stDef.socketCategoryHash) !== ARMOR_TIER_CAT) continue;
  const plugCats = (stDef.plugWhitelist ?? []).map(w => w.categoryIdentifier).join(" | ");
  console.log(`  sockType=${stHash}  plugCats="${plugCats}"`);
}

db.close();

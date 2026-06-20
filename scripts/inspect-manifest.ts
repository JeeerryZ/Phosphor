/**
 * Manifest inspection v5 — final data collection.
 * Usage: npx tsx scripts/inspect-manifest.ts
 */
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "data/manifest/world.sqlite3");
const db = new Database(DB_PATH, { readonly: true });

function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
function one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
function toU32(n: number): number { return n >>> 0; }
function toS32(n: number): number { return n | 0; }

const ARMOR_STAT_HASHES: Record<string, number> = {
  mobility: 2996146975,
  resilience: 392767087,
  recovery: 1943323491,
  discipline: 1735777505,
  intellect: 144602215,
  strength: 4244567218,
};

// ── 1. Show ALL items in armor_stats and mods plug categories ────────────────
console.log("=== ITEMS WITH plugCat='armor_stats' OR 'mods' ===");
const statItems = all<{ id: number; json: string }>(
  `SELECT id, json FROM DestinyInventoryItemDefinition
   WHERE json LIKE '%"plugCategoryIdentifier":"armor_stats%'
   OR json LIKE '%"plugCategoryIdentifier":"mods%'`
);
for (const row of statItems) {
  const def = JSON.parse(row.json);
  const plugCat: string = def.plug?.plugCategoryIdentifier ?? "";
  const investments: { statTypeHash: number; value: number; isConditionallyActive?: boolean }[] = def.investmentStats ?? [];
  const armorStats = investments
    .filter(inv => Object.values(ARMOR_STAT_HASHES).some(h => toU32(inv.statTypeHash) === h))
    .map(inv => {
      const stat = Object.entries(ARMOR_STAT_HASHES).find(([, h]) => toU32(inv.statTypeHash) === h)?.[0];
      return `${stat}=${inv.value}`;
    })
    .join(", ");
  if (!armorStats) continue;
  console.log(`  hash=${toU32(row.id)}  name="${def.displayProperties?.name}"  plugCat="${plugCat}"  stats=[${armorStats}]`);
}

// ── 2. Find empty armor mod plug hashes ─────────────────────────────────────
console.log("\n=== EMPTY MOD PLUGS (plugCat='mods' with no or zero stats) ===");
const emptyMods = all<{ id: number; json: string }>(
  `SELECT id, json FROM DestinyInventoryItemDefinition
   WHERE json LIKE '%"plugCategoryIdentifier":"mods%'
   LIMIT 100`
);
for (const row of emptyMods) {
  const def = JSON.parse(row.json);
  const plugCat: string = def.plug?.plugCategoryIdentifier ?? "";
  if (!plugCat.startsWith("mods")) continue;
  const investments: { statTypeHash: number; value: number }[] = def.investmentStats ?? [];
  const hasArmor = investments.some(inv => Object.values(ARMOR_STAT_HASHES).some(h => toU32(inv.statTypeHash) === h));
  if (!hasArmor) {
    console.log(`  hash=${toU32(row.id)}  name="${def.displayProperties?.name}"  plugCat="${plugCat}"  investments=${JSON.stringify(investments)}`);
  }
}

// ── 3. Find Tier 5 armor by looking for empty tuning plug as default ─────────
const EMPTY_TUNING = 2121121504;
const EMPTY_TUNING_S = toS32(EMPTY_TUNING);
console.log("\n=== TIER 5 ARMOR: search by defaultPlugHash=EMPTY_TUNING ===");
const ARMOR_BUCKETS_S = [3448274439, 3551918588, 14239492, 20886954, 1585787867].map(toS32);

const tier5Rows = all<{ id: number; json: string }>(
  `SELECT id, json FROM DestinyInventoryItemDefinition
   WHERE json LIKE '%"defaultPlugHash":${EMPTY_TUNING}%'
   OR json LIKE '%"defaultPlugHash":${EMPTY_TUNING_S}%'
   LIMIT 20`
);
for (const row of tier5Rows) {
  const def = JSON.parse(row.json);
  const bucketHash = def.inventory?.bucketTypeHash;
  if (!ARMOR_BUCKETS_S.includes(bucketHash) && !ARMOR_BUCKETS_S.includes(toS32(toU32(bucketHash)))) continue;
  console.log(`\n  Item: "${def.displayProperties?.name}" (hash=${toU32(row.id)}, classType=${def.classType})`);
  const entries: { socketTypeHash: number; defaultPlugHash?: number }[] = def.sockets?.socketEntries ?? [];
  for (let i = 0; i < entries.length; i++) {
    const stHash = toU32(entries[i].socketTypeHash);
    const stRow = one<{ json: string }>(
      "SELECT json FROM DestinySocketTypeDefinition WHERE id = ?",
      entries[i].socketTypeHash
    );
    const cats = stRow
      ? (JSON.parse(stRow.json).plugWhitelist ?? []).map((w: { categoryIdentifier: string }) => w.categoryIdentifier).join(" | ")
      : "(not found)";
    const defaultPlug = entries[i].defaultPlugHash ? toU32(entries[i].defaultPlugHash!) : undefined;
    const isEmptyTuning = defaultPlug === EMPTY_TUNING;
    console.log(`    [${i}] socketTypeHash=${stHash}  default=${defaultPlug ?? "none"}  → "${cats}"${isEmptyTuning ? "  *** TUNING ***" : ""}`);
  }
}
if (tier5Rows.length === 0) {
  console.log("  (none found)");
}

// ── 4. Check what the socket for socketType 4076485920 looks like ────────────
console.log("\n=== SOCKET TYPE 4076485920 (mods) DETAIL ===");
const modSocket = one<{ json: string }>(
  "SELECT json FROM DestinySocketTypeDefinition WHERE id = ?",
  toS32(4076485920)
);
if (modSocket) {
  const def = JSON.parse(modSocket.json);
  console.log("  plugWhitelist:", JSON.stringify(def.plugWhitelist, null, 2));
  console.log("  socketCategoryHash:", def.socketCategoryHash);
  console.log("  insertAction:", JSON.stringify(def.insertAction));
}

db.close();
console.log("\nDone.");

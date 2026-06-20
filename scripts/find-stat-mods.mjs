import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.resolve(__dirname, "../data/manifest/world.sqlite3"), { readonly: true });
const toU32 = n => n >>> 0;
const toS32 = n => n | 0;

// Find all plugs in the enhancements.v2_general category and see which ones give +10 stats
// First look at the socket type definition for 1718047805 to see the reusable plug set
const GENERAL_SOCK_TYPE = 1718047805;
const stRow = db.prepare("SELECT json FROM DestinySocketTypeDefinition WHERE id = ?").get(toS32(GENERAL_SOCK_TYPE));
const stDef = JSON.parse(stRow.json);
console.log("Socket type 1718047805 (enhancements.v2_general):");
console.log("  reusablePlugSetHash:", toU32(stDef.plugSets?.reusablePlugSetHash ?? 0));
console.log("  reusablePlugItems count:", stDef.plugWhitelist?.length ?? 0);
if (stDef.plugSets?.reusablePlugSetHash) {
  const plugSetRow = db.prepare("SELECT json FROM DestinyPlugSetDefinition WHERE id = ?").get(toS32(stDef.plugSets.reusablePlugSetHash));
  if (plugSetRow) {
    const plugSet = JSON.parse(plugSetRow.json);
    console.log("  reusablePlugItems in plugSet:", plugSet.reusablePlugItems?.length ?? 0);
  }
}

// Look up all items with plugCategoryIdentifier = enhancements.v2_general that give stat boosts
const ARMOR_STAT_HASHES = {
  mobility: 2996146975,
  resilience: 392767087,
  recovery: 1943323491,
  discipline: 1735777505,
  intellect: 144602215,
  strength: 4244567218,
};

console.log("\n=== PLUGS IN 'enhancements.v2_general' CATEGORY WITH STAT BOOSTS ===");
const plugRows = db.prepare(
  "SELECT id, json FROM DestinyInventoryItemDefinition WHERE json LIKE '%enhancements.v2_general%' LIMIT 2000"
).all();

const results = [];
for (const row of plugRows) {
  let def; try { def = JSON.parse(row.json); } catch { continue; }
  if (def.plug?.plugCategoryIdentifier !== "enhancements.v2_general") continue;

  const stats = {};
  const investmentStats = def.investmentStats ?? [];
  for (const [statName, statHash] of Object.entries(ARMOR_STAT_HASHES)) {
    const entry = investmentStats.find(s => toU32(s.statTypeHash) === statHash);
    if (entry && entry.value !== 0) stats[statName] = entry.value;
  }
  if (Object.keys(stats).length === 0) continue;

  results.push({
    hash: toU32(row.id),
    name: def.displayProperties?.name ?? "",
    stats,
  });
}

results.sort((a, b) => {
  const aMax = Math.max(...Object.values(a.stats));
  const bMax = Math.max(...Object.values(b.stats));
  return bMax - aMax;
});

for (const r of results) {
  console.log(`  hash=${r.hash}  "${r.name}"  stats=${JSON.stringify(r.stats)}`);
}

// Also look for "Major" or "+10" or "Tier 2" stat mods in any armor plug category
console.log("\n=== ALL GENERAL ARMOR STAT MODS (+10 boosts) ===");
const rows2 = db.prepare(
  "SELECT id, json FROM DestinyInventoryItemDefinition WHERE json LIKE '%plug%' LIMIT 20000"
).all();

const generalStatMods = [];
for (const row of rows2) {
  let def; try { def = JSON.parse(row.json); } catch { continue; }
  const plugCat = def.plug?.plugCategoryIdentifier ?? "";
  if (!plugCat.startsWith("enhancements")) continue;

  const investmentStats = def.investmentStats ?? [];
  const statBoosts = {};
  for (const [statName, statHash] of Object.entries(ARMOR_STAT_HASHES)) {
    const entry = investmentStats.find(s => toU32(s.statTypeHash) === statHash);
    if (entry && entry.value === 10) statBoosts[statName] = 10;
  }
  if (Object.keys(statBoosts).length === 0) continue;

  generalStatMods.push({
    hash: toU32(row.id),
    name: def.displayProperties?.name ?? "",
    plugCat,
    stats: statBoosts,
  });
}

// Group by plugCat
const byPlugCat = new Map();
for (const m of generalStatMods) {
  if (!byPlugCat.has(m.plugCat)) byPlugCat.set(m.plugCat, []);
  byPlugCat.get(m.plugCat).push(m);
}

for (const [cat, mods] of [...byPlugCat.entries()].sort()) {
  console.log(`\n  plugCat="${cat}":`);
  for (const m of mods) {
    console.log(`    hash=${m.hash}  "${m.name}"  stats=${JSON.stringify(m.stats)}`);
  }
}

db.close();

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.resolve(__dirname, "../data/manifest/world.sqlite3"), { readonly: true });
const toU32 = n => n >>> 0;
const toS32 = n => n | 0;

function sockCatName(sockCatHash) {
  const row = db.prepare("SELECT json FROM DestinySocketCategoryDefinition WHERE id = ?").get(toS32(sockCatHash));
  return row ? (JSON.parse(row.json).displayProperties?.name ?? "?") : "?";
}

function sockTypeSummary(sockTypeHash) {
  const row = db.prepare("SELECT json FROM DestinySocketTypeDefinition WHERE id = ?").get(toS32(sockTypeHash));
  if (!row) return "?";
  const def = JSON.parse(row.json);
  const catHash = toU32(def.socketCategoryHash);
  const catName = sockCatName(catHash);
  const plugCats = (def.plugWhitelist ?? []).map(w => w.categoryIdentifier).join(" | ");
  return `sockCat="${catName}" plugCats="${plugCats}"`;
}

// Find Triumphal Anthem Greaves and show all its sockets
const rows = db.prepare(
  "SELECT id, json FROM DestinyInventoryItemDefinition WHERE json LIKE '%Triumphal Anthem%' LIMIT 20"
).all();

for (const row of rows) {
  const def = JSON.parse(row.json);
  if (!def.sockets?.socketEntries?.length) continue;
  console.log(`\n=== ${def.displayProperties?.name ?? "?"} (hash=${toU32(row.id)}) ===`);
  console.log(`  classType=${def.classType}  bucket=${toU32(def.inventory?.bucketTypeHash ?? 0)}`);
  for (let i = 0; i < def.sockets.socketEntries.length; i++) {
    const entry = def.sockets.socketEntries[i];
    const stHash = toU32(entry.socketTypeHash);
    const summary = stHash ? sockTypeSummary(stHash) : "(no sockType)";
    const defaultPlug = entry.singleInitialItemHash ? `defaultPlug=${toU32(entry.singleInitialItemHash)}` : "";
    console.log(`  [${i}] sockType=${stHash}  ${summary}  ${defaultPlug}`);
  }
}

// Also find items with T5 tuning socket (sockType=2581339086) that also have mods socket (sockType=4076485920)
console.log("\n=== DO ANY T5 ARMOR ITEMS ALSO HAVE THE 'mods' SOCKET TYPE (4076485920)? ===");
const T5_TUNING = 2581339086;
const MODS_SOCK = 4076485920;
const T5_TUNING_S32 = toS32(T5_TUNING);
const MODS_SOCK_S32 = toS32(MODS_SOCK);

let foundBoth = 0;
const allRows = db.prepare("SELECT id, json FROM DestinyInventoryItemDefinition WHERE json LIKE '%socketEntries%' LIMIT 10000").all();
for (const row of allRows) {
  let def; try { def = JSON.parse(row.json); } catch { continue; }
  const entries = def.sockets?.socketEntries ?? [];
  const stHashes = entries.map(e => toU32(e.socketTypeHash));
  if (stHashes.includes(T5_TUNING) && stHashes.includes(MODS_SOCK)) {
    foundBoth++;
    if (foundBoth <= 5) {
      console.log(`  ${def.displayProperties?.name} (hash=${toU32(row.id)})`);
    }
  }
}
console.log(`  Total items with BOTH T5 tuning AND 'mods' socket: ${foundBoth}`);

// Show new Tier 5 armor full socket list from a different item that has T5 tuning
console.log("\n=== FULL SOCKET LIST: First T5 armor item with tuning socket ===");
for (const row of allRows) {
  let def; try { def = JSON.parse(row.json); } catch { continue; }
  const entries = def.sockets?.socketEntries ?? [];
  const stHashes = entries.map(e => toU32(e.socketTypeHash));
  if (!stHashes.includes(T5_TUNING)) continue;
  const name = def.displayProperties?.name ?? "";
  if (!name) continue;
  console.log(`\n  Item: "${name}" (hash=${toU32(row.id)}) classType=${def.classType}`);
  for (let i = 0; i < entries.length; i++) {
    const stHash = toU32(entries[i].socketTypeHash);
    const summary = stHash ? sockTypeSummary(stHash) : "(no sockType)";
    const defaultPlug = entries[i].singleInitialItemHash ? `defaultPlug=${toU32(entries[i].singleInitialItemHash)}` : "";
    console.log(`    [${i}] sockType=${stHash}  ${summary}  ${defaultPlug}`);
  }
  break; // just first one
}

db.close();

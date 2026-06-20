import type {
  DestinyInventoryItemDefinition,
  DestinyStatDefinition,
  DestinySocketTypeDefinition,
  DestinySocketCategoryDefinition,
  DestinyManifestComponentName,
  DestinyDefinitionFrom,
} from "bungie-api-ts/destiny2";
import { getManifestDb, hashToSignedInt32 } from "./db";

const statementCache = new Map<string, ReturnType<ReturnType<typeof getManifestDb>["prepare"]>>();

function getStatement(table: DestinyManifestComponentName) {
  let statement = statementCache.get(table);
  if (!statement) {
    statement = getManifestDb().prepare(`SELECT json FROM ${table} WHERE id = ?`);
    statementCache.set(table, statement);
  }
  return statement;
}

/** Generic typed lookup of a single definition by hash from a manifest table. */
export function getDefinition<T extends DestinyManifestComponentName>(
  table: T,
  hash: number
): DestinyDefinitionFrom<T> | undefined {
  const row = getStatement(table).get(hashToSignedInt32(hash)) as { json: string } | undefined;
  if (!row) {
    return undefined;
  }
  return JSON.parse(row.json) as DestinyDefinitionFrom<T>;
}

export function getItemDefinition(hash: number): DestinyInventoryItemDefinition | undefined {
  return getDefinition("DestinyInventoryItemDefinition", hash);
}

export function getStatDefinition(hash: number): DestinyStatDefinition | undefined {
  return getDefinition("DestinyStatDefinition", hash);
}

export function getSocketTypeDefinition(hash: number): DestinySocketTypeDefinition | undefined {
  return getDefinition("DestinySocketTypeDefinition", hash);
}

export function getSocketCategoryDefinition(hash: number): DestinySocketCategoryDefinition | undefined {
  return getDefinition("DestinySocketCategoryDefinition", hash);
}

import { NextResponse } from "next/server";
import { getValidSession } from "@/lib/session/session";
import { ensureManifestUpToDate } from "@/lib/manifest/sync";
import { getProfileWithArmor } from "@/lib/bungie/profile";
import { transformProfileToArmorInventory } from "@/lib/armor/transform";
import type { ArmorSlot, ArmorStats } from "@/lib/armor/types";
import { buildCandidatesBySlot, findItemByInstanceId } from "@/lib/optimizer/candidates";
import { computeOptimizerQuery } from "@/lib/optimizer";
import { zeroVector } from "@/lib/optimizer/vectors";
import { getOptimizerPoolStats } from "@/lib/optimizer/worker-pool";

interface ComputeRequestBody {
  exoticItemInstanceId?: string;
  /** Required when exoticItemInstanceId is omitted (no-exotic mode). */
  classType?: number;
  lockedItemInstanceIds?: Partial<Record<ArmorSlot, string>>;
  thresholds?: ArmorStats;
  masterworkOnly?: boolean;
}

export async function POST(request: Request) {
  const session = await getValidSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json()) as ComputeRequestBody;
  if (!body.exoticItemInstanceId && body.classType === undefined) {
    return NextResponse.json({ error: "exoticItemInstanceId or classType is required" }, { status: 400 });
  }

  const thresholds = body.thresholds ?? zeroVector();
  const masterworkOnly = body.masterworkOnly ?? false;
  const lockedItemInstanceIds = body.lockedItemInstanceIds ?? {};

  await ensureManifestUpToDate();
  const profile = await getProfileWithArmor(session);
  const inventory = transformProfileToArmorInventory(profile);

  const exotic = body.exoticItemInstanceId
    ? findItemByInstanceId(inventory, body.exoticItemInstanceId) ?? null
    : null;

  if (body.exoticItemInstanceId && !exotic) {
    return NextResponse.json({ error: "Exotic item not found in inventory" }, { status: 404 });
  }

  const candidatesBySlot = buildCandidatesBySlot(inventory, exotic, {
    masterworkOnly,
    classType: body.classType,
    lockedItemInstanceIds,
  });

  try {
    const t0 = Date.now();
    const { results, perStatMax, debug: queryDebug } = await computeOptimizerQuery(exotic, candidatesBySlot, { thresholds });
    const elapsedMs = Date.now() - t0;
    const pool = getOptimizerPoolStats();
    return NextResponse.json({
      results,
      perStatMax,
      debug: { elapsedMs, resultCount: results.length, ...queryDebug, pool },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown optimizer error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getValidSession } from "@/lib/session/session";
import { ensureManifestUpToDate } from "@/lib/manifest/sync";
import { getProfileWithArmor } from "@/lib/bungie/profile";
import { transformProfileToArmorInventory } from "@/lib/armor/transform";
import type { ArmorStatName, ArmorStats } from "@/lib/armor/types";
import { buildCandidatesBySlot, findItemByInstanceId } from "@/lib/optimizer/candidates";
import { computeOptimizerQuery } from "@/lib/optimizer";
import { zeroVector } from "@/lib/optimizer/vectors";
import { ARMOR_STAT_ORDER } from "@/styles/theme";

interface ComputeRequestBody {
  exoticItemInstanceId?: string;
  thresholds?: ArmorStats;
  optimizeFor?: ArmorStatName;
}

export async function POST(request: Request) {
  const session = await getValidSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json()) as ComputeRequestBody;
  if (!body.exoticItemInstanceId) {
    return NextResponse.json({ error: "exoticItemInstanceId is required" }, { status: 400 });
  }

  const optimizeFor = body.optimizeFor ?? ARMOR_STAT_ORDER[0];
  if (!ARMOR_STAT_ORDER.includes(optimizeFor)) {
    return NextResponse.json({ error: "Invalid optimizeFor" }, { status: 400 });
  }

  const thresholds = body.thresholds ?? zeroVector();

  await ensureManifestUpToDate();
  const profile = await getProfileWithArmor(session);
  const inventory = transformProfileToArmorInventory(profile);

  const exotic = findItemByInstanceId(inventory, body.exoticItemInstanceId);
  if (!exotic) {
    return NextResponse.json({ error: "Exotic item not found in inventory" }, { status: 404 });
  }

  const candidatesBySlot = buildCandidatesBySlot(inventory, exotic);
  const results = await computeOptimizerQuery(exotic, candidatesBySlot, { thresholds, optimizeFor });

  return NextResponse.json({ results });
}

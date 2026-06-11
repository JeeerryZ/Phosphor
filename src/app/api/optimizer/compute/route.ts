import { NextResponse } from "next/server";
import { getValidSession } from "@/lib/session/session";
import { ensureManifestUpToDate } from "@/lib/manifest/sync";
import { getProfileWithArmor } from "@/lib/bungie/profile";
import { transformProfileToArmorInventory } from "@/lib/armor/transform";
import { buildCandidatesBySlot, findItemByInstanceId } from "@/lib/optimizer/candidates";
import { computeOptimizerResults } from "@/lib/optimizer";

interface ComputeRequestBody {
  exoticItemInstanceId?: string;
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

  await ensureManifestUpToDate();
  const profile = await getProfileWithArmor(session);
  const inventory = transformProfileToArmorInventory(profile);

  const exotic = findItemByInstanceId(inventory, body.exoticItemInstanceId);
  if (!exotic) {
    return NextResponse.json({ error: "Exotic item not found in inventory" }, { status: 404 });
  }

  const candidatesBySlot = buildCandidatesBySlot(inventory, exotic);
  const results = computeOptimizerResults(exotic, candidatesBySlot);

  return NextResponse.json({ results });
}

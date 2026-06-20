import { NextResponse } from "next/server";
import type { ArmorTuning } from "@/lib/armor/tuning";
import { getValidSession } from "@/lib/session/session";
import { transferAndEquipItems, type LoadoutItem } from "@/lib/bungie/loadout";

export interface EquipLoadoutRequest {
  items: LoadoutItem[];
  characterId: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getValidSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as EquipLoadoutRequest;
  const { items, characterId } = body;

  if (!items?.length || !characterId) {
    return NextResponse.json({ error: "Missing items or characterId" }, { status: 400 });
  }

  try {
    await transferAndEquipItems(session.accessToken, {
      items,
      targetCharacterId: characterId,
      destinyMembershipId: session.destinyMembershipId,
      membershipType: session.membershipType,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Equip failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

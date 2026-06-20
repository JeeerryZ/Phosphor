import { NextResponse } from "next/server";
import { getValidSession } from "@/lib/session/session";
import { ensureManifestUpToDate } from "@/lib/manifest/sync";
import { getProfileWithArmor } from "@/lib/bungie/profile";
import { getEquippedFragmentStats } from "@/lib/bungie/fragments";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getValidSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const characterId = new URL(request.url).searchParams.get("characterId");
  if (!characterId) {
    return NextResponse.json({ error: "characterId is required" }, { status: 400 });
  }

  await ensureManifestUpToDate();
  const profile = await getProfileWithArmor(session);
  const stats = getEquippedFragmentStats(profile, characterId);

  if (!stats) {
    return NextResponse.json({ error: "No equipped subclass found for this character" }, { status: 404 });
  }

  return NextResponse.json({ stats });
}

import { NextResponse } from "next/server";
import { ensureManifestUpToDate } from "@/lib/manifest/sync";

export async function GET() {
  await ensureManifestUpToDate();
  return NextResponse.json({ ok: true });
}

export async function POST() {
  await ensureManifestUpToDate();
  return NextResponse.json({ ok: true });
}

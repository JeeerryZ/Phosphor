import { NextResponse } from "next/server";
import { getSession } from "@/lib/session/session";
import { bungieConfig } from "@/lib/bungie/config";

export async function POST() {
  const session = await getSession();
  session.destroy();
  return NextResponse.redirect(new URL("/", bungieConfig.appUrl), { status: 303 });
}

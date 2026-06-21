import { NextResponse } from "next/server";
import { refreshAndSaveSession } from "@/lib/session/session";

/**
 * GET /api/auth/refresh?return=<path>
 *
 * Refreshes the Bungie access token (requires a Route Handler to write cookies),
 * then redirects to `return` (defaults to "/"). If the session is missing or
 * the refresh token has expired, redirects to "/" so the user sees the login page.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const returnTo = searchParams.get("return") ?? "/";

  try {
    const session = await refreshAndSaveSession();
    if (!session) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.redirect(new URL(returnTo, request.url));
  } catch {
    return NextResponse.redirect(new URL("/", request.url));
  }
}

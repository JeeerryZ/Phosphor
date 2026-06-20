import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { exchangeCodeForToken } from "@/lib/bungie/oauth";
import { resolvePrimaryMembership } from "@/lib/bungie/membership";
import { getSession } from "@/lib/session/session";
import { bungieConfig } from "@/lib/bungie/config";
import { OAUTH_STATE_COOKIE } from "../login/route";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const appUrl = bungieConfig.appUrl;
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);

  if (error) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error)}`, appUrl));
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/?error=invalid_state", appUrl));
  }

  const token = await exchangeCodeForToken(code);
  const { destinyMembershipId, membershipType } = await resolvePrimaryMembership(
    token.accessToken
  );

  const session = await getSession();
  session.accessToken = token.accessToken;
  session.refreshToken = token.refreshToken;
  session.accessTokenExpiresAt = token.accessTokenExpiresAt;
  session.refreshTokenExpiresAt = token.refreshTokenExpiresAt;
  session.bungieMembershipId = token.bungieMembershipId;
  session.destinyMembershipId = destinyMembershipId;
  session.membershipType = membershipType;
  await session.save();

  return NextResponse.redirect(new URL("/", appUrl));
}

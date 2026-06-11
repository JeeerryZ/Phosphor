import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, REFRESH_BUFFER_MS } from "@/lib/session/session";
import { refreshAccessToken } from "@/lib/bungie/oauth";
import { sessionConfig } from "@/lib/bungie/config";
import type { SessionData } from "@/lib/session/types";

/**
 * Refreshes the Bungie access token (if it's about to expire) before page
 * requests reach Server Components, where `cookies().set()` is disallowed.
 */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const session = await getIronSession<Partial<SessionData>>(request, response, sessionOptions);

  if (
    !session.accessToken ||
    !session.refreshToken ||
    session.accessTokenExpiresAt === undefined ||
    session.refreshTokenExpiresAt === undefined ||
    session.refreshTokenExpiresAt <= Date.now() ||
    session.accessTokenExpiresAt - Date.now() > REFRESH_BUFFER_MS
  ) {
    return response;
  }

  const refreshed = await refreshAccessToken(session.refreshToken);
  session.accessToken = refreshed.accessToken;
  session.refreshToken = refreshed.refreshToken;
  session.accessTokenExpiresAt = refreshed.accessTokenExpiresAt;
  session.refreshTokenExpiresAt = refreshed.refreshTokenExpiresAt;
  await session.save();

  const refreshedCookie = response.cookies.get(sessionConfig.cookieName);
  const setCookieHeader = response.headers.get("set-cookie");
  if (!refreshedCookie || !setCookieHeader) {
    return response;
  }

  // Mirror the refreshed cookie onto the request so this request's Server
  // Components see the new tokens, and onto the response so the browser does too.
  request.cookies.set(sessionConfig.cookieName, refreshedCookie.value);
  const forwardedResponse = NextResponse.next({ request: { headers: request.headers } });
  forwardedResponse.headers.set("set-cookie", setCookieHeader);
  return forwardedResponse;
}

export const config = {
  matcher: ["/inventory/:path*", "/optimizer/:path*"],
};

import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { sessionConfig } from "../bungie/config";
import { refreshAccessToken } from "../bungie/oauth";
import type { SessionData } from "./types";

export const REFRESH_BUFFER_MS = 60_000;

export const sessionOptions: SessionOptions = {
  cookieName: sessionConfig.cookieName,
  password: sessionConfig.secret,
  cookieOptions: {
    secure: true,
    sameSite: "lax",
    httpOnly: true,
  },
};

/** Returns the raw (possibly empty) session for the current request. */
export async function getSession(): Promise<IronSession<Partial<SessionData>>> {
  const cookieStore = await cookies();
  return getIronSession<Partial<SessionData>>(cookieStore, sessionOptions);
}

/**
 * Returns the session if a valid (non-expired) access token exists.
 * Safe to call from Server Components — does NOT write cookies.
 * Returns null if no session, refresh token has expired, or the access
 * token is within REFRESH_BUFFER_MS of expiring (caller should redirect
 * to /api/auth/refresh to get a fresh token before proceeding).
 */
export async function getValidSession(): Promise<IronSession<SessionData> | null> {
  const session = await getSession();

  if (!session.accessToken || !session.refreshToken) {
    return null;
  }

  const data = session as IronSession<SessionData>;

  if (data.refreshTokenExpiresAt <= Date.now()) {
    return null;
  }

  if (data.accessTokenExpiresAt - Date.now() <= REFRESH_BUFFER_MS) {
    return null; // signal to caller to redirect to /api/auth/refresh
  }

  return data;
}

/**
 * Refreshes the access token and saves the updated session. Must only be
 * called from a Route Handler or Server Action (Next.js cookie write restriction).
 * Returns the updated session, or null if the refresh token has expired.
 */
export async function refreshAndSaveSession(): Promise<IronSession<SessionData> | null> {
  const session = await getSession();

  if (!session.accessToken || !session.refreshToken) {
    return null;
  }

  const data = session as IronSession<SessionData>;

  if (data.refreshTokenExpiresAt <= Date.now()) {
    await session.destroy();
    return null;
  }

  const refreshed = await refreshAccessToken(data.refreshToken);
  data.accessToken = refreshed.accessToken;
  data.refreshToken = refreshed.refreshToken;
  data.accessTokenExpiresAt = refreshed.accessTokenExpiresAt;
  data.refreshTokenExpiresAt = refreshed.refreshTokenExpiresAt;
  await data.save();

  return data;
}

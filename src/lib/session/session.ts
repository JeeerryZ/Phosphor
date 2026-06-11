import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { sessionConfig } from "../bungie/config";
import { refreshAccessToken } from "../bungie/oauth";
import type { SessionData } from "./types";

const REFRESH_BUFFER_MS = 60_000;

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
 * Returns a session with a guaranteed-valid access token, refreshing it
 * (and persisting the refreshed tokens) if it's about to expire. Returns
 * null if there's no session or the refresh token has expired.
 */
export async function getValidSession(): Promise<IronSession<SessionData> | null> {
  const session = await getSession();

  if (!session.accessToken || !session.refreshToken) {
    return null;
  }

  const data = session as IronSession<SessionData>;

  if (data.refreshTokenExpiresAt <= Date.now()) {
    session.destroy();
    return null;
  }

  if (data.accessTokenExpiresAt - Date.now() <= REFRESH_BUFFER_MS) {
    const refreshed = await refreshAccessToken(data.refreshToken);
    data.accessToken = refreshed.accessToken;
    data.refreshToken = refreshed.refreshToken;
    data.accessTokenExpiresAt = refreshed.accessTokenExpiresAt;
    data.refreshTokenExpiresAt = refreshed.refreshTokenExpiresAt;
    await data.save();
  }

  return data;
}

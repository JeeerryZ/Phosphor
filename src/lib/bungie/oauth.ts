import {
  bungieConfig,
  BUNGIE_OAUTH_AUTHORIZE_URL,
  BUNGIE_OAUTH_TOKEN_URL,
} from "./config";

interface BungieTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  membership_id: string;
}

export interface TokenResult {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  bungieMembershipId: string;
}

function tokenResponseToResult(token: BungieTokenResponse): TokenResult {
  const now = Date.now();
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    accessTokenExpiresAt: now + token.expires_in * 1000,
    refreshTokenExpiresAt: now + token.refresh_expires_in * 1000,
    bungieMembershipId: token.membership_id,
  };
}

export function buildAuthorizeUrl(state: string): string {
  const url = new URL(BUNGIE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", bungieConfig.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", bungieConfig.oauthRedirectUri);
  return url.toString();
}

async function requestToken(body: Record<string, string>): Promise<TokenResult> {
  const response = await fetch(BUNGIE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-API-Key": bungieConfig.apiKey,
    },
    body: new URLSearchParams(body).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bungie OAuth token request failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as BungieTokenResponse;
  return tokenResponseToResult(json);
}

export function exchangeCodeForToken(code: string): Promise<TokenResult> {
  return requestToken({
    grant_type: "authorization_code",
    code,
    client_id: bungieConfig.clientId,
    client_secret: bungieConfig.clientSecret,
  });
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResult> {
  return requestToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: bungieConfig.clientId,
    client_secret: bungieConfig.clientSecret,
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const bungieConfig = {
  get apiKey() {
    return requireEnv("BUNGIE_API_KEY");
  },
  get clientId() {
    return requireEnv("BUNGIE_CLIENT_ID");
  },
  get clientSecret() {
    return requireEnv("BUNGIE_CLIENT_SECRET");
  },
  get oauthRedirectUri() {
    return requireEnv("BUNGIE_OAUTH_REDIRECT_URI");
  },
  get appUrl() {
    return requireEnv("NEXT_PUBLIC_APP_URL");
  },
};

export const sessionConfig = {
  get secret() {
    return requireEnv("SESSION_SECRET");
  },
  get cookieName() {
    return process.env.SESSION_COOKIE_NAME || "phosphor-session";
  },
};

export const BUNGIE_BASE_URL = "https://www.bungie.net";
export const BUNGIE_OAUTH_AUTHORIZE_URL = `${BUNGIE_BASE_URL}/en/oauth/authorize`;
export const BUNGIE_OAUTH_TOKEN_URL = `${BUNGIE_BASE_URL}/Platform/App/OAuth/Token/`;

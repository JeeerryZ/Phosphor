import type { HttpClient, HttpClientConfig } from "bungie-api-ts/http";
import { bungieConfig } from "./config";

/**
 * Builds a bungie-api-ts HttpClient. Always sends X-API-Key; when an access
 * token is provided, also sends Authorization: Bearer for authenticated
 * endpoints (e.g. GetProfile, GetMembershipDataForCurrentUser).
 */
export function createBungieClient(accessToken?: string): HttpClient {
  return async <Return>(config: HttpClientConfig): Promise<Return> => {
    const url = new URL(config.url);

    if (config.params) {
      for (const [key, value] of Object.entries(config.params)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      "X-API-Key": bungieConfig.apiKey,
    };

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    let body: BodyInit | undefined;
    if (config.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(config.body);
    }

    const response = await fetch(url.toString(), {
      method: config.method,
      headers,
      body,
    });

    if (!response.ok) {
      throw new Error(`Bungie API request failed: ${config.method} ${url.pathname} -> ${response.status}`);
    }

    return (await response.json()) as Return;
  };
}

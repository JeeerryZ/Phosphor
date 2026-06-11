import type { BungieMembershipType } from "bungie-api-ts/destiny2";

export interface SessionData {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number; // epoch ms
  refreshTokenExpiresAt: number; // epoch ms
  bungieMembershipId: string;
  destinyMembershipId: string;
  membershipType: BungieMembershipType;
}

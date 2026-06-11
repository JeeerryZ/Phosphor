import { getMembershipDataForCurrentUser } from "bungie-api-ts/user";
import type { BungieMembershipType } from "bungie-api-ts/destiny2";
import { createBungieClient } from "./client";

export interface PrimaryDestinyMembership {
  destinyMembershipId: string;
  membershipType: BungieMembershipType;
}

/**
 * Resolves the player's primary Destiny membership for the authenticated
 * user, accounting for cross save (the membership whose crossSaveOverride
 * points back at itself, or the first one if cross save isn't active).
 */
export async function resolvePrimaryMembership(
  accessToken: string
): Promise<PrimaryDestinyMembership> {
  const http = createBungieClient(accessToken);
  const response = await getMembershipDataForCurrentUser(http);
  const memberships = response.Response.destinyMemberships;

  if (memberships.length === 0) {
    throw new Error("No Destiny memberships found for this Bungie account");
  }

  const primary =
    memberships.find((m) => m.crossSaveOverride === m.membershipType) ?? memberships[0];

  return {
    destinyMembershipId: primary.membershipId,
    membershipType: primary.membershipType,
  };
}

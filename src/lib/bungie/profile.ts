import { getProfile, type DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { createBungieClient } from "./client";
import type { SessionData } from "../session/types";

// DestinyComponentType is a `const enum`, which can't be imported as a value
// under isolatedModules - using the documented numeric values directly.
const COMPONENT_PROFILE_INVENTORIES = 102;
const COMPONENT_CHARACTERS = 200;
const COMPONENT_CHARACTER_INVENTORIES = 201;
const COMPONENT_CHARACTER_EQUIPMENT = 205;
const COMPONENT_ITEM_INSTANCES = 300;
const COMPONENT_ITEM_STATS = 304;
const COMPONENT_ITEM_SOCKETS = 305;
const COMPONENT_ITEM_REUSABLE_PLUGS = 310;

/** Fetches the player's profile with the components needed to render armor inventory. */
export async function getProfileWithArmor(session: SessionData): Promise<DestinyProfileResponse> {
  const http = createBungieClient(session.accessToken);
  const { Response } = await getProfile(http, {
    destinyMembershipId: session.destinyMembershipId,
    membershipType: session.membershipType,
    components: [
      COMPONENT_PROFILE_INVENTORIES,
      COMPONENT_CHARACTERS,
      COMPONENT_CHARACTER_INVENTORIES,
      COMPONENT_CHARACTER_EQUIPMENT,
      COMPONENT_ITEM_INSTANCES,
      COMPONENT_ITEM_STATS,
      COMPONENT_ITEM_SOCKETS,
      COMPONENT_ITEM_REUSABLE_PLUGS,
    ],
  });
  return Response;
}

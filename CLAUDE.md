# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` - start the Next.js dev server (must be accessed via the ngrok tunnel, not localhost - see "Local development" below)
- `npm run build` - production build
- `npm run start` - run a production build
- `npm run lint` - ESLint (flat config, `eslint-config-next` core-web-vitals + typescript)

There is no test suite configured in this project.

## Local development

Bungie OAuth requires an HTTPS redirect URI that exactly matches the one registered in the Bungie
application portal, so the app must be accessed through an ngrok static domain, not `localhost`.
Required env vars (in `.env.local`): `BUNGIE_API_KEY`, `BUNGIE_CLIENT_ID`, `BUNGIE_CLIENT_SECRET`,
`BUNGIE_OAUTH_REDIRECT_URI`, `NEXT_PUBLIC_APP_URL`, `SESSION_SECRET`. See README.md for full setup.

## Architecture

This is a Destiny 2 armor optimizer (Next.js App Router + Tailwind + Framer Motion/`motion`), in the
spirit of d2armorpicker/d2armorgenius, with planned support for the Tier 5 stat-tuning mechanic
(moving 5 points between armor stats). Currently in Phase 1: auth, manifest sync, and a read-only
armor inventory view. Phase 2+ will add the optimization engine, stat-tuning UI, and build/loadout
saving.

### Request flow: profile -> armor inventory

1. `src/lib/session/session.ts` (`getValidSession`) reads the encrypted iron-session cookie, refreshing
   the Bungie access token via `lib/bungie/oauth.ts` if it's within `REFRESH_BUFFER_MS` of expiring.
2. `src/lib/bungie/profile.ts` (`getProfileWithArmor`) calls Bungie's `GetProfile` with a fixed set of
   components (profile/character inventories+equipment, item instances, stats, sockets).
3. `src/lib/armor/transform.ts` (`transformProfileToArmorInventory`) joins the raw profile response
   with manifest item definitions (`lib/manifest/definitions.ts`) into `ArmorInventory` (`vault` +
   per-character arrays of `ArmorItem`), deriving slot, stats, power, masterwork status, and Tier 5
   tuning state per item.
4. `src/lib/armor/tuning.ts` decodes Tier 5 "Stat Tuning" socket plugs into a directional
   increase/decrease stat pair (or balanced/empty/none).

### Manifest cache

The Destiny 2 manifest (item/stat/socket definitions) is cached as a SQLite DB at
`data/manifest/world.sqlite3` (gitignored, regenerated on demand).

- `lib/manifest/sync.ts` (`ensureManifestUpToDate`) checks the manifest version via
  `getDestinyManifest`, and if stale/missing, downloads and unzips the English mobile world content
  into the cache (atomic rename via a `.tmp` file).
- `lib/manifest/db.ts` opens a singleton read-only `better-sqlite3` connection. Bungie hashes are
  unsigned 32-bit ints but stored as signed 32-bit ints in the manifest tables -
  `hashToSignedInt32` converts before querying.
- `lib/manifest/definitions.ts` provides cached prepared-statement lookups
  (`getItemDefinition`, `getStatDefinition`, `getSocketTypeDefinition`) keyed by hash.
- `/api/manifest/sync` (GET/POST) triggers `ensureManifestUpToDate`.

### Auth

- `lib/bungie/config.ts` centralizes env-var access via `requireEnv` (throws if missing) -
  `bungieConfig` for Bungie API/OAuth settings, `sessionConfig` for the session cookie.
- `lib/bungie/oauth.ts` builds the Bungie authorize URL and exchanges/refreshes tokens.
- `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout` implement the OAuth flow; the callback
  also resolves the player's primary Destiny membership (`lib/bungie/membership.ts`, accounting for
  cross save) and stores everything in `SessionData` (`lib/session/types.ts`).
- `lib/bungie/client.ts` (`createBungieClient`) builds a `bungie-api-ts` `HttpClient` that always sends
  `X-API-Key` and optionally `Authorization: Bearer` for authenticated calls.

### Armor stat/slot identity

`lib/armor/types.ts` defines the canonical stat hashes (`ARMOR_STAT_HASHES`) and armor bucket hashes
(`ARMOR_BUCKET_HASHES`) used throughout - these are stable Destiny 2 hashes, not derived from the
manifest. Vault items report the General Vault bucket as their `bucketHash`, so slot is derived from
the item definition's `inventory.bucketTypeHash` instead (see `transform.ts`).

### Path aliases

`@/*` maps to `src/*` (see `tsconfig.json`).

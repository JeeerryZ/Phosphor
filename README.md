# Set Builder

A Destiny 2 armor optimizer (Next.js + Tailwind + Framer Motion), built in the spirit of
[d2armorpicker.com](https://d2armorpicker.com/) and [d2armorgenius.com](https://www.d2armorgenius.com/),
with planned support for the Tier 5 armor stat-tuning mechanic (moving 5 points between stats).

## Prerequisites

- Node.js 18+
- A Bungie.net Developer application (Confidential type) - https://www.bungie.net/en/Application
- [ngrok](https://ngrok.com/) with a static domain (required because the Bungie OAuth redirect must be
  an HTTPS URL, and Bungie validates it against an exact registered Redirect URL)

## Bungie application setup

1. Go to https://www.bungie.net/en/Application and create (or edit) an application.
2. **OAuth Client Type** must be **Confidential** (this is required to receive a `refresh_token` and to
   use a `client_secret` in the token exchange).
3. Set the **Redirect URL** to your ngrok static domain + `/api/auth/callback`, e.g.:
   ```
   https://your-static-domain.ngrok-free.app/api/auth/callback
   ```
   This must match `BUNGIE_OAUTH_REDIRECT_URI` in `.env.local` **exactly**.
4. Note your **API Key**, **OAuth client_id**, and **OAuth client_secret**.

## Environment variables

Copy `.env.example` to `.env.local` (already done if you're reading this after initial setup) and fill
in:

- `BUNGIE_API_KEY`, `BUNGIE_CLIENT_ID`, `BUNGIE_CLIENT_SECRET` - from your Bungie application.
- `BUNGIE_OAUTH_REDIRECT_URI` - your ngrok domain + `/api/auth/callback`.
- `NEXT_PUBLIC_APP_URL` - your ngrok domain (same as above, without the path).
- `SESSION_SECRET` - a random 32+ byte secret used to encrypt the session cookie. Generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

## Running locally with ngrok

Because Bungie's OAuth requires an HTTPS redirect URI that exactly matches what's registered in the
application portal, you must access the dev server through your ngrok tunnel - **not** `localhost`.

1. Start the dev server:
   ```bash
   npm run dev
   ```
2. In another terminal, start ngrok pointing at the dev server's port (default 3000) using your static
   domain:
   ```bash
   ngrok http --domain=your-static-domain.ngrok-free.app 3000
   ```
3. Open `https://your-static-domain.ngrok-free.app` in your browser and click **Login with Bungie**.

## Manifest cache

On first use, the app downloads and caches Destiny 2's manifest database (item/stat/socket
definitions) into `data/manifest/`. This directory is gitignored and regenerated automatically; the
first manifest-dependent request may take a few extra seconds while it downloads (~30-50MB).

## Project structure

- `src/app` - routes, pages, and API route handlers (auth, manifest sync)
- `src/lib/bungie` - Bungie API client, OAuth, config
- `src/lib/session` - encrypted session handling (iron-session)
- `src/lib/manifest` - Destiny 2 manifest download/cache/query layer
- `src/lib/armor` - armor domain types and Bungie-profile-to-armor transforms
- `src/components` - UI components (design system, auth, inventory)

## Roadmap

This is Phase 1 (foundation): auth, manifest, and a basic armor inventory view. Phase 2+ will add the
armor optimization engine, the Tier 5 stat-tuning system, and build/loadout saving.

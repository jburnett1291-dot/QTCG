# QTCG — Railway-only deployment

This folder is intentionally a single Python service. It serves the already
compiled web client and the API from the same Railway domain, so no local
computer, Replit server, or second frontend service is required.

## Deploy

1. Push the **contents of this folder** to the GitHub repository you connect to
   Railway. Do not push the outer `QTCG-main` directory as the Railway root.
2. Create one Railway service from that repository.
3. Railway will detect `Dockerfile`. The service listens on Railway's `PORT`.
4. After the first deploy, check:

   `https://YOUR-RAILWAY-DOMAIN/api/health`

   It should return JSON with `"ok": true`.

## Required Railway variables

Set these in the service's Variables tab. Never commit the values.

| Variable | Value |
|---|---|
| `DISCORD_CLIENT_ID` | Discord application/client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth2 client secret |
| `GITHUB_TOKEN` | Fine-grained GitHub token with read/write Contents access |
| `GITHUB_REPO` | `owner/repository` containing the shared save and card files |
| `GITHUB_BRANCH` | `main` unless the data is on another branch |
| `OWNER_ID` | Discord user ID allowed commissioner/owner access |
| `QCL_SIGNING_SECRET` | Long random string used to sign sessions |

Optional variables:

| Variable | Default |
|---|---|
| `SAVE_PATH` | `fantasy_save.json` |
| `POOL_PATH` | `fantasy_market.json` |
| `DRAFT_PATH` | `qcl_draft_activity.json` |
| `PACK_COST` | `10` |
| `DRAFT_ADMIN_IDS` | `OWNER_ID` |

Do not set `PORT` manually; Railway injects it.

## Discord OAuth settings

The backend exchanges the Discord Activity authorization code using the
redirect URI `https://127.0.0.1`, so that exact URI must remain in the Discord
Developer Portal OAuth2 redirect list. The client ID and secret in Railway
must belong to the same Discord application.

## What was fixed

- Removed the nested `QTCG/` source tree and invalid Replit-only
  `catalog:`/`workspace:*` Node dependencies from the deploy root.
- Added a Docker build so Railway does not try to build the incomplete
  frontend source tree.
- Made static files resolve from the server's real directory instead of the
  process working directory.
- Added SPA entry routes for `/warroom`, `/coach`, `/director`, `/draft`, and
  `/war-room`.
- Rewrote the stale hard-coded frontend API host to same-origin for normal
  Railway visits. Discord-hosted visits retain the Discord proxy path.
- Added Railway health checking at `/api/health`.
- Removed the duplicate Python process entry point.

## Verify after deployment

Open these in order:

1. `/api/health`
2. `/api/diag` — confirms GitHub read/write configuration
3. `/` — public app shell
4. `/warroom/war-room` — draft room

If `/api/diag` reports a GitHub write failure, the token is valid for reading
but does not have write access to the repository contents.
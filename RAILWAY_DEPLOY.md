# QTCG Railway deployment

This is a single Railway service. It serves the compiled frontend and the
Python API from the same hostname.

## Deploy

Put the contents of this folder at the root of the GitHub repository connected
to Railway. Do not keep an extra `QTCG-main/` directory above these files.

Railway will detect the Dockerfile. Do not manually set `PORT`.

Check the deployment with:

```text
https://YOUR-RAILWAY-DOMAIN/api/health
https://YOUR-RAILWAY-DOMAIN/
https://YOUR-RAILWAY-DOMAIN/warroom/war-room
```

## Required variables

Set these in Railway Variables:

```text
DISCORD_CLIENT_ID=your_discord_application_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
GITHUB_TOKEN=your_github_contents_token
GITHUB_REPO=owner/repository
GITHUB_BRANCH=main
OWNER_ID=your_discord_user_id
QCL_SIGNING_SECRET=stable_random_session_signing_secret
```

Optional:

```text
SAVE_PATH=fantasy_save.json
POOL_PATH=fantasy_market.json
DRAFT_PATH=qcl_draft_activity.json
PACK_COST=10
DRAFT_ADMIN_IDS=your_discord_user_id
```

The GitHub token must have Contents read/write permission because player saves
and draft state are written to the repository.

The current backend exchanges Discord authorization codes with the redirect
URI `https://127.0.0.1`; keep that exact URI in the Discord Developer Portal.

## Changes made

- Replaced the Railpack/Nixpacks setup with a deterministic Docker build.
- Pinned the Python dependency.
- Changed `/` from a health response to the actual frontend.
- Added SPA routes for `/war-room`, `/warroom`, `/coach`, `/director`, and
  `/draft`.
- Added `/api/health` as the Railway health check.
- Made static paths independent of Railway's working directory.
- Removed the old hard-coded frontend API hostname at response time so direct
  Railway visits use same-origin API calls.
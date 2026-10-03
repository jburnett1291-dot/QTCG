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
QCL_ARCHIVE_FOLDER_ID=google_drive_archive_folder_id
```

Optional:

```text
SAVE_PATH=fantasy_save.json
POOL_PATH=fantasy_market.json
DRAFT_PATH=qcl_draft_activity.json
PACK_COST=10
DRAFT_ADMIN_IDS=your_discord_user_id
QCL_ACTIVE_FOLDER_ID=google_drive_active_workbooks_folder_id
```

Store `GOOGLE_SERVICE_ACCOUNT_JSON` (or `GOOGLE_SERVICE_ACCOUNT_JSON_B64`) as a
private Railway variable. Never commit the service-account document. Share the
active QCL workbook and the archive folder with that service account. The
archive folder must be on the same Shared Drive as the workbook; grant it
permission to edit the workbook, create files in the active folder, and move
the closed workbook into the archive folder. `QCL_ACTIVE_FOLDER_ID` is optional;
when omitted, the next workbook is created beside the current one.

The GitHub token must have Contents read/write access to both the repository
named by `GITHUB_REPO` (QTCG Activity saves and draft state) and
`jburnett1291-dot/QCL` (season CSVs and `qcl_season_config.json`). Keep
`GITHUB_REPO` pointed at the QTCG Activity repository; the season API targets
QCL separately.

## QCL Streamlit hub and season rollover

The original QCL Streamlit app is served at `/qcl` from the QCL source commit
pinned by `QCL_SOURCE_REF` in the Dockerfile. QTCG runs it as a private local
process and proxies its HTTP and WebSocket traffic through the same hostname.
Its sidebar, styles, pages, and interactions therefore come from the QCL source
app rather than a separate QTCG reimplementation. When QCL's `main` changes,
update `QCL_SOURCE_REF` to the new commit and redeploy QTCG.

The domain root now opens `/qcl-home`, a QCL-styled frame around the original
Streamlit app. The QTCG Main Hub is no longer the default page. QTCG Activity is
still available at `/activity`, linked from the QCL header. Season
administration remains at `/qcl-admin`, reachable from the QCL header rather
than as a second primary navigation entry. Open the Activity on the same
hostname first to establish its signed session; the admin page reuses that
session and does not add a second login. The season-close action is limited to
IDs in `DRAFT_ADMIN_IDS`.

For QCL's optional Discord login, register
`https://<RAILWAY_PUBLIC_DOMAIN>/qcl/` as an OAuth redirect URI in the Discord
Developer Portal. The app derives this callback from Railway's public-domain
variable. Set `QCL_STREAMLIT_REDIRECT_URI` in Railway if you use a different
custom domain or need to override the callback.

The public QCL repository contains `qcl_season_config.json`. It starts with
2K26 Season One as the active workbook and 2K27 Season One as the next
workbook. Closing a season commits its CSV snapshot to QCL, archives the
closed workbook in Drive, and creates a fresh workbook for the configured next
edition and season. Later closures increment the season number.

The embedded app reads stats through QTCG's internal
`/api/qcl/public-data` endpoint. This public read-only endpoint returns only the
active `Raw Data` tab. Drive copies do not retain the original workbook's
file-level sharing, so this avoids making the entire workbook—and its Registry
tab—public. The QCL app keeps its direct CSV feed as a legacy fallback when the
internal endpoint is not configured.

Keep the `Raw Data` header row intact and include distinct `Game Edition` and
`Season` columns. The close action validates that all populated rows match the
active edition and season before it changes Drive files or the config. The
Registry tab is not cleared.

For deployment checks, also open:

```text
https://YOUR-RAILWAY-DOMAIN/
https://YOUR-RAILWAY-DOMAIN/activity
https://YOUR-RAILWAY-DOMAIN/qcl
https://YOUR-RAILWAY-DOMAIN/qcl-home
https://YOUR-RAILWAY-DOMAIN/qcl-admin
https://YOUR-RAILWAY-DOMAIN/api/qcl/seasons/status
```

The status API requires a signed Activity session. If it reports missing
configuration, add the listed Railway variables before closing a season.

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

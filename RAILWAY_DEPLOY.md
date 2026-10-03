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

The season API reads only the configured `Raw Data` CSV export from the
existing QCL spreadsheet. It does not need a Google service-account JSON,
Google API credentials, or Drive folder IDs. Keep the `Raw Data` CSV export
readable and keep the workbook's private `Registry` tab private; the API never
reads or returns that tab. The QCL bot continues writing through its existing
Sheet workflow.

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

The public QCL repository contains `qcl_season_config.json` and the CSV season
archives. Closing a season first commits the current CSV snapshot to QCL and
records a pending rollover. The commissioner then clears populated rows below
the header in the same `Raw Data` sheet; the Sheet URL and header remain
unchanged. The admin page links to that tab and verifies the export has no data
rows before it advances the active and next season settings. If the archive
write fails, the sheet is not cleared or advanced.

The embedded app reads stats through QTCG's internal
`/api/qcl/public-data` endpoint. This public read-only endpoint returns only the
active `Raw Data` CSV export. It does not expose the workbook or its Registry
tab. The QCL app keeps its direct CSV feed as a legacy fallback when the
internal endpoint is not configured.

Keep the `Raw Data` header row intact and include distinct `Game Edition` and
`Season` columns. The archive action checks that populated rows match the
active edition and season. Blank `Player/Team` and `Type` cells are preserved
because they occur in valid rows displayed by the QCL source app.

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

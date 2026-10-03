"""QCL season data and commissioner-only close/archive handlers."""

from __future__ import annotations

import asyncio
import base64
import csv
import hashlib
import io
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote, urlencode


PUBLIC_QCL_REPO = "jburnett1291-dot/QCL"
SEASON_CONFIG_PATH = "qcl_season_config.json"
ARCHIVE_ROOT = "archives/seasons"
GOOGLE_SCOPES = (
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
)
REQUIRED_COLUMNS = (
    "Player/Team",
    "Team Name",
    "Type",
    "Game_ID",
    "Season",
    "Game Edition",
)
MAX_ACTIVITY_ROWS = 5000
DATA_CACHE_SECONDS = 30
_DATA_CACHE = {}
_ROLE_CACHE = {}


_SEASON_WORDS = {
    1: "One",
    2: "Two",
    3: "Three",
    4: "Four",
    5: "Five",
    6: "Six",
    7: "Seven",
    8: "Eight",
    9: "Nine",
    10: "Ten",
    11: "Eleven",
    12: "Twelve",
    13: "Thirteen",
    14: "Fourteen",
    15: "Fifteen",
    16: "Sixteen",
    17: "Seventeen",
    18: "Eighteen",
    19: "Nineteen",
    20: "Twenty",
}


class SeasonError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def season_label(number):
    number = int(number)
    if number < 1:
        raise ValueError("Season number must be positive.")
    return f"QCL Season {_SEASON_WORDS.get(number, str(number))}"


def slugify(value):
    value = str(value or "").strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "season"


def csv_text(headers, rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(headers)
    for row in rows:
        writer.writerow([row.get(header, "") for header in headers])
    return output.getvalue()


def rows_as_dicts(values):
    if not values:
        return [], []
    headers = [str(value or "").strip() for value in values[0]]
    if not headers or not any(headers):
        raise SeasonError("The QCL sheet has no header row.", 422)
    rows = []
    for source_row in values[1:]:
        cells = list(source_row or [])
        if not any(str(value or "").strip() for value in cells):
            continue
        row = {}
        for index, header in enumerate(headers):
            if header:
                row[header] = cells[index] if index < len(cells) else ""
        rows.append(row)
    return headers, rows


def validate_season_rows(headers, rows, active):
    missing = [column for column in REQUIRED_COLUMNS if column not in headers]
    if missing:
        raise SeasonError(
            "The sheet is missing required columns: " + ", ".join(missing), 422
        )
    if not rows:
        raise SeasonError("There are no game rows to archive.", 422)

    edition = str(active.get("game_edition") or "").strip()
    season_number = int(active.get("season_number") or 0)
    if not edition or season_number < 1:
        raise SeasonError("The active season configuration is incomplete.", 409)

    for index, row in enumerate(rows, start=2):
        for field in ("Player/Team", "Team Name", "Type", "Game_ID"):
            if not str(row.get(field) or "").strip():
                raise SeasonError(
                    f"Row {index} has a blank {field} value. No archive was written.",
                    409,
                )
        row_edition = str(row.get("Game Edition") or "").strip()
        if row_edition != edition:
            raise SeasonError(
                f"Row {index} has Game Edition {row_edition or '(blank)'}, "
                f"but the active season is {edition}. No archive was written.",
                409,
            )
        raw_season = str(row.get("Season") or "").strip()
        try:
            row_season = int(float(raw_season))
        except (TypeError, ValueError):
            raise SeasonError(
                f"Row {index} has a blank or invalid Season value. No archive was written.",
                409,
            )
        if row_season != season_number:
            raise SeasonError(
                f"Row {index} belongs to Season {row_season}, not the active "
                f"Season {season_number}. No archive was written.",
                409,
            )
    return edition, season_number


def column_letter(zero_based_index):
    number = int(zero_based_index) + 1
    output = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        output = chr(65 + remainder) + output
    return output


def _json_response(web, cors, payload, status=200):
    return cors(web.json_response(payload, status=status))


def create_handlers(*, github_repo, github_token, session_reader, admin_check, cors):
    """Build aiohttp handlers without coupling this module to server.py globals."""
    from aiohttp import web

    close_lock = asyncio.Lock()

    async def _github_file(session, path, branch="main"):
        if not github_token:
            raise SeasonError("The QTCG service is missing its GitHub token.", 503)
        branch = os.environ.get("GITHUB_BRANCH", branch)
        encoded_path = quote(path, safe="/")
        url = (
            f"https://api.github.com/repos/{github_repo}/contents/{encoded_path}"
            f"?ref={quote(branch, safe='')}"
        )
        headers = {
            "Authorization": f"token {github_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        async with session.get(url, headers=headers) as response:
            if response.status == 404:
                return None, None
            if response.status != 200:
                detail = (await response.text())[:300]
                raise SeasonError(
                    f"GitHub read failed for {path} (HTTP {response.status}): {detail}",
                    502,
                )
            payload = await response.json()
            raw = base64.b64decode(payload.get("content", "")).decode("utf-8")
            return raw, payload.get("sha")

    async def _github_json(session, path=SEASON_CONFIG_PATH):
        raw, sha = await _github_file(session, path)
        if raw is None:
            raise SeasonError(
                f"{path} has not been initialized in the QCL repository.", 503
            )
        try:
            payload = json.loads(raw)
        except ValueError as exc:
            raise SeasonError(f"{path} is not valid JSON.", 500) from exc
        if not isinstance(payload, dict):
            raise SeasonError(f"{path} must contain a JSON object.", 500)
        return payload, sha

    async def _github_put(session, path, text, sha, message):
        if not github_token:
            raise SeasonError("The QTCG service is missing its GitHub token.", 503)
        encoded_path = quote(path, safe="/")
        url = f"https://api.github.com/repos/{github_repo}/contents/{encoded_path}"
        headers = {
            "Authorization": f"token {github_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        body = {
            "message": message,
            "content": base64.b64encode(text.encode("utf-8")).decode("ascii"),
            "branch": os.environ.get("GITHUB_BRANCH", "main"),
        }
        if sha:
            body["sha"] = sha
        async with session.put(url, headers=headers, json=body) as response:
            if response.status not in (200, 201):
                detail = (await response.text())[:400]
                status = 409 if response.status in (409, 422) else 502
                raise SeasonError(
                    f"GitHub write failed for {path} (HTTP {response.status}): {detail}",
                    status,
                )
            return await response.json()

    async def _google_token():
        json_secret = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
        base64_secret = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON_B64", "").strip()
        secret = json_secret or base64_secret
        if not secret:
            raise SeasonError(
                "The QTCG service account is not configured. Add "
                "GOOGLE_SERVICE_ACCOUNT_JSON to the Railway secrets.",
                503,
            )
        try:
            if not json_secret and base64_secret:
                secret = base64.b64decode(base64_secret).decode("utf-8")
            info = json.loads(secret)
            from google.auth.transport.requests import Request as GoogleAuthRequest
            from google.oauth2 import service_account

            credentials = service_account.Credentials.from_service_account_info(
                info, scopes=list(GOOGLE_SCOPES)
            )
            await asyncio.to_thread(credentials.refresh, GoogleAuthRequest())
            if not credentials.token:
                raise ValueError("No access token was issued.")
            return credentials.token
        except SeasonError:
            raise
        except Exception as exc:
            raise SeasonError(
                "The Google service account could not authenticate. Check the "
                "Railway secret and the service account's spreadsheet/Drive access.",
                503,
            ) from exc

    async def _google_request(session, token, method, url, *, params=None, body=None):
        headers = {"Authorization": f"Bearer {token}"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        async with session.request(
            method, url, headers=headers, params=params, json=body
        ) as response:
            text = await response.text()
            if response.status < 200 or response.status >= 300:
                try:
                    payload = json.loads(text)
                    detail = payload.get("error", {}).get("message", text)
                except ValueError:
                    detail = text
                raise SeasonError(
                    f"Google API request failed (HTTP {response.status}): "
                    f"{str(detail)[:350]}",
                    502,
                )
            if not text:
                return {}
            try:
                return json.loads(text)
            except ValueError as exc:
                raise SeasonError("Google API returned invalid JSON.", 502) from exc

    async def _sheet_values(session, token, spreadsheet_id, tab):
        a1 = quote(f"'{tab.replace(chr(39), chr(39) * 2)}'!A1:AZ62945", safe="")
        url = (
            "https://sheets.googleapis.com/v4/spreadsheets/"
            + quote(str(spreadsheet_id), safe="")
            + "/values/"
            + a1
        )
        payload = await _google_request(
            session,
            token,
            "GET",
            url,
            params={"valueRenderOption": "FORMATTED_VALUE", "majorDimension": "ROWS"},
        )
        return payload.get("values") or []

    async def _drive_file(session, token, file_id):
        url = (
            "https://www.googleapis.com/drive/v3/files/"
            + quote(str(file_id), safe="")
        )
        return await _google_request(
            session,
            token,
            "GET",
            url,
            params={
                "supportsAllDrives": "true",
                "fields": (
                    "id,name,mimeType,description,parents,driveId,appProperties,"
                    "webViewLink"
                ),
            },
        )

    async def _read_config(session):
        config, sha = await _github_json(session)
        if not isinstance(config, dict):
            raise SeasonError("The QCL season configuration must be a JSON object.", 500)
        active = config.get("active")
        if not isinstance(active, dict) or not active.get("spreadsheet_id"):
            raise SeasonError("The active QCL sheet configuration is incomplete.", 500)
        active.setdefault("sheet_tab", "Raw Data")
        active.setdefault("game_edition", "2K26")
        active.setdefault("season_number", 1)
        active.setdefault("season_label", season_label(active["season_number"]))
        closed_seasons = config.get("closed_seasons", [])
        if not isinstance(closed_seasons, list) or any(
            not isinstance(item, dict) for item in closed_seasons
        ):
            raise SeasonError("QCL closed_seasons must be a list of season records.", 500)
        config["closed_seasons"] = closed_seasons
        return config, sha

    async def _qcl_role(session, uid):
        uid = str(uid)
        cached = _ROLE_CACHE.get(uid)
        if cached and time.time() < cached[0]:
            return cached[1]
        role = "unregistered"
        try:
            raw, _ = await _github_file(session, "qcl_registrations.json")
            state = json.loads(raw) if raw else {}
            records = state.get("qcl_registrations", state)
            if isinstance(records, dict):
                approved = [
                    item
                    for item in records.values()
                    if isinstance(item, dict)
                    and item.get("status") == "approved"
                    and item.get("role") in {"byot_gm", "draft_gm", "draft_player"}
                ]
                if any(
                    item.get("role") in {"byot_gm", "draft_gm"}
                    and str(item.get("owner_id", "")) == uid
                    for item in approved
                ):
                    role = "gm"
                else:
                    for item in approved:
                        people = item.get("people") or []
                        if isinstance(people, dict):
                            people = list(people.values())
                        if isinstance(people, list) and any(
                            isinstance(person, dict)
                            and str(person.get("discord_id", "")) == uid
                            for person in people
                        ):
                            role = "player"
                            break
            if role == "unregistered":
                legacy_raw, _ = await _github_file(session, "registrations.json")
                legacy = json.loads(legacy_raw) if legacy_raw else {}
                if (
                    isinstance(legacy, dict)
                    and isinstance(legacy.get(uid), dict)
                    and str(legacy[uid].get("discord_id", uid)) == uid
                ):
                    role = "player"
        except Exception:
            role = "unregistered"
        _ROLE_CACHE[uid] = (time.time() + 60, role)
        return role

    def _commissioner(request, body=None):
        identity = session_reader(request, body) if session_reader else None
        if not identity or not str(identity.get("id", "")).isdigit():
            return None
        return identity

    def _runtime_missing():
        missing = []
        if not github_token:
            missing.append("GITHUB_TOKEN")
        if not (
            os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
            or os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON_B64", "").strip()
        ):
            missing.append("GOOGLE_SERVICE_ACCOUNT_JSON")
        if not os.environ.get("QCL_ARCHIVE_FOLDER_ID", "").strip():
            missing.append("QCL_ARCHIVE_FOLDER_ID")
        try:
            from google.oauth2 import service_account as _service_account  # noqa: F401
        except ImportError:
            missing.append("GOOGLE_AUTH_DEPENDENCY")
        return missing

    async def status(request):
        identity = _commissioner(request)
        if not identity:
            return _json_response(
                web, cors, {"ok": False, "error": "Sign-in required."}, 401
            )
        async with __import__("aiohttp").ClientSession() as session:
            try:
                config, _ = await _read_config(session)
                missing = _runtime_missing()
                role = await _qcl_role(session, identity.get("id"))
                return _json_response(
                    web,
                    cors,
                    {
                        "ok": True,
                        "is_commissioner": bool(admin_check(identity.get("id"))),
                        "qcl_role": role,
                        "can_see_gm_desk": role == "gm",
                        "can_see_players_desk": role == "player",
                        "active": config.get("active"),
                        "next": config.get("next"),
                        "closed_seasons": config.get("closed_seasons", []),
                        "ready": not missing and github_repo == PUBLIC_QCL_REPO,
                        "missing_configuration": missing
                        + ([] if github_repo == PUBLIC_QCL_REPO else ["GITHUB_REPO"]),
                    },
                )
            except SeasonError as exc:
                return _json_response(
                    web,
                    cors,
                    {
                        "ok": False,
                        "is_commissioner": bool(admin_check(identity.get("id"))),
                        "qcl_role": "unregistered",
                        "can_see_gm_desk": False,
                        "can_see_players_desk": False,
                        "error": str(exc),
                        "ready": False,
                        "missing_configuration": _runtime_missing(),
                    },
                    exc.status,
                )

    async def _read_archive(session, path):
        raw, _ = await _github_file(session, path)
        if raw is None:
            raise SeasonError(f"Archived CSV {path} is missing from QCL.", 404)
        parsed = list(csv.reader(io.StringIO(raw)))
        return rows_as_dicts(parsed)

    async def data(request):
        identity = _commissioner(request)
        if not identity:
            return _json_response(
                web, cors, {"ok": False, "error": "Sign-in required."}, 401
            )
        if github_repo != PUBLIC_QCL_REPO:
            return _json_response(
                web,
                cors,
                {"ok": False, "error": "QTCG is not configured to read the QCL repository."},
                503,
            )
        try:
            async with __import__("aiohttp").ClientSession() as session:
                config, _ = await _read_config(session)
                active = config["active"]
                edition = str(
                    request.query.get("edition") or active.get("game_edition") or ""
                ).strip()
                raw_season = request.query.get("season")
                season_filter = int(raw_season) if raw_season else None
                records = [
                    row
                    for row in config.get("closed_seasons", [])
                    if str(row.get("game_edition")) == edition
                    and (
                        season_filter is None
                        or int(row.get("season_number", 0)) == season_filter
                    )
                ]
                headers, rows = [], []
                active_matches = (
                    str(active.get("game_edition")) == edition
                    and (
                        season_filter is None
                        or int(active.get("season_number", 0)) == season_filter
                    )
                )
                if active_matches:
                    cache_key = (
                        active.get("spreadsheet_id"),
                        edition,
                        season_filter,
                    )
                    cached = _DATA_CACHE.get(cache_key)
                    if cached and time.time() - cached[0] < DATA_CACHE_SECONDS:
                        headers, rows = list(cached[1]), [
                            dict(row) for row in cached[2]
                        ]
                    else:
                        token = await _google_token()
                        values = await _sheet_values(
                            session,
                            token,
                            active["spreadsheet_id"],
                            active.get("sheet_tab", "Raw Data"),
                        )
                        headers, rows = rows_as_dicts(values)
                        _DATA_CACHE[cache_key] = (time.time(), headers, rows)
                for record in records:
                    archived_headers, archived_rows = await _read_archive(
                        session, record["csv_path"]
                    )
                    if not headers:
                        headers = archived_headers
                    rows.extend(archived_rows)
                rows = [
                    row
                    for row in rows
                    if str(row.get("Game Edition") or "").strip() == edition
                    and (
                        season_filter is None
                        or str(row.get("Season") or "").strip()
                        == str(season_filter)
                    )
                ]
                editions = sorted(
                    {
                        str(item.get("game_edition"))
                        for item in config.get("closed_seasons", [])
                        if item.get("game_edition")
                    }
                    | {str(active.get("game_edition"))}
                )
                truncated = len(rows) > MAX_ACTIVITY_ROWS
                return _json_response(
                    web,
                    cors,
                    {
                        "ok": True,
                        "edition": edition,
                        "season": season_filter,
                        "headers": headers,
                        "rows": rows[:MAX_ACTIVITY_ROWS],
                        "row_count": len(rows),
                        "truncated": truncated,
                        "available_editions": editions,
                        "active": active,
                    },
                )
        except (SeasonError, ValueError) as exc:
            status_code = exc.status if isinstance(exc, SeasonError) else 400
            return _json_response(
                web, cors, {"ok": False, "error": str(exc)}, status_code
            )

    async def public_data(request):
        """Expose only the active Raw Data tab, never the workbook's Registry tab."""
        if github_repo != PUBLIC_QCL_REPO:
            return _json_response(
                web,
                cors,
                {"ok": False, "error": "QTCG is not configured to read the QCL repository."},
                503,
            )
        try:
            async with __import__("aiohttp").ClientSession() as session:
                config, _ = await _read_config(session)
                active = config["active"]
                edition = str(active.get("game_edition") or "").strip()
                season_number = int(active.get("season_number") or 0)
                cache_key = (
                    active.get("spreadsheet_id"),
                    edition,
                    season_number,
                )
                cached = _DATA_CACHE.get(cache_key)
                if cached and time.time() - cached[0] < DATA_CACHE_SECONDS:
                    headers, rows = cached[1], cached[2]
                else:
                    token = await _google_token()
                    values = await _sheet_values(
                        session,
                        token,
                        active["spreadsheet_id"],
                        active.get("sheet_tab", "Raw Data"),
                    )
                    headers, rows = rows_as_dicts(values)
                    _DATA_CACHE[cache_key] = (time.time(), headers, rows)
                missing = [column for column in REQUIRED_COLUMNS if column not in headers]
                if missing:
                    raise SeasonError(
                        "The active Raw Data tab is missing required columns: "
                        + ", ".join(missing),
                        422,
                    )
                if rows:
                    validate_season_rows(headers, rows, active)
                return _json_response(
                    web,
                    cors,
                    {
                        "ok": True,
                        "active": active,
                        "edition": edition,
                        "season": season_number,
                        "headers": headers,
                        "rows": rows,
                        "row_count": len(rows),
                    },
                )
        except (SeasonError, ValueError) as exc:
            status_code = exc.status if isinstance(exc, SeasonError) else 400
            return _json_response(
                web, cors, {"ok": False, "error": str(exc)}, status_code
            )

    async def _find_copy(session, token, parent_id, name, close_key):
        query = f"name = '{name.replace(chr(39), chr(92) + chr(39))}' and '{parent_id}' in parents and trashed = false"
        url = "https://www.googleapis.com/drive/v3/files"
        params = {
            "q": query,
            "pageSize": "100",
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
            "fields": "files(id,name,mimeType,description,parents,driveId,appProperties)",
        }
        found = await _google_request(session, token, "GET", url, params=params)
        files = found.get("files") or []
        for item in files:
            if item.get("name") != name:
                continue
            description = str(item.get("description") or "")
            app_props = item.get("appProperties") or {}
            if (
                app_props.get("qclCloseKey") == close_key
                or f"QCL_CLOSE_KEY={close_key}" in description
            ):
                return item
            raise SeasonError(
                f"A different Drive file already uses the next season name {name}. "
                "Rename that file before retrying.",
                409,
            )
        return None

    async def _copy_workbook(
        session, token, source, next_season, close_key, headers, source_rows
    ):
        active_folder = os.environ.get("QCL_ACTIVE_FOLDER_ID", "").strip()
        parent_id = active_folder or next(
            iter(source.get("parents") or []), None
        )
        if not parent_id:
            raise SeasonError(
                "The active workbook has no Drive parent. Configure "
                "QCL_ACTIVE_FOLDER_ID before closing the season.",
                503,
            )
        next_name = (
            f"QCL {next_season['game_edition']} "
            f"{next_season['season_label'].replace('QCL ', '')}"
        )
        copied = await _find_copy(
            session, token, parent_id, next_name, close_key
        )
        if copied is None:
            url = (
                "https://www.googleapis.com/drive/v3/files/"
                + quote(str(source["id"]), safe="")
                + "/copy"
            )
            copied = await _google_request(
                session,
                token,
                "POST",
                url,
                params={
                    "supportsAllDrives": "true",
                    "fields": "id,name,mimeType,description,parents,driveId,appProperties",
                },
                body={
                    "name": next_name,
                    "parents": [parent_id],
                    "description": f"QCL_CLOSE_KEY={close_key}",
                    "appProperties": {
                        "qclCloseKey": close_key,
                        "qclPrepared": "false",
                    },
                },
            )

        copy_id = copied.get("id")
        if not copy_id:
            raise SeasonError("Google Drive did not return a new workbook ID.", 502)
        if copied.get("mimeType") != "application/vnd.google-apps.spreadsheet":
            raise SeasonError("The next-season Drive copy is not a spreadsheet.", 409)
        app_props = copied.get("appProperties") or {}
        if app_props.get("qclPrepared") == "true":
            return copy_id, next_name, parent_id

        values = await _sheet_values(
            session, token, copy_id, next_season.get("sheet_tab", "Raw Data")
        )
        copy_headers, copy_rows = rows_as_dicts(values)
        if copy_headers != headers:
            raise SeasonError(
                "The copied workbook's Raw Data headers differ from the source. "
                "The copy was not cleared.",
                409,
            )
        if copy_rows and copy_rows != source_rows:
            raise SeasonError(
                "The next-season workbook already contains different data. "
                "It was not cleared.",
                409,
            )

        last_row = len(source_rows) + 1
        if source_rows:
            last_column = column_letter(len(headers) - 1)
            clear_range = quote(
                f"'{next_season.get('sheet_tab', 'Raw Data')}'!A2:{last_column}{last_row}",
                safe="",
            )
            clear_url = (
                "https://sheets.googleapis.com/v4/spreadsheets/"
                + quote(str(copy_id), safe="")
                + "/values/"
                + clear_range
                + ":clear"
            )
            await _google_request(
                session, token, "POST", clear_url, body={}
            )

        edition_index = headers.index("Game Edition")
        season_index = headers.index("Season")
        edition_col = column_letter(edition_index)
        season_col = column_letter(season_index)
        formula_url = (
            "https://sheets.googleapis.com/v4/spreadsheets/"
            + quote(str(copy_id), safe="")
            + "/values:batchUpdate"
        )
        await _google_request(
            session,
            token,
            "POST",
            formula_url,
            body={
                "valueInputOption": "USER_ENTERED",
                "data": [
                    {
                        "range": (
                            f"'{next_season.get('sheet_tab', 'Raw Data')}'!"
                            f"{season_col}2"
                        ),
                        "values": [
                            [
                                "=ARRAYFORMULA(IF(A2:A<>\"\","
                                + str(int(next_season["season_number"]))
                                + ",\"\"))"
                            ]
                        ],
                    },
                    {
                        "range": (
                            f"'{next_season.get('sheet_tab', 'Raw Data')}'!"
                            f"{edition_col}2"
                        ),
                        "values": [
                            [
                                '=ARRAYFORMULA(IF(A2:A<>"","'
                                + str(next_season["game_edition"])
                                + '",""))'
                            ]
                        ],
                    },
                ],
            },
        )
        file_url = (
            "https://www.googleapis.com/drive/v3/files/"
            + quote(str(copy_id), safe="")
        )
        await _google_request(
            session,
            token,
            "PATCH",
            file_url,
            params={
                "supportsAllDrives": "true",
                "fields": "id,appProperties",
            },
            body={
                "appProperties": {
                    "qclCloseKey": close_key,
                    "qclPrepared": "true",
                }
            },
        )
        return copy_id, next_name, parent_id

    async def _move_to_archive(session, token, source_file, archive_folder_id):
        folder = await _drive_file(session, token, archive_folder_id)
        if folder.get("mimeType") != "application/vnd.google-apps.folder":
            raise SeasonError("QCL_ARCHIVE_FOLDER_ID is not a Drive folder.", 400)
        if source_file.get("driveId") and folder.get("driveId") != source_file.get("driveId"):
            raise SeasonError(
                "The archive folder must be in the same Shared Drive as the QCL workbook.",
                409,
            )
        parents = source_file.get("parents") or []
        if archive_folder_id in parents:
            return
        if not parents:
            raise SeasonError("The current workbook has no Drive parent to move.", 409)
        url = (
            "https://www.googleapis.com/drive/v3/files/"
            + quote(str(source_file["id"]), safe="")
        )
        await _google_request(
            session,
            token,
            "PATCH",
            url,
            params={
                "addParents": archive_folder_id,
                "removeParents": ",".join(parents),
                "supportsAllDrives": "true",
                "fields": "id,parents",
            },
            body={},
        )

    async def close(request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        identity = _commissioner(request, body)
        if not identity:
            return _json_response(
                web, cors, {"ok": False, "error": "Sign-in required."}, 401
            )
        if not admin_check(identity.get("id")):
            return _json_response(
                web,
                cors,
                {"ok": False, "error": "Commissioner access required."},
                403,
            )
        if github_repo != PUBLIC_QCL_REPO:
            return _json_response(
                web,
                cors,
                {
                    "ok": False,
                    "error": "GITHUB_REPO must be jburnett1291-dot/QCL for season archives.",
                },
                503,
            )
        if not os.environ.get("QCL_ARCHIVE_FOLDER_ID", "").strip():
            return _json_response(
                web,
                cors,
                {
                    "ok": False,
                    "error": "Set QCL_ARCHIVE_FOLDER_ID in the QTCG Railway variables first.",
                },
                503,
            )

        async with close_lock:
            try:
                import aiohttp

                async with aiohttp.ClientSession() as session:
                    config, config_sha = await _read_config(session)
                    active = dict(config["active"])
                    next_season = dict(
                        config.get("next") or _next_season(active)
                    )
                    token = await _google_token()
                    source_id = str(active["spreadsheet_id"])
                    source_file = await _drive_file(session, token, source_id)
                    if source_file.get("mimeType") != "application/vnd.google-apps.spreadsheet":
                        raise SeasonError("The active Drive item is not a spreadsheet.", 409)
                    values = await _sheet_values(
                        session,
                        token,
                        source_id,
                        active.get("sheet_tab", "Raw Data"),
                    )
                    headers, rows = rows_as_dicts(values)
                    edition, season_number = validate_season_rows(
                        headers, rows, active
                    )
                    archive_csv = csv_text(headers, rows)
                    csv_path = (
                        f"{ARCHIVE_ROOT}/{slugify(edition)}/"
                        f"{slugify(active.get('season_label'))}.csv"
                    )
                    existing_csv, csv_sha = await _github_file(session, csv_path)
                    if existing_csv is not None:
                        if hashlib.sha256(existing_csv.encode()).hexdigest() != hashlib.sha256(
                            archive_csv.encode()
                        ).hexdigest():
                            raise SeasonError(
                                f"{csv_path} already exists with different data. "
                                "No files were moved.",
                                409,
                            )
                    else:
                        await _github_put(
                            session,
                            csv_path,
                            archive_csv,
                            None,
                            f"Archive {active.get('season_label')} ({edition}) stats",
                        )

                    close_key = f"{slugify(edition)}-season-{season_number}"
                    copy_id, next_name, active_parent = await _copy_workbook(
                        session,
                        token,
                        source_file,
                        next_season,
                        close_key,
                        headers,
                        rows,
                    )
                    await _move_to_archive(
                        session,
                        token,
                        source_file,
                        os.environ["QCL_ARCHIVE_FOLDER_ID"].strip(),
                    )

                    closed_at = datetime.now(timezone.utc).isoformat()
                    closed = {
                        "game_edition": edition,
                        "season_number": season_number,
                        "season_label": active.get(
                            "season_label", season_label(season_number)
                        ),
                        "csv_path": csv_path,
                        "spreadsheet_id": source_id,
                        "archived_spreadsheet_name": source_file.get("name", "QCL"),
                        "next_spreadsheet_id": copy_id,
                        "closed_at": closed_at,
                        "row_count": len(rows),
                    }
                    closed_list = list(config.get("closed_seasons") or [])
                    if not any(
                        item.get("game_edition") == edition
                        and int(item.get("season_number", 0)) == season_number
                        for item in closed_list
                    ):
                        closed_list.append(closed)

                    config["active"] = {
                        "spreadsheet_id": copy_id,
                        "sheet_tab": next_season.get("sheet_tab", "Raw Data"),
                        "game_edition": next_season["game_edition"],
                        "season_number": int(next_season["season_number"]),
                        "season_label": next_season["season_label"],
                    }
                    config["next"] = _next_season(config["active"])
                    config["closed_seasons"] = closed_list
                    await _github_put(
                        session,
                        SEASON_CONFIG_PATH,
                        json.dumps(config, indent=2, ensure_ascii=False) + "\n",
                        config_sha,
                        (
                            f"Close {active.get('season_label')} ({edition}) "
                            f"and activate {next_name}"
                        ),
                    )
                    _DATA_CACHE.clear()
                    return _json_response(
                        web,
                        cors,
                        {
                            "ok": True,
                            "archived_csv": csv_path,
                            "archived_workbook": source_file.get("name", "QCL"),
                            "new_active_workbook": next_name,
                            "new_active_spreadsheet_id": copy_id,
                            "active": config["active"],
                            "rows_archived": len(rows),
                        },
                    )
            except SeasonError as exc:
                return _json_response(
                    web, cors, {"ok": False, "error": str(exc)}, exc.status
                )
            except Exception as exc:
                return _json_response(
                    web,
                    cors,
                    {
                        "ok": False,
                        "error": (
                            "Season close did not complete. The archived CSV or "
                            "prepared Drive copy may already exist; retry after "
                            "checking the status. "
                            f"({type(exc).__name__})"
                        ),
                    },
                    500,
                )

    def options(request):
        return cors(web.Response())

    return {
        "status": status,
        "data": data,
        "public_data": public_data,
        "close": close,
        "options": options,
    }


def _next_season(active):
    number = int(active.get("season_number") or 1) + 1
    edition = str(active.get("game_edition") or "2K27")
    return {
        "game_edition": edition,
        "season_number": number,
        "season_label": season_label(number),
        "sheet_tab": active.get("sheet_tab", "Raw Data"),
    }
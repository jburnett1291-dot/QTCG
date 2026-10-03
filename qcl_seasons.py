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
from urllib.parse import quote


PUBLIC_QCL_REPO = "jburnett1291-dot/QCL"
SEASON_CONFIG_PATH = "qcl_season_config.json"
ARCHIVE_ROOT = "archives/seasons"
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


def public_csv_url(active):
    spreadsheet_id = str(active.get("spreadsheet_id") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", spreadsheet_id):
        raise SeasonError("The active QCL spreadsheet ID is invalid.", 500)
    if str(active.get("sheet_tab") or "Raw Data").strip() != "Raw Data":
        raise SeasonError("Only the QCL Raw Data tab may be read.", 403)
    gid = str(active.get("sheet_gid", 0)).strip()
    if not gid.isdigit():
        raise SeasonError("The active QCL Raw Data tab ID is invalid.", 500)
    return (
        f"https://docs.google.com/spreadsheets/d/{quote(spreadsheet_id, safe='')}"
        f"/export?format=csv&gid={quote(gid, safe='')}"
    )


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
        # Player/Team and Type may be blank in valid QCL source rows.
        for field in ("Team Name", "Game_ID"):
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

    async def _active_sheet(session, active):
        url = public_csv_url(active)
        async with session.get(url, headers={"Accept": "text/csv"}) as response:
            text = await response.text()
            if response.status != 200:
                raise SeasonError(
                    "The active QCL Raw Data CSV could not be read "
                    f"(HTTP {response.status}).",
                    503,
                )
        if not text.strip() or "<html" in text[:500].lower():
            raise SeasonError(
                "The active QCL Raw Data export did not return CSV data. "
                "Keep the Raw Data CSV export readable.",
                503,
            )
        try:
            values = list(csv.reader(io.StringIO(text, newline="")))
        except csv.Error as exc:
            raise SeasonError("The active QCL Raw Data CSV is malformed.", 422) from exc
        headers, rows = rows_as_dicts(values)
        missing = [column for column in REQUIRED_COLUMNS if column not in headers]
        if missing:
            raise SeasonError(
                "The configured export is not the QCL Raw Data tab; required "
                "columns are missing: " + ", ".join(missing),
                422,
            )
        active_edition = str(active.get("game_edition") or "").strip()
        for row in rows:
            if not str(row.get("Game Edition") or "").strip():
                row["Game Edition"] = active_edition
        return text, headers, rows

    async def _read_config(session):
        config, sha = await _github_json(session)
        if not isinstance(config, dict):
            raise SeasonError("The QCL season configuration must be a JSON object.", 500)
        active = config.get("active")
        if not isinstance(active, dict) or not active.get("spreadsheet_id"):
            raise SeasonError("The active QCL sheet configuration is incomplete.", 500)
        active.setdefault("sheet_tab", "Raw Data")
        active.setdefault("sheet_gid", 0)
        if active["sheet_tab"] != "Raw Data":
            raise SeasonError("Only the QCL Raw Data tab may be served.", 403)
        try:
            active["sheet_gid"] = int(active["sheet_gid"])
        except (TypeError, ValueError) as exc:
            raise SeasonError("The active QCL Raw Data tab ID is invalid.", 500) from exc
        if active["sheet_gid"] < 0:
            raise SeasonError("The active QCL Raw Data tab ID is invalid.", 500)
        active.setdefault("game_edition", "2K26")
        active.setdefault("season_number", 1)
        active.setdefault("season_label", season_label(active["season_number"]))
        closed_seasons = config.get("closed_seasons", [])
        if not isinstance(closed_seasons, list) or any(
            not isinstance(item, dict) for item in closed_seasons
        ):
            raise SeasonError("QCL closed_seasons must be a list of season records.", 500)
        pending = config.get("pending_rollover")
        if pending is not None and not isinstance(pending, dict):
            raise SeasonError("QCL pending_rollover must be a season record.", 500)
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
                if github_repo != PUBLIC_QCL_REPO:
                    missing.append("GITHUB_REPO")
                else:
                    try:
                        await _active_sheet(session, config["active"])
                    except SeasonError as exc:
                        missing.append(str(exc))
                role = await _qcl_role(session, identity.get("id"))
                pending = config.get("pending_rollover")
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
                        "pending_rollover": pending,
                        "ready": not missing and not pending,
                        "missing_configuration": missing,
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
                        "missing_configuration": _runtime_missing()
                        + ([] if github_repo == PUBLIC_QCL_REPO else ["GITHUB_REPO"]),
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
                        active.get("sheet_gid", 0),
                        edition,
                        season_filter,
                    )
                    cached = _DATA_CACHE.get(cache_key)
                    if cached and time.time() - cached[0] < DATA_CACHE_SECONDS:
                        headers, rows = list(cached[1]), [
                            dict(row) for row in cached[2]
                        ]
                    else:
                        _, headers, rows = await _active_sheet(session, active)
                        if rows:
                            validate_season_rows(headers, rows, active)
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
                    active.get("sheet_gid", 0),
                    edition,
                    season_number,
                )
                cached = _DATA_CACHE.get(cache_key)
                if cached and time.time() - cached[0] < DATA_CACHE_SECONDS:
                    headers, rows = cached[1], cached[2]
                else:
                    _, headers, rows = await _active_sheet(session, active)
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

        async with close_lock:
            try:
                import aiohttp

                async with aiohttp.ClientSession() as session:
                    config, config_sha = await _read_config(session)
                    pending = config.get("pending_rollover")
                    if pending:
                        return _json_response(
                            web,
                            cors,
                            {
                                "ok": False,
                                "error": (
                                    "A season archive is already saved. Clear the "
                                    "Raw Data rows and verify the sheet before "
                                    "starting another rollover."
                                ),
                                "pending_rollover": pending,
                            },
                            409,
                        )
                    active = dict(config["active"])
                    next_season = dict(
                        config.get("next") or _next_season(active)
                    )
                    _, headers, rows = await _active_sheet(session, active)
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
                                "No rollover was started.",
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

                    closed_at = datetime.now(timezone.utc).isoformat()
                    pending = {
                        "game_edition": edition,
                        "season_number": season_number,
                        "season_label": active.get(
                            "season_label", season_label(season_number)
                        ),
                        "csv_path": csv_path,
                        "closed_at": closed_at,
                        "row_count": len(rows),
                        "csv_sha256": hashlib.sha256(
                            archive_csv.encode("utf-8")
                        ).hexdigest(),
                        "next": next_season,
                    }
                    config["pending_rollover"] = pending
                    await _github_put(
                        session,
                        SEASON_CONFIG_PATH,
                        json.dumps(config, indent=2, ensure_ascii=False) + "\n",
                        config_sha,
                        (
                            f"Archive {active.get('season_label')} ({edition}) "
                            "pending Raw Data clear"
                        ),
                    )
                    _DATA_CACHE.clear()
                    gid = quote(str(active.get("sheet_gid", 0)), safe="")
                    return _json_response(
                        web,
                        cors,
                        {
                            "ok": True,
                            "archived_csv": csv_path,
                            "pending_rollover": pending,
                            "sheet_url": (
                                "https://docs.google.com/spreadsheets/d/"
                                + quote(str(active["spreadsheet_id"]), safe="")
                                + "/edit#gid="
                                + gid
                            ),
                            "manual_clear_required": True,
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
                            "The CSV archive may have succeeded, but the rollover "
                            "state was not confirmed. Check the season status "
                            "before retrying. "
                            f"({type(exc).__name__})"
                        ),
                    },
                    500,
                )

    async def complete(request):
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

        async with close_lock:
            try:
                import aiohttp

                async with aiohttp.ClientSession() as session:
                    config, config_sha = await _read_config(session)
                    pending = config.get("pending_rollover")
                    if not isinstance(pending, dict):
                        raise SeasonError(
                            "There is no archived season waiting for sheet-clear verification.",
                            409,
                        )
                    archive_csv, _ = await _github_file(
                        session, pending.get("csv_path", "")
                    )
                    if archive_csv is None:
                        raise SeasonError(
                            "The season CSV archive is missing from GitHub; the "
                            "active sheet was not advanced.",
                            409,
                        )
                    archive_hash = hashlib.sha256(
                        archive_csv.encode("utf-8")
                    ).hexdigest()
                    if archive_hash != pending.get("csv_sha256"):
                        raise SeasonError(
                            "The GitHub archive no longer matches the verified "
                            "snapshot; the active sheet was not advanced.",
                            409,
                        )

                    active = dict(config["active"])
                    _, _, remaining_rows = await _active_sheet(session, active)
                    if remaining_rows:
                        raise SeasonError(
                            f"Raw Data still contains {len(remaining_rows)} "
                            "populated row(s). Clear rows below the header, then verify again.",
                            409,
                        )

                    next_active = dict(
                        pending.get("next")
                        or config.get("next")
                        or _next_season(active)
                    )
                    next_active["spreadsheet_id"] = active["spreadsheet_id"]
                    next_active["sheet_tab"] = "Raw Data"
                    next_active["sheet_gid"] = active.get("sheet_gid", 0)
                    next_active.setdefault(
                        "season_label",
                        season_label(next_active.get("season_number", 1)),
                    )

                    closed = {
                        key: value
                        for key, value in pending.items()
                        if key not in {"next", "csv_sha256"}
                    }
                    closed_list = list(config.get("closed_seasons") or [])
                    if not any(
                        item.get("game_edition") == closed["game_edition"]
                        and int(item.get("season_number", 0))
                        == int(closed["season_number"])
                        for item in closed_list
                    ):
                        closed_list.append(closed)

                    config["active"] = next_active
                    config["next"] = _next_season(next_active)
                    config["closed_seasons"] = closed_list
                    config.pop("pending_rollover", None)
                    await _github_put(
                        session,
                        SEASON_CONFIG_PATH,
                        json.dumps(config, indent=2, ensure_ascii=False) + "\n",
                        config_sha,
                        (
                            f"Activate {next_active['game_edition']} "
                            f"{next_active['season_label']} after Raw Data clear"
                        ),
                    )
                    _DATA_CACHE.clear()
                    return _json_response(
                        web,
                        cors,
                        {
                            "ok": True,
                            "active": config["active"],
                            "closed_season": closed,
                            "rows_archived": closed["row_count"],
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
                            "Sheet-clear verification failed; the active season "
                            "was not advanced. "
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
        "complete": complete,
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
        "sheet_gid": active.get("sheet_gid", 0),
        "spreadsheet_id": active.get("spreadsheet_id"),
    }
"""Draft lifecycle HTTP operations, isolated from the main application shell."""

import base64
import time
import zlib

import aiohttp
from aiohttp import web


WAR_ROOM_CONTROL = zlib.decompress(base64.b64decode(
    "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"
)).decode("utf-8")


def create_handlers(dep):
    """Build handlers against callables owned by server.py (no circular import)."""
    cors, session_for = dep["cors"], dep["session"]
    load, get, put, normalize = dep["load"], dep["get"], dep["put"], dep["normalize"]
    public, turn, auto = dep["public"], dep["turn"], dep["auto"]
    record, admin_for, team_for = dep["record"], dep["admin"], dep["team"]
    available, audit = dep["available"], dep["audit"]
    lifecycle, schedule = dep["lifecycle"], dep["schedule"]
    path, cache, lock = dep["path"], dep["cache"], dep["lock"]

    async def draft_state(request):
        sess = session_for(request)
        if not sess:
            return cors(web.json_response({"error": "not logged in"}, status=401))
        async with aiohttp.ClientSession() as client:
            draft, sha = await load(client)
            due_schedule = draft.get("status") == "scheduled" and time.time() >= float(draft.get("scheduled_at") or float("inf"))
            due_pick = draft.get("status") == "active" and time.time() >= float(draft.get("deadline_at") or 0)
            if due_schedule or due_pick:
                async with lock:
                    draft_raw, sha = await get(client, path)
                    draft = normalize(draft_raw)
                    if draft.get("status") == "scheduled" and time.time() >= float(draft.get("scheduled_at") or float("inf")):
                        lifecycle(draft, "active", "system")
                        draft["started_at"] = time.time()
                        draft["deadline_at"] = time.time() + int(draft.get("pick_seconds", 90))
                        audit(draft, "scheduled_draft_started", "system")
                        draft["revision"] = int(draft.get("revision", 0)) + 1
                        if await put(client, path, draft, sha, "draft activity: scheduled start"):
                            cache.update({"t": time.time(), "draft": draft})
                        else:
                            persisted, _ = await get(client, path)
                            draft = normalize(persisted)
                    elif draft.get("status") == "active" and time.time() >= float(draft.get("deadline_at") or 0):
                        current = turn(draft)
                        player = auto(draft, current["team"]) if current else None
                        if player:
                            record(draft, player, None, "clock_auto_pick")
                            draft["revision"] = int(draft.get("revision", 0)) + 1
                            if await put(client, path, draft, sha, f"draft activity: timeout pick #{current['pick']}"):
                                cache.update({"t": time.time(), "draft": draft})
                            else:
                                persisted, _ = await get(client, path)
                                draft = normalize(persisted)
        return cors(web.json_response(public(draft, sess["id"])))

    async def draft_action(request):
        if request.method == "OPTIONS":
            return cors(web.Response())
        try:
            body = await request.json()
        except Exception:
            return cors(web.json_response({"error": "bad request"}, status=400))
        sess = session_for(request, body)
        if not sess:
            return cors(web.json_response({"error": "not logged in"}, status=401))
        uid, action = str(sess["id"]), str(body.get("action", "")).lower()
        async with lock:
          async with aiohttp.ClientSession() as client:
            for attempt in range(2):
              raw, sha = await get(client, path)
              draft = normalize(raw)
              is_admin, my_team = admin_for(uid), team_for(draft, uid)
              error, status = None, 409
              if action == "pick":
                current = turn(draft)
                if draft["status"] != "active" or not current: error = "draft is not active"
                elif not is_admin and my_team != current["team"]: error, status = "your team is not on the clock", 403
                else:
                  wanted = str(body.get("player_id") or body.get("player", "")).lower()
                  player = next((p for p in available(draft) if str(p.get("discord_id", "")).lower() == wanted or str(p.get("gamertag", "")).lower() == wanted), None)
                  if not player: error, status = "player unavailable", 404
                  else: record(draft, player, uid, "commissioner_override" if is_admin and my_team != current["team"] else "activity")
              elif action == "strategy":
                if not my_team and not is_admin: error, status = "coach access required", 403
                else:
                  team = str(body.get("team") or my_team)
                  if not is_admin and team != my_team: error, status = "wrong team", 403
                  else:
                    draft.setdefault("strategies", {})[team] = {"targets": list(body.get("targets", []))[:50], "notes": str(body.get("notes", ""))[:4000], "updated_at": time.time(), "updated_by": uid}
                    audit(draft, "strategy_updated", uid, team=team)
              elif not is_admin: error, status = "commissioner access required", 403
              elif action == "advance":
                current = turn(draft)
                if draft["status"] != "active": error = "draft is not active"
                elif not current: error = "no remaining pick"
                else: draft["current_pick"] += 1; draft["deadline_at"] = time.time() + int(draft.get("pick_seconds", 90)); audit(draft, "force_advance", uid, skipped=current)
              elif action == "undo":
                if not draft.get("picks"): error = "no pick to undo"
                else:
                  pick = draft["picks"].pop()
                  player = next((p for p in draft.get("players", {}).values() if str(p.get("discord_id")) == str(pick.get("player_id"))), None)
                  if player: player["drafted_by"] = None; player.pop("pick_number", None); player.pop("drafted_at", None)
                  draft["current_pick"] = max(0, int(draft["current_pick"]) - 1); lifecycle(draft, "active", uid); draft["deadline_at"] = time.time() + int(draft.get("pick_seconds", 90)); audit(draft, "pick_reversed", uid, pick=pick)
              elif action == "protect":
                try: pick_no = int(body.get("pick"))
                except (TypeError, ValueError): error, status = "pick must be a number", 400
                else:
                  protected = set(int(x) for x in draft.get("protected_picks", [])); protected.symmetric_difference_update({pick_no}); draft["protected_picks"] = sorted(protected); audit(draft, "pick_protection_toggled", uid, pick=pick_no, protected=pick_no in protected)
              elif action == "trade":
                try: pick_no, to_team = int(body.get("pick")), str(body.get("to_team", ""))
                except (TypeError, ValueError): error, status = "pick must be a number", 400
                else:
                  slot = next((x for x in draft.get("order", []) if int(x["pick"]) == pick_no), None)
                  if not slot or pick_no in {int(x["pick"]) for x in draft.get("picks", [])} or pick_no in set(draft.get("protected_picks", [])): error = "pick unavailable or protected"
                  elif to_team not in draft.get("teams", []): error, status = "unknown destination team", 400
                  else: old_team, slot["team"] = slot["team"], to_team; draft.setdefault("trades", []).append({"at": time.time(), "pick": pick_no, "from": old_team, "to": to_team, "approved_by": uid}); audit(draft, "pick_traded", uid, pick=pick_no, from_team=old_team, to_team=to_team)
              elif action == "clear_promo":
                audit(draft, "promo_completed", uid, event_id=(draft.get("promo") or {}).get("event_id")); draft["promo"] = None
              elif action == "start":
                if draft["status"] == "complete": error = "complete drafts cannot be started"
                elif draft["status"] not in {"setup", "scheduled", "stopped"}: error = "start requires setup, scheduled, or stopped"
                else:
                  lifecycle(draft, "active", uid); draft["scheduled_at"] = None; draft["stopped_at"] = None
                  draft["started_at"] = time.time(); draft["deadline_at"] = time.time() + int(draft.get("pick_seconds", 90)); draft["paused_remaining"] = None; audit(draft, "draft_started", uid)
              elif action == "schedule":
                try: scheduled = schedule(body.get("scheduled_at"))
                except ValueError as exc: error, status = str(exc), 400
                else:
                  if draft["status"] == "complete": error = "complete drafts cannot be scheduled"
                  else: lifecycle(draft, "scheduled", uid); draft["scheduled_at"] = scheduled; draft["deadline_at"] = None; draft["paused_remaining"] = None; audit(draft, "draft_scheduled", uid, scheduled_at=scheduled)
              elif action == "pause":
                if draft["status"] != "active": error = "pause requires an active draft"
                else: draft["paused_remaining"] = max(1, int(float(draft.get("deadline_at") or time.time()) - time.time())); draft["deadline_at"] = None; lifecycle(draft, "paused", uid); audit(draft, "draft_paused", uid, remaining=draft["paused_remaining"])
              elif action == "resume":
                if draft["status"] != "paused": error = "resume requires a paused draft"
                else: lifecycle(draft, "active", uid); draft["deadline_at"] = time.time() + int(draft.get("paused_remaining") or draft.get("pick_seconds", 90)); draft["paused_remaining"] = None; audit(draft, "draft_resumed", uid)
              elif action == "stop":
                if draft["status"] not in {"active", "paused", "scheduled"}: error = "stop requires active, paused, or scheduled"
                else: lifecycle(draft, "stopped", uid); draft["stopped_at"] = time.time(); draft["deadline_at"] = None; draft["paused_remaining"] = None; audit(draft, "draft_stopped", uid)
              elif action == "reset_to_setup":
                lifecycle(draft, "setup", uid); draft.update({"scheduled_at": None, "started_at": None, "stopped_at": None, "deadline_at": None, "paused_remaining": None}); audit(draft, "draft_reset_to_setup", uid)
              else: error, status = "unknown action", 400
              if error: return cors(web.json_response({"error": error}, status=status))
              draft["revision"] = int(draft["revision"]) + 1
              if await put(client, path, draft, sha, f"draft activity: {action}"):
                cache.update({"t": time.time(), "draft": draft}); break
              if attempt: return cors(web.json_response({"error": "draft changed; reload and retry"}, status=409))
        return cors(web.json_response({"ok": True, "draft": public(draft, uid)}))

    return draft_state, draft_action
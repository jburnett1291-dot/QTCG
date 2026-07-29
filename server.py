"""
QCL Pull-Server — runs on Railway (or any cloud host), no PC needed.

Real pack pulls for the Discord Activity:
  - verifies the player via the Discord SDK code (real identity, no faking)
  - draws the pack SERVER-SIDE (anti-cheat) using the SAME odds as the bot
  - reads/writes the collection in your GitHub repo (fantasy_save.json), the
    SAME file the bot + Hub use -> everything stays in sync
  - returns the pull so the Activity animates it

ENV VARS (set these in Railway -> Variables):
  DISCORD_CLIENT_ID       = 1498101411894919331
  DISCORD_CLIENT_SECRET   = <Developer Portal -> OAuth2>
  GITHUB_TOKEN            = <same token the bot uses, repo scope>
  GITHUB_REPO            = jburnett1291-dot/SPAM_HUB
  SAVE_PATH             = fantasy_save.json      (optional, this is default)
  POOL_PATH             = fantasy_market.json    (optional; where names+rarity live)
  PORT                  = (Railway sets this automatically)
"""

import os
import json
import time
import base64
import random
import aiohttp
from aiohttp import web

CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
GH_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GH_REPO = os.environ.get("GITHUB_REPO", "jburnett1291-dot/SPAM_HUB")

import re as _re

_CARDCAT = {"t": 0, "by_player": {}, "stems": []}


def _slug(s):
    return _re.sub(r"[^a-z0-9]+", "", str(s or "").lower())


def _slug_loose(s):
    """Like _slug but treats l/I/1 as the same char, so variant spellings
    (IIHurz vs IIIHurz vs 1lHurz) all match the same card art."""
    base = _re.sub(r"[^a-z0-9]+", "", str(s or "").lower())
    return _re.sub(r"[il1]", "i", base)


async def _card_catalog(session):
    """Mirror the bot: read cards/meta.json + list cards/, map player->raw URL."""
    import time as _t
    now = _t.time()
    if _CARDCAT["by_player"] and (now - _CARDCAT["t"] < 300):
        return _CARDCAT
    branch = os.environ.get("GITHUB_BRANCH", "main")
    hdr = {"User-Agent": "QCL-PullServer", "Accept": "application/vnd.github+json"}
    if GH_TOKEN:
        hdr["Authorization"] = f"Bearer {GH_TOKEN}"
    by_player, stems = {}, []
    try:
        meta = {}
        async with session.get(
                f"https://api.github.com/repos/{GH_REPO}/contents/cards/meta.json",
                params={"ref": branch}, headers=hdr) as r:
            if r.status == 200:
                j = await r.json()
                try:
                    meta = json.loads(_b64.b64decode(j["content"]).decode("utf-8"))
                except Exception:
                    meta = {}
        async with session.get(
                f"https://api.github.com/repos/{GH_REPO}/contents/cards",
                params={"ref": branch}, headers=hdr) as r:
            if r.status == 200:
                for it in await r.json():
                    nm = it.get("name", "")
                    if not nm.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
                        continue
                    stem = nm.rsplit(".", 1)[0]
                    raw = f"https://raw.githubusercontent.com/{GH_REPO}/{branch}/cards/{nm}"
                    player_name = meta.get(stem, {}).get("player", "") if isinstance(meta.get(stem), dict) else ""
                    pslug = _slug(player_name)
                    if pslug:
                        by_player.setdefault(pslug, raw)
                        by_player.setdefault(_slug_loose(player_name), raw)
                    stems.append((_slug(stem), _slug_loose(stem), raw))
    except Exception as ex:
        print(f"[catalog] {ex}")
    _CARDCAT.update({"t": now, "by_player": by_player, "stems": stems})
    return _CARDCAT


def _card_img_from_catalog(name, cat):
    """Resolve a player name to its card art URL. Tries exact match first,
    then a LOOSE match that treats l/I/1 as the same char (variant spellings)."""
    want = _slug(name)
    want_loose = _slug_loose(name)
    if not want:
        return None
    # 1) exact filename == player
    for stem_slug, stem_loose, url in cat["stems"]:
        if stem_slug == want:
            return url
    # 2) meta.json player match (exact or loose)
    if want in cat["by_player"]:
        return cat["by_player"][want]
    if want_loose in cat["by_player"]:
        return cat["by_player"][want_loose]
    # 3) loose filename match (IIHurz ~ IIIHurz)
    for stem_slug, stem_loose, url in cat["stems"]:
        if stem_loose == want_loose:
            return url
    # 4) award card containing the name (loose)
    for stem_slug, stem_loose, url in cat["stems"]:
        if want_loose in stem_loose:
            return url
    return None


SAVE_PATH = os.environ.get("SAVE_PATH", "fantasy_save.json")  # points to master save
POOL_PATH = os.environ.get("POOL_PATH", "fantasy_market.json")
PORT = int(os.environ.get("PORT", "8787"))

# odds MUST match the bot's TVT_ODDS / TVT_PACK_SIZE
ODDS = [("Common", 0.50), ("Uncommon", 0.30), ("Rare", 0.15),
        ("Epic", 0.04), ("Legendary", 0.01)]
PACK_SIZE = 3

import hmac as _hmac
import hashlib as _hashlib
import base64 as _b64

_SESSION_SECRET = os.environ.get("QCL_SIGNING_SECRET", CLIENT_SECRET or "change-me")


def _make_session(uid, name, avatar):
    payload = _b64.urlsafe_b64encode(
        json.dumps({"id": uid, "name": name, "avatar": avatar,
                    "exp": time.time() + 60*60*6}).encode()).decode().rstrip("=")
    sig = _hmac.new(_SESSION_SECRET.encode(), payload.encode(),
                    _hashlib.sha256).hexdigest()[:16]
    return f"{payload}.{sig}"


def _read_session(tok):
    try:
        payload, sig = tok.split(".", 1)
        good = _hmac.new(_SESSION_SECRET.encode(), payload.encode(),
                         _hashlib.sha256).hexdigest()[:16]
        if not _hmac.compare_digest(sig, good):
            return None
        pad = "=" * (-len(payload) % 4)
        data = json.loads(_b64.urlsafe_b64decode(payload + pad))
        if data.get("exp", 0) < time.time():
            return None
        return data
    except Exception:
        return None


_COOLDOWN = {}
_COOLDOWN_SECS = 2
_GH_API = "https://api.github.com"


def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


# ── GitHub as the shared save (read + write fantasy_save.json) ──────────────
async def _gh_get(session, path):
    """Return (json_obj, sha) or ({}, None)."""
    url = f"{_GH_API}/repos/{GH_REPO}/contents/{path}"
    headers = {"Authorization": f"token {GH_TOKEN}",
               "Accept": "application/vnd.github+json"}
    async with session.get(url, headers=headers) as r:
        if r.status == 200:
            data = await r.json()
            content = base64.b64decode(data["content"]).decode("utf-8")
            try:
                return json.loads(content), data["sha"]
            except Exception:
                return {}, data["sha"]
        return {}, None


async def _gh_put(session, path, obj, sha, msg):
    url = f"{_GH_API}/repos/{GH_REPO}/contents/{path}"
    headers = {"Authorization": f"token {GH_TOKEN}",
               "Accept": "application/vnd.github+json"}
    body = {"message": msg,
            "content": base64.b64encode(
                json.dumps(obj, indent=2, ensure_ascii=False).encode()).decode()}
    if sha:
        body["sha"] = sha
    async with session.put(url, headers=headers, json=body) as r:
        return r.status in (200, 201)


# ── pool + draw (server-side, anti-cheat) ──────────────────────────────────
def _draw(names, rarity):
    buckets = {}
    for n in names:
        buckets.setdefault(rarity.get(n, "Common"), []).append(n)
    out = []
    for _ in range(PACK_SIZE):
        roll, cum, chosen = random.random(), 0.0, "Common"
        for tier, odds in ODDS:
            cum += odds
            if roll <= cum:
                chosen = tier
                break
        bucket = buckets.get(chosen) or names
        if bucket:
            out.append(random.choice(bucket))
    return out


async def _verify_user(session, code):
    data = {"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
            "grant_type": "authorization_code", "code": code,
            "redirect_uri": "https://127.0.0.1"}
    try:
        async with session.post("https://discord.com/api/oauth2/token", data=data) as r:
            if r.status != 200:
                return None
            tok = (await r.json()).get("access_token")
        async with session.get("https://discord.com/api/users/@me",
                               headers={"Authorization": f"Bearer {tok}"}) as r2:
            if r2.status != 200:
                return None
            return await r2.json()
    except Exception as e:
        print(f"[verify] {e}")
        return None



async def login(request):
    if request.method == "OPTIONS":
        return _cors(web.Response())
    try:
        body = await request.json()
    except Exception:
        return _cors(web.json_response({"error": "bad request"}, status=400))
    code = body.get("code")
    if not code:
        return _cors(web.json_response({"error": "no code"}, status=400))
    async with aiohttp.ClientSession() as session:
        user = await _verify_user(session, code)
        if not user:
            return _cors(web.json_response({"error": "auth failed"}, status=401))
        uid = str(user.get("id"))
        sess = _make_session(uid, user.get("global_name") or user.get("username"),
                             user.get("avatar"))
    return _cors(web.json_response({
        "user": user.get("global_name") or user.get("username"),
        "avatar": user.get("avatar"), "user_id": uid, "session": sess}))


async def open_pack(request):
    if request.method == "OPTIONS":
        return _cors(web.Response())
    try:
        body = await request.json()
    except Exception:
        return _cors(web.json_response({"error": "bad request"}, status=400))
    code = body.get("code")
    session_tok = body.get("session")

    async with aiohttp.ClientSession() as session:
        sess = _read_session(session_tok) if session_tok else None
        if sess:
            uid = str(sess["id"])
            user = {"id": uid, "global_name": sess.get("name"),
                    "username": sess.get("name"), "avatar": sess.get("avatar")}
            new_session = None
        elif code:
            user = await _verify_user(session, code)
            if not user:
                return _cors(web.json_response({"error": "auth failed"}, status=401))
            uid = str(user.get("id"))
            new_session = _make_session(uid, user.get("global_name") or user.get("username"),
                                        user.get("avatar"))
        else:
            return _cors(web.json_response({"error": "no code or session"}, status=400))

        now = time.time()
        if now - _COOLDOWN.get(uid, 0) < _COOLDOWN_SECS:
            return _cors(web.json_response({"error": "slow down"}, status=429))
        _COOLDOWN[uid] = now

        pool, _ = await _gh_get(session, POOL_PATH)
        names, rarity = [], {}
        if isinstance(pool, dict) and pool.get("names"):
            names = pool["names"]
            rarity = pool.get("rarity", {})
        elif isinstance(pool, dict) and pool.get("cards"):
            names = list(pool["cards"].keys())
            rarity = {n: (v.get("tier", "Common") if isinstance(v, dict) else "Common")
                      for n, v in pool["cards"].items()}
        elif isinstance(pool, dict):
            for n, v in pool.items():
                if isinstance(v, dict) and ("tier" in v or "cls" in v or "legend" in v):
                    names.append(n)
                    rarity[n] = v.get("tier", "Common")
        if not names:
            return _cors(web.json_response({"error": "pool not published yet"}, status=503))

        pulled = _draw(names, rarity)

        # Read master save (fantasy_save.json)
        save_data, sha = await _gh_get(session, SAVE_PATH)
        if not isinstance(save_data, dict):
            save_data = {}
        
        users_dict = save_data.setdefault("users", {})
        user_entry = users_dict.setdefault(uid, {
            "name": user.get("global_name") or user.get("username"),
            "coins": 500,
            "cards": [],
            "roster": {"G": None, "F": None, "C": None, "B1": None, "B2": None},
            "serials": {},
            "cumulative_fp": 0.0,
            "history": []
        })

        # Update user record directly in the shared save schema
        user_entry["name"] = user.get("global_name") or user.get("username")
        user_entry["cards"].extend(pulled)

        ok = await _gh_put(session, SAVE_PATH, save_data, sha,
                           f"activity pack pull: {user_entry['name']} +{len(pulled)}")
        if not ok:
            return _cors(web.json_response({"error": "save failed (retry)"}, status=500))

        _cat = await _card_catalog(session)
        cards = [{"name": n, "tier": rarity.get(n, "Common"),
                  "img": _card_img_from_catalog(n, _cat)} for n in pulled]
        resp = {"user": user.get("global_name") or user.get("username"),
                "avatar": user.get("avatar"), "user_id": uid, "cards": cards}
        if new_session:
            resp["session"] = new_session
        return _cors(web.json_response(resp))

async def get_binder(request):
    if request.method == "OPTIONS":
        return _cors(web.Response())
    try:
        body = await request.json()
    except Exception:
        return _cors(web.json_response({"error": "bad request"}, status=400))

    session_tok = body.get("session")
    if not session_tok:
        return _cors(web.json_response({"error": "Not authenticated. Let auto-login finish or open a pack first!"}, status=401))

    sess = _read_session(session_tok)
    if not sess:
        return _cors(web.json_response({"error": "Session expired."}, status=401))

    uid = str(sess["id"])
    
    try:
        async with aiohttp.ClientSession() as session:
            save_data, _ = await _gh_get(session, SAVE_PATH)
            if not isinstance(save_data, dict):
                save_data = {}
            
            users_dict = save_data.get("users", {})
            user_data = users_dict.get(uid, {})
            owned_cards = user_data.get("cards", [])

            pool, _ = await _gh_get(session, POOL_PATH)
            rarity_map = {}
            if isinstance(pool, dict) and pool.get("rarity"):
                rarity_map = pool["rarity"]
            elif isinstance(pool, dict) and pool.get("cards"):
                rarity_map = {n: (v.get("tier", "Common") if isinstance(v, dict) else "Common")
                              for n, v in pool["cards"].items()}
            elif isinstance(pool, dict):
                for n, v in pool.items():
                    if isinstance(v, dict) and "tier" in v:
                        rarity_map[n] = v["tier"]

            card_counts = {}
            if isinstance(owned_cards, dict):
                for k, v in owned_cards.items():
                    card_counts[k] = int(v) if str(v).isdigit() else 1
            elif isinstance(owned_cards, list):
                for card in owned_cards:
                    if isinstance(card, str):
                        card_counts[card] = card_counts.get(card, 0) + 1
                    elif isinstance(card, dict) and "name" in card:
                        cname = card["name"]
                        card_counts[cname] = card_counts.get(cname, 0) + 1
                
            _bcat = await _card_catalog(session)
            formatted_cards = []
            for name, count in card_counts.items():
                tier_val = rarity_map.get(name, "Common")
                tier = str(tier_val).lower() if tier_val else "common"
                formatted_cards.append({"name": str(name), "tier": tier, "count": count,
                                        "img": _card_img_from_catalog(name, _bcat)})

            tier_order = {"legendary": 0, "epic": 1, "rare": 2, "uncommon": 3, "common": 4}
            formatted_cards.sort(key=lambda x: (tier_order.get(x["tier"], 5), x["name"]))

        return _cors(web.json_response({"cards": formatted_cards}))
        
    except Exception as e:
        print(f"[Binder Error] {e}")
        return _cors(web.json_response({"error": f"Server Error: {str(e)}"}, status=500))


async def health(request):
    return _cors(web.json_response({"ok": True, "service": "qcl-pull-server",
                                    "repo": GH_REPO}))



async def diag(request):
    out = {"env": {}, "steps": {}}
    out["env"]["has_client_id"] = bool(CLIENT_ID)
    out["env"]["has_client_secret"] = bool(CLIENT_SECRET)
    out["env"]["has_github_token"] = bool(GH_TOKEN)
    out["env"]["repo"] = GH_REPO
    out["env"]["pool_path"] = POOL_PATH
    out["env"]["save_path"] = SAVE_PATH
    async with aiohttp.ClientSession() as session:
        try:
            pool, _ = await _gh_get(session, POOL_PATH)
            names = []
            if isinstance(pool, dict) and pool.get("names"):
                names = pool["names"]
            elif isinstance(pool, dict) and pool.get("cards"):
                names = list(pool["cards"].keys())
            elif isinstance(pool, dict):
                for n, v in pool.items():
                    if isinstance(v, dict) and ("tier" in v or "cls" in v or "legend" in v):
                        names.append(n)
            out["steps"]["read_pool"] = {"ok": bool(names), "player_count": len(names),
                                         "sample": names[:5]}
        except Exception as e:
            out["steps"]["read_pool"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        try:
            save, sha = await _gh_get(session, SAVE_PATH)
            out["steps"]["read_save"] = {"ok": True, "exists": sha is not None,
                                         "users": len(save.get("users", {}))}
        except Exception as e:
            out["steps"]["read_save"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        try:
            probe, sha = await _gh_get(session, "pull_server_probe.json")
            ok = await _gh_put(session, "pull_server_probe.json",
                               {"last_diag": time.time()}, sha, "pull-server write test")
            out["steps"]["write_repo"] = {"ok": ok,
                "note": "if false, the GITHUB_TOKEN can't WRITE (needs repo scope + push access)"}
        except Exception as e:
            out["steps"]["write_repo"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    out["verdict"] = ("ALL GOOD — pulls should save"
                      if all(s.get("ok") for s in out["steps"].values())
                      else "SOMETHING FAILED — see which step ok=false above")
    return _cors(web.json_response(out, status=200))


app = web.Application()
app.router.add_post("/api/login", login)
app.router.add_options("/api/login", login)
app.router.add_post("/api/openpack", open_packs := open_pack)
app.router.add_options("/api/openpack", open_pack)
app.router.add_post("/api/binder", get_binder)
app.router.add_options("/api/binder", get_binder)
app.router.add_get("/api/health", health)
app.router.add_get("/api/diag", diag)
app.router.add_get("/", health)

if __name__ == "__main__":
    print(f"[qcl-pull-server] starting on :{PORT}, repo={GH_REPO}")
    web.run_app(app, host="0.0.0.0", port=PORT)

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
  DISCORD_CLIENT_SECRET   = mTCqwuGas0p0n78wzPLnO-7GDiEchnpJ
  GITHUB_TOKEN            = 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
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
SAVE_PATH = os.environ.get("SAVE_PATH", "fantasy_save.json")
POOL_PATH = os.environ.get("POOL_PATH", "fantasy_market.json")
PORT = int(os.environ.get("PORT", "8787"))

# odds MUST match the bot's TVT_ODDS / TVT_PACK_SIZE
ODDS = [("Common", 0.50), ("Uncommon", 0.30), ("Rare", 0.15),
        ("Epic", 0.04), ("Legendary", 0.01)]
PACK_SIZE = 3

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


async def open_pack(request):
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

        now = time.time()
        if now - _COOLDOWN.get(uid, 0) < _COOLDOWN_SECS:
            return _cors(web.json_response({"error": "slow down"}, status=429))
        _COOLDOWN[uid] = now

        # pool from the repo. Supports BOTH shapes:
        #  A) {"names":[...], "rarity":{...}}
        #  B) {"<PlayerName>": {"tier": "...", ...}, ...}  (your bot's shape)
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
            # shape B: top-level = player name -> {tier, ...}
            for n, v in pool.items():
                if isinstance(v, dict) and ("tier" in v or "cls" in v or "legend" in v):
                    names.append(n)
                    rarity[n] = v.get("tier", "Common")
        if not names:
            return _cors(web.json_response({"error": "pool not published yet"}, status=503))

        pulled = _draw(names, rarity)

        # mint into the shared save on GitHub
        save, sha = await _gh_get(session, SAVE_PATH)
        users = save.setdefault("users", {})
        u = users.setdefault(uid, {"cards": [], "coins": 0})
        u.setdefault("cards", []).extend(pulled)
        mint = save.setdefault("mint", {})
        for n in pulled:
            mint[n] = int(mint.get(n, 0)) + 1
        ok = await _gh_put(session, SAVE_PATH, save, sha,
                           f"pull: {user.get('username')} +{len(pulled)}")
        if not ok:
            return _cors(web.json_response({"error": "save failed (retry)"}, status=500))

        cards = [{"name": n, "tier": rarity.get(n, "Common")} for n in pulled]
        return _cors(web.json_response({
            "user": user.get("global_name") or user.get("username"),
            "avatar": user.get("avatar"), "user_id": uid, "cards": cards}))


async def health(request):
    return _cors(web.json_response({"ok": True, "service": "qcl-pull-server",
                                    "repo": GH_REPO}))



async def diag(request):
    """Diagnostic: tests each step and reports exactly what works/fails.
    Open /api/diag in a browser to see where the pull flow breaks."""
    out = {"env": {}, "steps": {}}
    out["env"]["has_client_id"] = bool(CLIENT_ID)
    out["env"]["has_client_secret"] = bool(CLIENT_SECRET)
    out["env"]["has_github_token"] = bool(GH_TOKEN)
    out["env"]["repo"] = GH_REPO
    out["env"]["pool_path"] = POOL_PATH
    out["env"]["save_path"] = SAVE_PATH
    async with aiohttp.ClientSession() as session:
        # 1. read pool
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
        # 2. read save
        try:
            save, sha = await _gh_get(session, SAVE_PATH)
            out["steps"]["read_save"] = {"ok": True, "exists": sha is not None,
                                          "users": len(save.get("users", {}))}
        except Exception as e:
            out["steps"]["read_save"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        # 3. WRITE test (the usual culprit) — writes a tiny diag file
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
app.router.add_post("/api/openpack", open_pack)
app.router.add_options("/api/openpack", open_pack)
app.router.add_get("/api/health", health)
app.router.add_get("/api/diag", diag)
app.router.add_get("/", health)

if __name__ == "__main__":
    print(f"[qcl-pull-server] starting on :{PORT}, repo={GH_REPO}")
    web.run_app(app, host="0.0.0.0", port=PORT)

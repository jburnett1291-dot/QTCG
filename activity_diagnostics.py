"""Public, credential-free diagnostics for Discord Activity routing."""

import base64
from collections import deque
import re
import time
from urllib.parse import urlsplit
import zlib

from aiohttp import web


_REQUESTS = deque(maxlen=200)


def _text(value, limit=160):
    value = "".join(ch for ch in str(value or "") if ch.isprintable()).strip()
    value = re.sub(r"\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{8,}\b",
                   "[REDACTED]", value)
    return value[:limit]


def _path(value):
    return re.sub(
        r"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])",
        "[REDACTED]", _text(value, 240) or "/",
    )


def _host(value):
    try:
        return _text(urlsplit("//" + _text(value, 255)).hostname or "", 160)
    except (TypeError, ValueError):
        return ""


def _origin(value):
    try:
        parsed = urlsplit(_text(value, 512))
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return ""
        return _text(parsed.hostname + (parsed.path or "/"), 240)
    except (TypeError, ValueError):
        return ""


@web.middleware
async def request_diagnostics_middleware(request, handler):
    status = 500
    try:
        response = await handler(request)
        status = response.status
        return response
    except web.HTTPException as exc:
        status = exc.status
        raise
    finally:
        path = _path(request.path)
        forwarded = _host(
            request.headers.get("X-Forwarded-Host") or request.headers.get("Host")
        )
        _REQUESTS.append({
            "timestamp": time.time(),
            "method": _text(request.method, 12),
            "path": path,
            "status": status,
            "host": _host(request.headers.get("Host")),
            "forwarded_host": _host(request.headers.get("X-Forwarded-Host")),
            "forwarded_proto": _text(request.headers.get("X-Forwarded-Proto"), 24),
            "origin": _origin(request.headers.get("Origin")),
            "referer": _origin(request.headers.get("Referer")),
            "user_agent": _text(request.headers.get("User-Agent"), 180),
        })
        print("[request] %s %s %s %s" % (
            _text(request.method, 12), path, status, forwarded or "-",
        ))


async def activity_diagnostics(request):
    return web.json_response({
        "service": "qcl-pull-server",
        "diagnostics": "request metadata only; no credentials or query values",
        "server_time": time.time(),
        "recent_requests": list(_REQUESTS),
    }, headers={"Access-Control-Allow-Origin": "*"})


_PAGE = zlib.decompress(base64.b64decode(
    "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"
)).decode("utf-8")


async def serve_diagnostics(request):
    return web.Response(text=_PAGE, content_type="text/html",
                        headers={"Cache-Control": "no-store, max-age=0"})
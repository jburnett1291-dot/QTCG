import sys
import asyncio
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from urllib.parse import unquote, urlsplit

from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, str(Path(__file__).parent))

import server  # noqa: E402


TEST_SECRET = "unit-test-only-signing-secret-not-production"


class FakeGitHubResponse:
    def __init__(self, *, payload=None, body=b"", status=200):
        self.payload = payload
        self.body = body
        self.status = status
        self.content = FakeGitHubContent(body)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def json(self):
        return self.payload

    async def read(self):
        return self.body


class FakeGitHubContent:
    def __init__(self, body):
        self.body = body

    async def iter_chunked(self, chunk_size):
        if self.body:
            yield self.body


class FakeGitHubSession:
    calls = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    def get(self, url, *, params=None, headers=None):
        parsed = urlsplit(url)
        path = unquote(parsed.path)
        self.calls.append(("GET", path, params, headers))

        if "/git/trees/" in path:
            return FakeGitHubResponse(
                payload={
                    "truncated": False,
                    "tree": [
                        {
                            "path": "Draft Players/player.json",
                            "size": 21,
                            "type": "blob",
                        },
                        {
                            "path": "Draft Players/coaches/team.json",
                            "size": 20,
                            "type": "blob",
                        },
                    ],
                }
            )
        if path.endswith("/Draft Players/player.json"):
            return FakeGitHubResponse(body=b'{"name":"Test player"}')
        if path.endswith("/Draft Players/coaches/team.json"):
            return FakeGitHubResponse(body=b'{"name":"Test coach"}')
        if path.endswith("/qcl_registrations.json"):
            return FakeGitHubResponse(body=b'{"approved-1":{"status":"approved"}}')
        if path.endswith("/registrations.json"):
            return FakeGitHubResponse(body=b'{"legacy-1":{"status":"pending"}}')
        raise AssertionError(f"Unexpected read request: {path}")


class ActivityAndCommissionerRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.secret_patcher = patch.object(server, "_SESSION_SECRET", TEST_SECRET)
        cls.secret_patcher.start()
        # The route tests do not need to launch a separate Streamlit process.
        server.app.on_startup.clear()
        server.app.on_cleanup.clear()
        cls.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(cls.loop)
        cls.client = TestClient(
            TestServer(server.app, loop=cls.loop),
            loop=cls.loop,
        )
        cls.loop.run_until_complete(cls.client.start_server())

    @classmethod
    def tearDownClass(cls):
        cls.loop.run_until_complete(cls.client.close())
        cls.loop.close()
        asyncio.set_event_loop(None)
        cls.secret_patcher.stop()

    @classmethod
    def run_async(cls, coroutine):
        return cls.loop.run_until_complete(coroutine)

    def signed_session(self, discord_id):
        return server._make_session(str(discord_id), "Test user", "")

    def test_activity_redirect_preserves_original_query_string(self):
        response = self.run_async(self.client.get(
            "/activity?instance_id=host-instance&channel_id=channel-9&theme=dark"
            "&custom=two%20words&launch=pick%3D7%26round%3D2",
            allow_redirects=False,
        ))

        self.assertEqual(response.status, 302)
        self.assertEqual(
            response.headers["Location"],
            "/qcl/?instance_id=host-instance&channel_id=channel-9&theme=dark"
            "&custom=two%20words&launch=pick%3D7%26round%3D2",
        )

    def test_qtcg_still_serves_the_native_activity(self):
        response = self.run_async(self.client.get("/qtcg"))

        self.assertEqual(response.status, 200)
        self.assertTrue(response.content_type.startswith("text/html"))
        expected = server.SPA_HTML.replace(
            "</nav>",
            '<a href="/qcl-home" aria-label="Open the QCL Streamlit home" '
            'style="display:inline-flex;align-items:center;justify-content:center;'
            'padding:8px 12px;border-radius:9px;margin-left:6px;'
            'background:#17212b;color:#f5f8fb;font-weight:700;'
            'text-decoration:none;border:1px solid #34404c">QCL Home</a></nav>',
            1,
        )
        self.assertEqual(self.run_async(response.text()), expected)

    def test_qcl_admin_still_serves_the_existing_hub(self):
        response = self.run_async(self.client.get("/qcl-admin"))
        body = self.run_async(response.text())

        self.assertEqual(response.status, 200)
        self.assertTrue(response.content_type.startswith("text/html"))
        self.assertEqual(
            body, server.QCL_HUB_PATH.read_text(encoding="utf-8")
        )
        self.assertNotEqual(body, server.SPA_HTML)

    def test_qcl_home_still_serves_the_existing_home(self):
        response = self.run_async(self.client.get("/qcl-home"))
        body = self.run_async(response.text())

        self.assertEqual(response.status, 200)
        self.assertTrue(response.content_type.startswith("text/html"))
        self.assertEqual(
            body, server.QCL_HOME_PATH.read_text(encoding="utf-8")
        )

    def test_commissioner_endpoints_reject_unsigned_requests(self):
        for path in (
            "/api/commissioner/status",
            "/api/commissioner/data",
        ):
            with self.subTest(path=path):
                response = self.run_async(self.client.get(path))
                self.assertEqual(response.status, 401)

    def test_signed_commissioner_status_uses_the_server_allowlist(self):
        commissioner_id = sorted(server._DRAFT_ADMIN_IDS)[0]
        non_commissioner_id = "999999999999999999"

        commissioner_response = self.run_async(self.client.get(
            "/api/commissioner/status",
            params={"session": self.signed_session(commissioner_id)},
        ))
        non_commissioner_response = self.run_async(self.client.get(
            "/api/commissioner/status",
            params={"session": self.signed_session(non_commissioner_id)},
        ))

        self.assertEqual(commissioner_response.status, 200)
        self.assertTrue(self.run_async(commissioner_response.json())["is_commissioner"])
        self.assertEqual(non_commissioner_response.status, 200)
        self.assertFalse(self.run_async(non_commissioner_response.json())["is_commissioner"])

    def test_non_commissioner_cannot_read_commissioner_data(self):
        non_commissioner_id = "999999999999999999"
        self.assertNotIn(non_commissioner_id, server._DRAFT_ADMIN_IDS)
        with (
            patch.object(server, "_commissioner_draft_files", new_callable=AsyncMock) as list_files,
            patch.object(server, "_commissioner_github_bytes", new_callable=AsyncMock) as read_file,
        ):
            response = self.run_async(self.client.get(
                "/api/commissioner/data",
                params={"session": self.signed_session(non_commissioner_id)},
            ))

        self.assertEqual(response.status, 403)
        list_files.assert_not_awaited()
        read_file.assert_not_awaited()

    def test_commissioner_data_route_exposes_only_read_methods(self):
        methods = {
            route.method
            for route in server.app.router.routes()
            if route.resource.canonical == "/api/commissioner/data"
        }

        self.assertIn("GET", methods)
        self.assertTrue(methods.issubset({"GET", "HEAD"}))

    def test_allowlisted_commissioner_can_read_without_any_write(self):
        commissioner_id = sorted(server._DRAFT_ADMIN_IDS)[0]
        FakeGitHubSession.calls.clear()

        with (
            patch.object(server, "GH_TOKEN", "test-only-github-token"),
            patch.object(server.aiohttp, "ClientSession", FakeGitHubSession),
            patch.dict(server._COMMISSIONER_DATA_CACHE, {
                "expires_at": 0.0,
                "payload": None,
            }),
            patch.object(server, "_gh_put", new_callable=AsyncMock) as write_file,
        ):
            response = self.run_async(self.client.get(
                "/api/commissioner/data",
                params={"session": self.signed_session(commissioner_id)},
            ))
            payload = self.run_async(response.json())

        self.assertEqual(response.status, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(
            payload["qcl_registrations"],
            {"approved-1": {"status": "approved"}},
        )
        self.assertEqual(
            payload["legacy_registrations"],
            {"legacy-1": {"status": "pending"}},
        )
        self.assertEqual(len(payload["draft_files"]), 2)
        self.assertEqual(
            [method for method, *_ in FakeGitHubSession.calls],
            ["GET"] * len(FakeGitHubSession.calls),
        )
        self.assertGreater(len(FakeGitHubSession.calls), 0)
        write_file.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
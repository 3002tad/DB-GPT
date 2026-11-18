"""ADMIN18-03: static slash redirects preserve HTTPS and secure session cookies."""

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from dbgpt_app import dbgpt_server


class StaticOriginRedirectTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.seen = []

    def client(self, new_ui=True, root_path=""):
        web = self.root / "static" / ("web" if new_ui else "old_web")
        (web / "_next/static").mkdir(parents=True, exist_ok=True)
        for route in ("construct/models-config", "construct/connectors", "evaluation", "construct/knowledge", "path with space"):
            page = web / route / "index.html"
            page.parent.mkdir(parents=True, exist_ok=True)
            page.write_text(route, encoding="utf-8")
        app = FastAPI()

        @app.get("/api/peer")
        async def peer(request: Request):
            return {"peer": request.client.host, "scheme": request.scope["scheme"]}

        with patch.object(dbgpt_server, "__file__", str(self.root / "dbgpt_server.py")), patch.object(dbgpt_server, "STATIC_MESSAGE_IMG_PATH", str(self.root / "images")):
            dbgpt_server.mount_static_files(app, SimpleNamespace(service=SimpleNamespace(web=SimpleNamespace(new_web_ui=new_ui))))

        async def tunnel_origin(scope, receive, send):
            scope = dict(scope)
            scope["scheme"] = "http"  # External browser HTTPS -> tunnel HTTP origin.
            scope["client"] = ("172.18.0.7", 12345)
            headers = dict(scope.get("headers", []))
            self.seen.append({"path": scope.get("path"), "cookie": headers.get(b"cookie", b"")})
            await app(scope, receive, send)

        return TestClient(tunnel_origin, base_url="https://ai.test", root_path=root_path)

    def test_redirect_keeps_https_secure_cookie_and_query_on_both_exports(self):
        for new_ui in (True, False):
            with self.subTest(new_ui=new_ui), self.client(new_ui) as client:
                client.cookies.set("fixture-session", "present", domain="ai.test", path="/")
                # Explicit Secure attribute; httpx must not send this on HTTP.
                client.get("/construct/models-config/")
                for cookie in client.cookies.jar:
                    cookie.secure = True
                response = client.get("/construct/models-config?next=%2Fai&lang=vi", follow_redirects=True)
                self.assertEqual(200, response.status_code)
                self.assertEqual("https", response.url.scheme)
                self.assertEqual("/construct/models-config/?next=%2Fai&lang=vi", response.history[0].headers["location"])
                self.assertIn(b"fixture-session=present", self.seen[-1]["cookie"])
                self.assertEqual("construct/models-config", response.text)

    def test_other_exported_directories_preserve_origin_without_reading_forwarded_host(self):
        with self.client() as client:
            for path in ("/construct/connectors", "/evaluation", "/construct/knowledge", "/path%20with%20space"):
                response = client.get(path, follow_redirects=False, headers={"x-forwarded-proto": "https", "x-forwarded-host": "attacker.test"})
                self.assertEqual(307, response.status_code)
                self.assertTrue(response.headers["location"].startswith("/"))
                self.assertFalse(response.headers["location"].startswith("//"))
                self.assertNotIn("attacker.test", response.headers["location"])
                self.assertEqual(200, client.get(response.headers["location"]).status_code)

    def test_socket_peer_and_api_routes_are_unchanged(self):
        with self.client() as client:
            response = client.get("/api/peer", headers={"x-forwarded-for": "127.0.0.1", "x-forwarded-proto": "https"})
            self.assertEqual({"peer": "172.18.0.7", "scheme": "http"}, response.json())
            self.assertEqual(404, client.get("/does-not-exist").status_code)
            self.assertEqual(200, client.get("/construct/models-config/", follow_redirects=False).status_code)

    def test_root_path_query_is_preserved(self):
        with self.client(root_path="/proxy") as client:
            response = client.get("/proxy/construct/models-config?q=1", follow_redirects=False)
            self.assertEqual(307, response.status_code)
            self.assertEqual("/proxy/construct/models-config/?q=1", response.headers["location"])


if __name__ == "__main__":
    unittest.main()

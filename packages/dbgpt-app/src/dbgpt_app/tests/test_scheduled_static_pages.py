"""RUN18-05: exported scheduler detail pages support direct navigation."""

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from dbgpt.util.fastapi import replace_router
from dbgpt_app import dbgpt_server
from dbgpt_serve.scheduled_task.api.endpoints import _get_owned_task_or_404


class ScheduledStaticPageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def client(self, new_ui=True):
        web = self.root / "static" / ("web" if new_ui else "old_web")
        (web / "_next/static").mkdir(parents=True, exist_ok=True)
        for name, text in {
            "construct/scheduled-tasks/index.html": "schedule-list",
            "construct/scheduled-tasks/[taskId]/index.html": "schedule-detail",
            "dashboards/[id]/index.html": "dashboard-detail",
        }.items():
            path = web / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        app = FastAPI()
        replace_router(app)

        @app.get("/api/v2/serve/scheduled-tasks/{task_id}")
        async def api(task_id: str):
            return {"task_id": task_id}

        with (
            patch.object(dbgpt_server, "__file__", str(self.root / "dbgpt_server.py")),
            patch.object(dbgpt_server, "STATIC_MESSAGE_IMG_PATH", str(self.root / "images")),
        ):
            dbgpt_server.mount_static_files(
                app, SimpleNamespace(service=SimpleNamespace(web=SimpleNamespace(new_web_ui=new_ui)))
            )
        return TestClient(app), web

    def test_direct_links_and_reloads_for_both_export_roots(self):
        for new_ui in (True, False):
            with self.subTest(new_ui=new_ui):
                client, _ = self.client(new_ui)
                with client:
                    for suffix in ("", "/"):
                        path = "/construct/scheduled-tasks/2429b5d2-9b12-43aa-8256-ab8430a85ba7" + suffix
                        for _ in range(2):
                            response = client.get(path, follow_redirects=False)
                            self.assertEqual(200, response.status_code)
                            self.assertTrue(response.headers["content-type"].startswith("text/html"))
                            self.assertEqual("schedule-detail", response.text)

    def test_list_api_and_other_pages_are_not_captured(self):
        client, _ = self.client()
        with client:
            self.assertEqual("schedule-list", client.get("/construct/scheduled-tasks/").text)
            self.assertEqual({"task_id": "task-123"}, client.get("/api/v2/serve/scheduled-tasks/task-123").json())
            self.assertEqual("dashboard-detail", client.get("/dashboards/saved/").text)
            self.assertEqual(404, client.get("/construct/scheduled-tasks/task-123/unknown").status_code)

    def test_missing_export_returns_404_instead_of_home(self):
        client, web = self.client()
        (web / "construct/scheduled-tasks/[taskId]/index.html").unlink()
        with client:
            for suffix in ("", "/"):
                self.assertEqual(404, client.get("/construct/scheduled-tasks/task-123" + suffix).status_code)


class TaskOwnershipTest(unittest.IsolatedAsyncioTestCase):
    async def test_native_task_lookup_is_still_owner_scoped(self):
        task = SimpleNamespace(task_type="chat_replay")
        service = SimpleNamespace(get_task=AsyncMock(return_value=task))
        user = SimpleNamespace(user_id="analyst")
        result = await _get_owned_task_or_404(service, "task-123", "analyst", user)
        self.assertIs(task, result)
        service.get_task.assert_awaited_once_with("task-123", owner_id="analyst")
        service.get_task.return_value = None
        with self.assertRaises(HTTPException) as error:
            await _get_owned_task_or_404(service, "task-123", "other-user", user)
        self.assertEqual(404, error.exception.status_code)


if __name__ == "__main__":
    unittest.main()

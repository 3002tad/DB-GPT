"""Server context snapshots round-trip through native SQL storage and owned API."""

import ast
import asyncio
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from dbgpt_app.openapi.api_v1.context_snapshot import capture_context_snapshot, snapshot_payload
from dbgpt_app.openapi.api_v1.react_history import ReactHistoryCheckpoint, save_history_view
from dbgpt_app.openapi.api_v1.task_progress import sync_task_plan_steps
from dbgpt_app.tests.test_native_conversation_lifecycle import NativeConversationLifecycleTest
from dbgpt_serve.conversation.api.schemas import ServeRequest

SOURCE = Path(__file__).parents[1] / "openapi/api_v1/agentic_data_api.py"


def builder():
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_build_react_history_payload")
    namespace = dict(globals())
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), "exec"), namespace)
    return namespace[function.name]


def payload(snapshots=None, status="running"):
    return builder()(
        final_content="Fixture answer", steps=[], task_plan=[], generated_images=[],
        sub_agents=[], input_files=[], execution_status=status, context_snapshots=snapshots,
    )


class SnapshotNormalizationTest(unittest.IsolatedAsyncioTestCase):
    async def test_actual_callback_captures_before_emitting_without_persisting_arbitrary_fields(self):
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        callback = next(node for node in ast.walk(tree) if isinstance(node, ast.AsyncFunctionDef) and node.name == "_context_status_callback")
        namespace = {"Dict": Dict, "Any": Any, "capture_context_snapshot": capture_context_snapshot,
                     "react_state": {}, "dialogue": SimpleNamespace(model_name="a"), "stream_queue": asyncio.Queue()}
        exec(compile(ast.Module(body=[callback], type_ignores=[]), str(SOURCE), "exec"), namespace)
        await namespace[callback.name]({"used": 120, "budget": 1000, "state": "warning", "prompt": "do not persist"})
        emitted = await namespace["stream_queue"].get()
        saved = namespace["react_state"]["_context_snapshots"]["a"]
        self.assertEqual(120, saved["used_tokens"])
        self.assertEqual("WARNING", saved["state"])
        self.assertEqual(12, saved["usage_percent"])
        self.assertEqual(emitted["measured_at"], saved["measured_at"])
        self.assertEqual(emitted["model"], "a")
        self.assertNotIn("prompt", saved)

    async def test_invalid_events_and_payloads_are_not_fabricated_measurements(self):
        for event in ({"used": 1, "budget": 0}, {"used": float("nan"), "budget": 10},
                      {"used": True, "budget": 10}, {"used": -1, "budget": 10},
                      {"used": 10**1000, "budget": 10}, None):
            self.assertIsNone(capture_context_snapshot(event, "a"))
        saved = capture_context_snapshot({"used": 100, "budget": 1000, "state": "normal", "secret": "not allowed"}, "a")
        saved["arbitrary"] = "do not persist"
        copied = snapshot_payload({"a": saved, "wrong": saved})
        self.assertEqual(["a"], list(copied))
        self.assertNotIn("arbitrary", copied["a"])
        self.assertNotIn("secret", copied["a"])
        self.assertEqual(saved["measured_at"], copied["a"]["measured_at"])
        self.assertNotIn("context_snapshots", json.loads(payload()))

    async def test_all_history_build_paths_carry_snapshot_and_context_events_flush(self):
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call) and
                 isinstance(node.func, ast.Name) and node.func.id == "_build_react_history_payload"]
        self.assertEqual(4, len(calls))
        for call in calls:
            self.assertIn("context_snapshots", [arg.arg for arg in call.keywords])
        # Exercise the production event-forwarding branch with a bound checkpoint.
        branch = next(node for node in ast.walk(tree) if isinstance(node, ast.If)
                      and ast.unparse(node.test) == "event_type in ('context.status', 'model.progress')")
        function = ast.AsyncFunctionDef(name="forward", args=ast.arguments(posonlyargs=[], args=[], kwonlyargs=[], kw_defaults=[], defaults=[]),
                                        body=branch.body, decorator_list=[])
        snapshots = {"a": capture_context_snapshot({"used": 5, "budget": 10}, "a")}
        class Storage:
            save_message_independent = False
            messages = []
            chat_order = 1
            def add_view_message(self, value): self.saved = value
            def save_to_storage(self): pass
        storage = Storage()
        checkpoint = ReactHistoryCheckpoint()
        checkpoint.bind(storage, lambda status: payload(snapshots, status))
        namespace = {"event_type": "context.status", "event": {"type": "context.status"},
                     "history_checkpoint": checkpoint, "_sse_event": lambda value: json.dumps(value)}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[])), str(SOURCE), "exec"), namespace)
        output = [item async for item in namespace["forward"]()]
        self.assertEqual(1, len(output))
        self.assertEqual(5, json.loads(storage.saved)["context_snapshots"]["a"]["used_tokens"])


class ServerSnapshotHistoryTest(NativeConversationLifecycleTest):
    async def test_snapshot_survives_progress_interrupt_error_and_final_owned_history_reads(self):
        uid = await self.create()
        storage = self.service.create_storage_conv(ServeRequest(conv_uid=uid))
        storage.start_new_round()
        storage.add_user_message("fixture question")
        saved = {"a": capture_context_snapshot({"used": 100, "budget": 1000, "state": "normal"}, "a")}
        checkpoint = ReactHistoryCheckpoint()
        checkpoint.bind(storage, lambda status: payload(saved, status))
        for status in ("running", "interrupted", "failed", "completed"):
            checkpoint.flush(status=status, force=True)
            response = await self.history(uid)
            self.assertEqual(200, response.status_code)
            rows = response.json()["data"]
            views = [row for row in rows if row["role"] == "view"]
            self.assertEqual(1, len(views))
            restored = json.loads(views[0]["context"])
            self.assertEqual(status, restored["execution_status"])
            self.assertEqual(saved, restored["context_snapshots"])
        self.assertEqual(404, (await self.history(uid, "super_admin")).status_code)
        self.assertEqual(401, (await self.client.get("/api/v1/chat/dialogue/messages/history", params={"con_uid": uid})).status_code)

    async def test_multiple_model_turns_and_old_history_remain_readable(self):
        uid = await self.create()
        for model in (None, "a", "b"):
            storage = self.service.create_storage_conv(ServeRequest(conv_uid=uid))
            storage.start_new_round()
            storage.add_user_message("fixture turn")
            snapshots = None if model is None else {model: capture_context_snapshot({"used": 20, "budget": 100}, model)}
            save_history_view(storage, payload(snapshots, "completed"))
        response = await self.history(uid)
        views = [json.loads(row["context"]) for row in response.json()["data"] if row["role"] == "view"]
        self.assertEqual(3, len(views))
        self.assertNotIn("context_snapshots", views[0])
        self.assertEqual(["a"], list(views[1]["context_snapshots"]))
        self.assertEqual(["b"], list(views[2]["context_snapshots"]))


if __name__ == "__main__":
    unittest.main()

import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from dbgpt_serve.conversation.service.history_model import history_message_model


class HistoryModelTest(unittest.TestCase):
    def message(self, **payload):
        return SimpleNamespace(
            type="view", additional_kwargs={},
            content=json.dumps({"type": "react-agent", **payload}),
        )

    def test_explicit_model_survives_before_context_measurement(self):
        self.assertEqual(history_message_model(self.message(model_name="april")), "april")

    def test_actual_message_metadata_has_priority(self):
        message = self.message(model_name="selected")
        message.additional_kwargs = {"model_name": "actual"}
        self.assertEqual(history_message_model(message), "actual")

    def test_legacy_turn_recovers_latest_measured_model(self):
        self.assertEqual(history_message_model(self.message(context_snapshots={
            "old": {"model": "old", "measured_at": 1},
            "new": {"model": "new", "measured_at": 2},
            "invalid": {"model": "different", "measured_at": 999},
        })), "new")

    def test_explicit_turn_wins_over_measurement(self):
        self.assertEqual(history_message_model(self.message(model_name="april", context_snapshots={
            "old": {"model": "old", "measured_at": 999},
        })), "april")

    def test_unknown_history_has_no_fabricated_server_default(self):
        for message in [self.message(), SimpleNamespace(type="view", content="plain legacy reply"),
                        self.message(context_snapshots={"x": {"model": "x", "measured_at": "999"}})]:
            self.assertIsNone(history_message_model(message))

    def test_user_prose_is_not_a_model_selection(self):
        message = self.message(model_name="not-metadata")
        message.type = "human"
        self.assertIsNone(history_message_model(message))

    def test_history_service_returns_each_turn_model_instead_of_default(self):
        from dbgpt_serve.conversation.service.service import Service

        first = self.message(context_snapshots={
            "february": {"model": "february", "measured_at": 1},
        })
        second = self.message(model_name="april")
        for index, message in enumerate([first, second], 1):
            message.round_index = index
            message.get_view_markdown_text = lambda _replace: "test reply"
        service = SimpleNamespace(
            system_app=Mock(), config=SimpleNamespace(default_model="global"),
            create_storage_conv=lambda _: SimpleNamespace(messages=[first, second]),
        )
        with patch("dbgpt_serve.file.serve.Serve.get_instance"), patch(
            "dbgpt_serve.conversation.service.service._append_view_messages",
            side_effect=lambda messages: messages,
        ), patch("dbgpt_serve.conversation.service.service.get_service") as feedback:
            feedback.return_value.list_conv_feedbacks.return_value = []
            rows = Service.get_history_messages(service, SimpleNamespace(conv_uid="one"))
        self.assertEqual([row.model_name for row in rows], ["february", "april"])

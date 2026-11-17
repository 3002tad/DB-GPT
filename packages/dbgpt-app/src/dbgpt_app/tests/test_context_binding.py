import unittest

from dbgpt_app.openapi.api_v1.context_binding import (
    context_selection_message,
    missing_context_selections,
)


class ContextBindingTest(unittest.TestCase):
    def test_labels_need_real_context(self):
        text = "[Database: demo] [Knowledge: guide] Analyze"
        self.assertEqual(missing_context_selections(text), ["database", "knowledge"])
        self.assertEqual(missing_context_selections(text, "demo"), ["knowledge"])
        self.assertEqual(missing_context_selections(text, "demo", "guide"), [])

    def test_ordinary_questions_and_embedded_examples_remain_open(self):
        for text in ("Hello", "Analyze attached CSV", "Explain [Database: demo] labels"):
            self.assertEqual(missing_context_selections(text), [])

    def test_case_and_leading_block(self):
        self.assertEqual(missing_context_selections(" [database: demo]\nQuestion"), ["database"])
        self.assertEqual(missing_context_selections("[Database: demo] Explain [Knowledge: sample]", "demo"), [])

    def test_localized_recovery_message(self):
        self.assertIn("Hãy chọn", context_selection_message("vi-VN"))
        self.assertIn("Choose", context_selection_message("en"))
        self.assertIn("请使用", context_selection_message("zh"))


if __name__ == "__main__":
    unittest.main()

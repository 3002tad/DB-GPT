import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.exc import ProgrammingError

from dbgpt_serve.semantic.api import router


class PublicErrorsTest(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router, prefix="/api")
        self.client = TestClient(app)

    def test_sql_failure_is_safe_and_has_log_reference(self):
        failure = ProgrammingError(
            "SELECT secret_column FROM private_table", {"password": "secret-value"},
            Exception("driver internal detail"),
        )
        with patch("dbgpt_serve.semantic.api.get_semantic_service", side_effect=failure), \
             self.assertLogs("dbgpt_serve.semantic.errors", level="ERROR") as logs:
            response = self.client.get("/api/v1/semantic/spaces")
        self.assertEqual(response.status_code, 500)
        self.assertFalse(response.json()["success"])
        self.assertEqual(response.json()["err_code"], "SEMANTIC_REQUEST_FAILED")
        error_id = response.headers["x-error-id"]
        self.assertIn(error_id, response.json()["err_msg"])
        self.assertIn(error_id, " ".join(logs.output))
        for text in (response.text, " ".join(logs.output)):
            for private in ("secret_column", "private_table", "secret-value", "driver internal detail"):
                self.assertNotIn(private, text)

    def test_wrapped_connector_failure_does_not_leak(self):
        failure = HTTPException(503, "connector postgres://user:password@internal/db")
        with patch("dbgpt_serve.semantic.api.get_semantic_service", side_effect=failure):
            response = self.client.get("/api/v1/semantic/spaces", headers={"Accept-Language": "en"})
        self.assertEqual(response.status_code, 503)
        self.assertIn("Unable to process", response.json()["err_msg"])
        self.assertNotIn("postgres://", response.text)

    def test_not_found_and_success_are_preserved(self):
        with patch("dbgpt_serve.semantic.api.get_semantic_service") as service:
            service.return_value.get_space.return_value = None
            self.assertEqual(self.client.get("/api/v1/semantic/spaces/999").status_code, 404)
            service.return_value.list_spaces.return_value = []
            response = self.client.get("/api/v1/semantic/spaces")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["data"], [])


if __name__ == "__main__":
    unittest.main()

import unittest

from dbgpt_app.pipeline_authorization import authorize_pipeline_request
from dbgpt_app.pipeline_identity import PipelineActor


class ConnectorCatalogAccessTest(unittest.TestCase):
    def test_both_roles_can_read_catalog(self):
        for role in ("analyst", "super_admin"):
            self.assertTrue(authorize_pipeline_request(
                PipelineActor(id="test", role=role),
                {"method": "GET", "path": "/api/v2/serve/connectors/types"},
            ))

    def test_analyst_cannot_mutate_or_read_connection_config(self):
        actor = PipelineActor(id="test", role="analyst")
        for method, path in (
            ("POST", "/api/v2/serve/connectors/types"),
            ("POST", "/api/v2/serve/connectors/"),
            ("GET", "/api/v2/serve/connectors/one"),
            ("PUT", "/api/v2/serve/connectors/one"),
            ("DELETE", "/api/v2/serve/connectors/one"),
            ("GET", "/api/v2/serve/connectors/pending-confirms"),
        ):
            with self.subTest(method=method, path=path):
                self.assertFalse(authorize_pipeline_request(actor, {"method": method, "path": path}))


if __name__ == "__main__":
    unittest.main()

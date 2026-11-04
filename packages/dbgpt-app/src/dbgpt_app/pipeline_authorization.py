"""Initial role policy for reviewed DB-GPT endpoints.

Only exact endpoint and method combinations with a reviewed implementation are
enabled. Additional operations require resource and tool enforcement before
they are added here.
"""

import re

from .pipeline_identity import PipelineActor


_DASHBOARD_OBJECT = re.compile(r"^/api/v1/dashboards/[A-Za-z0-9_-]{1,128}$")
_DASHBOARD_PERMISSIONS = re.compile(
    r"^/api/v1/dashboards/[A-Za-z0-9_-]{1,128}/permissions$"
)
_DASHBOARD_FOLDER = re.compile(r"^/api/v1/dashboard-folders/[A-Za-z0-9_-]{1,128}$")
_DASHBOARD_FOLDER_MOVE = re.compile(r"^/api/v1/dashboards/[A-Za-z0-9_-]{1,128}/folder$")
_DASHBOARD_PERSONAL_READ = re.compile(r"^/api/v1/dashboards/[A-Za-z0-9_-]{1,128}/(?:artifacts|export|snapshot)$")
_DASHBOARD_PERSONAL_WRITE = re.compile(r"^/api/v1/dashboards/[A-Za-z0-9_-]{1,128}/(?:copy|archive|restore)$")
_DASHBOARD_QUERY = re.compile(
    r"^/api/v1/dashboards/[A-Za-z0-9_-]{1,128}/(?:refresh|validate|widgets/[A-Za-z0-9_-]{1,128}/preview)$"
)
_KNOWLEDGE_READ = re.compile(
    r"^/api/v1/knowledge/[^/\\]{1,128}/"
    r"(?:document/list|chunk/list|query|recall_test)$"
)
_KNOWLEDGE_RETRIEVERS = re.compile(r"^/api/v1/knowledge/[^/\\]{1,128}/recall_retrievers$")
_KNOWLEDGE_STATS = re.compile(r"^/api/v2/serve/knowledge/[A-Za-z0-9_-]{1,128}/stats$")
_KNOWLEDGE_TEXT_WRITE = re.compile(
    r"^/api/v1/knowledge/[^/\\]{1,128}/"
    r"(?:document/(?:add|upload|sync|sync_batch|edit|delete)|chunk/edit)$"
)
_CONNECTOR_ITEM = re.compile(
    r"^/api/v2/serve/connectors/[A-Za-z0-9_-]{1,128}(?:/(?:test|tools))?$"
)
_DATASOURCE_ITEM = re.compile(
    r"^/api/v2/serve/datasources/[A-Za-z0-9_-]{1,128}(?:/refresh)?$"
)
_SESSION_FILE = re.compile(r"^/api/v1/agent/files/[A-Za-z0-9_-]{1,128}(?:/(?:preview|download))?$")
_ADMIN_MODEL_PATHS = {
    ("GET", "/api/v2/serve/model/model-types"),
    ("GET", "/api/v2/serve/model/models"),
    ("GET", "/api/v2/serve/model/providers"),
    ("GET", "/api/v2/serve/model/providers/config"),
    ("GET", "/api/v2/serve/model/providers/github_copilot/auth/poll"),
    ("PUT", "/api/v2/serve/model/providers/config"),
    ("PUT", "/api/v2/serve/model/providers/models"),
    ("POST", "/api/v2/serve/model/providers/connect"),
    ("POST", "/api/v2/serve/model/providers/disconnect"),
    ("POST", "/api/v2/serve/model/providers/custom"),
    ("POST", "/api/v2/serve/model/providers/models/enable"),
    ("POST", "/api/v2/serve/model/providers/models/disable"),
    ("POST", "/api/v2/serve/model/providers/github_copilot/auth/start"),
    ("POST", "/api/v2/serve/model/models"),
    ("POST", "/api/v2/serve/model/models/start"),
    ("POST", "/api/v2/serve/model/models/stop"),
}


def authorize_pipeline_request(actor: PipelineActor, scope: dict) -> bool:
    method = scope.get("method")
    path = scope.get("path", "")
    if actor.role in ("analyst", "super_admin") and method == "GET" and (
        _KNOWLEDGE_STATS.fullmatch(path) or path == "/api/v2/serve/datasource-types"
    ):
        # Shared knowledge statistics and supported datasource types contain no credentials.
        return True
    if actor.role == "super_admin" and (method, path) in {
        ("GET", "/api/v2/serve/awel/flows"),
        ("POST", "/api/v1/app/list"),
    }:
        return True
    if actor.role in ("analyst", "super_admin") and method == "POST" and path in {
        "/api/v1/chat/react-agent",
        "/api/v1/chat/knowledge-agent",
    }:
        # Keep the existing Agent workflow available to both Pipeline roles.
        # The route still uses the verified actor and downstream tool policies.
        return True
    if actor.role in ("analyst", "super_admin") and (
        (method == "GET" and _DASHBOARD_PERSONAL_READ.fullmatch(path))
        or (method == "POST" and _DASHBOARD_PERSONAL_WRITE.fullmatch(path))
    ):
        # DashboardService checks view/edit permission and authorizes copied sources.
        return True
    if actor.role in ("analyst", "super_admin") and (
        (path == "/api/v1/agent/files" and method in ("GET", "POST"))
        or (path == "/api/v1/agent/files/capabilities" and method == "GET")
        or (_SESSION_FILE.fullmatch(path) and method in ("GET", "DELETE"))
    ):
        # Registry lookup and deletion bind every file to actor and session.
        return True
    if actor.role in ("analyst", "super_admin") and method == "GET" and path == "/api/v1/model/types":
        return True
    if actor.role == "super_admin" and (method, path) in _ADMIN_MODEL_PATHS:
        return True
    if actor.role == "super_admin" and (
        (path == "/api/v2/serve/datasources" and method in ("GET", "POST", "PUT"))
        or (path == "/api/v2/serve/datasource-types" and method == "GET")
        or (path == "/api/v2/serve/datasources/test-connection" and method == "POST")
        or (_DATASOURCE_ITEM.fullmatch(path) and method in ("GET", "DELETE", "POST"))
    ):
        return True
    if actor.role == "analyst" and method == "GET" and path in {
        "/api/v2/serve/connectors", "/api/v2/serve/connectors/",
    }:
        # The endpoint returns an active-only, credential-free picker view.
        return True
    if actor.role == "super_admin" and (
        (method in ("GET", "POST") and path in {
            "/api/v2/serve/connectors", "/api/v2/serve/connectors/",
            "/api/v2/serve/connectors/confirm",
        })
        or (method == "GET" and path in {
            "/api/v2/serve/connectors/types",
            "/api/v2/serve/connectors/pending-confirms",
        })
        or (method in ("GET", "PUT", "DELETE", "POST") and _CONNECTOR_ITEM.fullmatch(path))
    ):
        return True
    if actor.role in ("analyst", "super_admin") and (
        (path == "/api/v1/dashboard-folders" and method in ("GET", "POST"))
        or (_DASHBOARD_FOLDER.fullmatch(path) and method in ("PUT", "DELETE"))
        or (_DASHBOARD_FOLDER_MOVE.fullmatch(path) and method == "PUT")
    ):
        # Folders are actor-owned; moving also checks dashboard access.
        return True
    if actor.role in ("analyst", "super_admin") and (
        (method == "POST" and (path == "/api/v1/dashboards" or _DASHBOARD_QUERY.fullmatch(path)))
        or (method == "PUT" and _DASHBOARD_OBJECT.fullmatch(path))
    ):
        # DashboardService validates ownership, source grants and writes audit.
        return True
    if actor.role in ("analyst", "super_admin") and method == "GET" and path in {
        "/api/v1/skills/list",
        "/api/v1/skills/detail",
    }:
        return True
    if actor.role in ("analyst", "super_admin") and (
        (method == "POST" and (path in {
            "/api/v1/knowledge/space/list",
            "/api/v1/knowledge/space/add",
            "/api/v1/knowledge/retrieve_strategy_list",
        } or _KNOWLEDGE_READ.fullmatch(path) or _KNOWLEDGE_TEXT_WRITE.fullmatch(path)))
        or (method == "GET" and (path in {
            "/api/v1/knowledge/space/config",
            "/api/v1/knowledge/document/chunkstrategies",
        } or _KNOWLEDGE_RETRIEVERS.fullmatch(path)))
    ):
        return True
    if actor.role in ("analyst", "super_admin") and (
        (method == "GET" and path == "/api/v1/editor/db/tables")
        or (method == "GET" and path == "/api/v2/serve/datasources")
        or (method == "POST" and path in {
            "/api/v1/editor/sql/run", "/api/v1/editor/chart/run"
        })
    ):
        # Each endpoint verifies the selected deployment-bound datasource.
        return True
    if actor.role in ("analyst", "super_admin") and (
        (method == "GET" and path in {
            "/api/v1/chat/dialogue/list",
            "/api/v1/chat/dialogue/messages/history",
            "/api/v1/chat/dialogue/export_messages",
        })
        or (method == "POST" and path in {
            "/api/v1/chat/dialogue/new",
            "/api/v1/chat/dialogue/delete",
            "/api/v1/chat/dialogue/clear",
            "/api/v1/chat/dialogue/query",
            "/api/v1/chat/dialogue/query_page",
        })
    ):
        # Conversation endpoints replace client-supplied owner with verified actor.
        return True
    if method != "GET":
        return False
    if actor.role in ("analyst", "super_admin") and path in {
        "/api/v1/dashboards",
        "/api/v1/dashboards/page",
    }:
        # These endpoints filter by the actor supplied by the trusted boundary.
        return True
    if actor.role in ("analyst", "super_admin") and (
        _DASHBOARD_OBJECT.fullmatch(path) or _DASHBOARD_PERMISSIONS.fullmatch(path)
    ):
        # DashboardService enforces owner/member VIEW on each object.
        return True
    return False

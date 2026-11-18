"""Module dependency routes for the trusted two-role KLTN workspace.

Object ownership, datasource grants and validation remain in the handlers.
Public sharing, model/provider secrets and platform administration are separate.
"""

import re

_ID = r"[A-Za-z0-9_-]{1,128}"
_SPACE = r"[^/\\]{1,128}"
_DASH = rf"/api/v1/dashboards/{_ID}"
_KB = rf"/api/v2/serve/knowledge/{_SPACE}"

SHARED_MODULE_ROUTES = {
    "taskflow_editor": {
        "GET": [
            r"/api/v2/serve/awel/taskflow/(?:node-kinds|agent-options)",
            rf"/api/v2/serve/awel/flow/templates/{_ID}",
            rf"/api/v2/serve/awel/taskflow/generation-sessions/{_ID}",
        ],
        "PUT": [rf"/api/v2/serve/awel/taskflow/generation-sessions/{_ID}/draft"],
        "POST": [
            r"/api/v2/serve/awel/taskflow/generation-sessions",
            rf"/api/v2/serve/awel/taskflow/generation-sessions/{_ID}/(?:messages|undo|debug|save)",
            rf"/api/v2/serve/awel/taskflow/generation-sessions/{_ID}/requests/{_ID}/cancel",
            rf"/api/v2/serve/awel/taskflow/generation-sessions/{_ID}/candidates/{_ID}/(?:apply|discard)",
        ],
    },
    "awel_chat": {"GET": [r"/api/v2/serve/awel/chat/flows"]},
    "agent": {
        "POST": [r"/api/v1/chat/(?:completions|prepare)",
                 r"/api/v1/chat/(?:dialogue/scenes|mode/params/list)",
                 r"/api/v1/resource/params/list",
                 rf"/api/v1/chat/question/{_ID}/(?:reply|reject)",
                 r"/api/v1/chat/topic/terminate",
                 r"/api/v1/conv/feedback/(?:add|cancel)"],
        "GET": [r"/api/v1/agent/skills/download", r"/api/v1/conv/feedback/reasons"],
    },
    "skills": {"POST": [r"/api/v1/skills/(?:upload|import_github)"]},
    # Shared analytical workspace, not datasource/provider credential management.
    "semantic": {
        "GET": [r"/api/v1/semantic/spaces", rf"/api/v1/semantic/spaces/{_ID}(?:/(?:coverage|tables|entries|metrics|relations|examples|rules))?",
                rf"/api/v1/semantic/tables/{_ID}/columns", rf"/api/v1/semantic/spaces/{_ID}/metrics/{_ID}/versions/{_ID}"],
        "POST": [r"/api/v1/semantic/spaces/backfill", rf"/api/v1/semantic/spaces/{_ID}/(?:activate|sync|drafts|entries|metrics|examples)",
                 rf"/api/v1/semantic/entries/{_ID}/review", rf"/api/v1/semantic/metrics/{_ID}/publish", rf"/api/v1/semantic/rules/{_ID}/status"],
    },
    "plugins": {
        "GET": [r"/api/v1/suites", rf"/api/v1/suites/{_ID}(?:/events)?", rf"/api/v1/suite-drafts/{_ID}",
                rf"/api/v1/suite-artifacts/{_ID}(?:/(?:download|installation))?"],
        "POST": [r"/api/v1/suites/upload", rf"/api/v1/suites/{_ID}/(?:enable|disable)", r"/api/v1/suite-drafts",
                 rf"/api/v1/suite-drafts/{_ID}/(?:validate|build)", rf"/api/v1/suite-artifacts/{_ID}/(?:install|configure)"],
        "PATCH": [rf"/api/v1/suite-drafts/{_ID}"],
        "DELETE": [rf"/api/v1/suites/{_ID}"],
    },
    "chat_execution": {
        "GET": [r"/api/v1/chat/approval/(?:pending|log|session-mode)",
                rf"/api/v1/chat/approval/{_ID}/details"],
        "POST": [r"/api/v1/chat/sql/run", rf"/api/v1/chat/approval/{_ID}/resolve", r"/api/v1/chat/approval/session-mode"],
    },
    "reports": {
        "GET": [rf"/api/v1/reports/{_ID}(?:/runs(?:/{_ID}(?:/preview|/blocks/{_ID}/evidence|/artifacts/{_ID}/content|/render-observations(?:/{_ID}/{_ID}/content)?)?)?)?"],
        "POST": [rf"/api/v1/reports/{_ID}/runs/{_ID}/render-observations"],
    },
    "dashboard": {
        "GET": [rf"{_DASH}/(?:versions(?:/{_ID})?|revisions|operations|annotations|audit|cover|publications|live-share)",
                rf"/api/v1/dashboard-catalog/{_ID}/(?:features|source)"],
        "POST": [rf"{_DASH}/(?:assistant-task|resolve-target|operations|collaboration-ticket|query-logic|annotation-intents|annotations(?:/apply-batch|/{_ID}/(?:generate|apply|reject))?|versions/{_ID}/restore|revisions/{_ID}/restore)",
                 rf"/api/v1/dashboard-catalog/{_ID}/(?:preview|generate|adapt)",
                 rf"{_DASH}/(?:publish|live-share|publications/[0-9]+/rotate)"],
        "PUT": [rf"{_DASH}/cover"],
        # Publication is object-authorized by DashboardService. Both workspace
        # roles may publish their own dashboards and revoke/rotate their links.
        "DELETE": [rf"{_DASH}/live-share", rf"{_DASH}/publications/[0-9]+"],
    },
    "knowledge": {
        "GET": [rf"{_KB}/(?:git/sync-status|wiki/(?:status|pages(?:/[^\\]{{1,1024}})?|tree|index|revisions/[^\\]{{1,1024}}|graph|search))",
                r"/api/v2/serve/knowledge/knowledge_sources/types",
                rf"/api/v2/serve/knowledge/spaces/{_ID}/knowledge_sources(?:/{_ID}(?:/resources|/logs)?)?"],
        "POST": [rf"/api/v1/knowledge/{_SPACE}/(?:argument/save|graphvis)",
                 rf"{_KB}/(?:git/(?:sync|incremental-sync)|build-graph|wiki/(?:pages|revert|enable|generate))",
                 rf"/api/v2/serve/knowledge/spaces/{_ID}/knowledge_sources(?:/{_ID}/(?:sync|pause|resume))?"],
        "PUT": [rf"{_KB}/wiki/pages/[^\\]{{1,1024}}",
                rf"/api/v2/serve/knowledge/spaces/{_ID}/knowledge_sources/{_ID}"],
        "DELETE": [rf"{_KB}/wiki/pages/[^\\]{{1,1024}}",
                   rf"/api/v2/serve/knowledge/spaces/{_ID}/knowledge_sources/{_ID}"],
    },
    "awel_files": {
        "GET": [rf"/api/v2/serve/file/files/dbgpt/{_ID}"],
        "POST": [r"/api/v2/serve/file/files/(?:dbgpt|metadata/batch)"],
    },
    "sql_editor": {
        "GET": [r"/api/v1/editor/(?:sql(?:/rounds)?|chart/list)"],
        "POST": [r"/api/v1/(?:sql/editor/submit|chart/editor/submit|editor/chart/info|editor/sql)"],
    },
    "application": {"GET": [rf"/api/v1/app/{_ID}/admins"]},
}

ADMIN_MODULE_ROUTES = {
    "plugins_sync": {"GET": [r"/api/v1/suites/sync"], "POST": [r"/api/v1/suites/sync"]},
    "agent_configuration": {
        "GET": [r"/api/v1/chat/harness/engines", r"/api/v1/chat/approval/(?:policy|whitelist)"],
        "PUT": [r"/api/v1/chat/harness/engine"],
        "POST": [r"/api/v1/chat/approval/(?:policy/(?:save|playground)|whitelist/revoke)"],
    },
    "observability": {"GET": [
        rf"/api/v1/observability/(?:capabilities|agents(?:/{_ID}/stats)?|health|sessions|metrics|models/usage)"
    ]},
    "evaluation": {
        "GET": [r"/api/v1/evaluate/(?:test_auth|datasets|dataset/download|evaluation/result/download|evaluations|metrics|evaluation/detail/show|storage/types|benchmark_task_list)",
                rf"/api/v2/serve/evaluate/benchmark/(?:list_datasets|dataset/{_ID}(?:/{_ID}/rows)?|result/{_ID})"],
        "POST": [r"/api/v1/evaluate/(?:dataset/upload(?:/content|/file)?|start|dataset/members/update|execute_benchmark_task)"],
        "DELETE": [r"/api/v1/evaluate/(?:dataset|evaluation)"],
    },
    "application_admins": {"POST": [r"/api/v1/app/admins/update"]},
    "knowledge_admins": {
        "GET": [r"/api/v1/knowledge/users/list"],
        "POST": [r"/api/v1/knowledge/users/update"],
    },
}


def module_request_allowed(role: str, method: str, path: str) -> bool:
    if role not in ("analyst", "super_admin"):
        return False
    if path == "/api/v1/suites/sync":
        return role == "super_admin" and method in ("GET", "POST")
    groups = [SHARED_MODULE_ROUTES]
    if role == "super_admin":
        groups.append(ADMIN_MODULE_ROUTES)
    return any(
        re.fullmatch(pattern, path)
        for group in groups for methods in group.values()
        for pattern in methods.get(method, [])
    )

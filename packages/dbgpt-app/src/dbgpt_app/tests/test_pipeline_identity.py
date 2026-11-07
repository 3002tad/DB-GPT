import asyncio

import httpx
import pytest

from dbgpt_app.pipeline_identity import (
    PipelineActor,
    PipelineIdentityError,
    PipelineIdentityMiddleware,
    PipelineIdentityVerifier,
)
from dbgpt_app.pipeline_authorization import authorize_pipeline_request


@pytest.mark.parametrize("role", ["analyst", "super_admin"])
def test_shared_knowledge_stats_and_datasource_types(role):
    actor = PipelineActor(id="user", role=role)
    for path in ("/api/v2/serve/knowledge/3/stats", "/api/v2/serve/datasource-types"):
        assert authorize_pipeline_request(actor, {"method": "GET", "path": path})
        assert not authorize_pipeline_request(actor, {"method": "DELETE", "path": path})


@pytest.mark.parametrize("role", ["analyst", "super_admin"])
def test_shared_knowledge_detail_reads(role):
    actor = PipelineActor(id="user", role=role)
    base = "/api/v2/serve/knowledge/funnelmetry-demo-1-2-0-test/tools/"
    for path in ["/api/v1/knowledge/demo/arguments"] + [
        base + tool for tool in ("ls", "ls-json", "glob", "grep", "cat", "semantic_search")
    ]:
        assert authorize_pipeline_request(actor, {"method": "POST", "path": path})
        assert not authorize_pipeline_request(actor, {"method": "DELETE", "path": path})
    assert not authorize_pipeline_request(actor, {"method": "POST", "path": base + "delete"})
    assert authorize_pipeline_request(actor, {"method": "POST", "path": "/api/v1/knowledge/demo/argument/save"})


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/v2/serve/model/providers"),
])
def test_administration_lists_remain_admin_only(method, path):
    scope = {"method": method, "path": path}
    assert authorize_pipeline_request(PipelineActor(id="admin", role="super_admin"), scope)
    assert not authorize_pipeline_request(PipelineActor(id="analyst", role="analyst"), scope)


@pytest.mark.parametrize("role", ["analyst", "super_admin"])
def test_workflows_and_apps_remain_available_to_both_pipeline_roles(role):
    actor = PipelineActor(id="user", role=role)
    for method, path in (
        ("GET", "/api/v2/serve/awel/flows"),
        ("POST", "/api/v2/serve/awel/flows"),
        ("GET", "/api/v2/serve/awel/nodes"),
        ("GET", "/api/v2/serve/awel/flow/templates"),
        ("GET", "/api/v2/serve/awel/flows/flow-1"),
        ("PUT", "/api/v2/serve/awel/flows/flow-1"),
        ("POST", "/api/v1/app/list"),
        ("POST", "/api/v1/app/create"),
        ("POST", "/api/v1/app/edit"),
        ("GET", "/api/v1/team-mode/list"),
        ("GET", "/api/v2/serve/scheduled-tasks/"),
        ("POST", "/api/v2/serve/scheduled-tasks/"),
        ("GET", "/api/v2/serve/scheduled-tasks/task-1/runs"),
        ("POST", "/api/v2/serve/scheduled-tasks/task-1/toggle"),
        ("POST", "/api/v1/dashboards/dashboard-1/schedules"),
    ):
        assert authorize_pipeline_request(actor, {"method": method, "path": path})
    for method, path in (
        ("GET", "/api/v2/serve/awel/flows/../../secrets"),
    ):
        assert not authorize_pipeline_request(actor, {"method": method, "path": path})
    assert authorize_pipeline_request(actor, {
        "method": "POST", "path": "/api/v1/app/admins/update",
    }) == (role == "super_admin")
    if role == "analyst":
        assert not authorize_pipeline_request(actor, {
            "method": "POST", "path": "/api/v2/serve/model/providers/custom",
        })


def verify(handler, authorization="Bearer test-token"):
    verifier = PipelineIdentityVerifier(
        "http://pipeline.internal/api/auth/ai-identity",
        transport=httpx.MockTransport(handler),
    )
    return asyncio.run(verifier.verify(authorization))


def test_verifies_actor_from_pipeline_and_forwards_only_the_bearer():
    def handler(request):
        assert request.headers["authorization"] == "Bearer test-token"
        assert "user-id" not in request.headers
        return httpx.Response(200, json={"actor": {"id": "actor-1", "role": "analyst"}})

    actor = verify(handler)
    assert (actor.id, actor.role) == ("actor-1", "analyst")


@pytest.mark.parametrize("status", [401, 403, 500, 302])
def test_denial_error_and_redirect_fail_closed(status):
    with pytest.raises(PipelineIdentityError) as exc:
        verify(lambda request: httpx.Response(status, headers={"Location": "https://elsewhere.example"}))
    assert exc.value.status_code == (status if status in (401, 403) else 503)


@pytest.mark.parametrize("body", [
    {}, {"actor": {"id": "", "role": "analyst"}},
    {"actor": {"id": "actor-1", "role": "staff"}},
    {"actor": {"id": "actor\r\nheader", "role": "analyst"}},
    {"actor": {"id": "người", "role": "analyst"}},
    {"actor": {"id": "x" * 129, "role": "super_admin"}},
])
def test_invalid_actor_fails_closed(body):
    with pytest.raises(PipelineIdentityError) as exc:
        verify(lambda request: httpx.Response(200, json=body))
    assert exc.value.status_code == 503


def test_missing_token_is_rejected_without_contacting_pipeline():
    def handler(request):
        pytest.fail("unexpected request")

    with pytest.raises(PipelineIdentityError) as exc:
        verify(handler, "")
    assert exc.value.status_code == 401


def test_unavailable_pipeline_is_not_treated_as_anonymous():
    def handler(request):
        raise httpx.ConnectError("unavailable", request=request)

    with pytest.raises(PipelineIdentityError) as exc:
        verify(handler)
    assert exc.value.status_code == 503


@pytest.mark.parametrize("endpoint", [
    "http://name:secret@server/api/auth/ai-identity",
    "http://server/elsewhere",
    "http://server/api/auth/ai-identity?redirect=elsewhere",
])
def test_identity_endpoint_must_be_explicit_and_unambiguous(endpoint):
    with pytest.raises(ValueError):
        PipelineIdentityVerifier(endpoint)


def test_middleware_replaces_forged_identity_only_after_verified_policy():
    captured = {}

    class Verifier:
        async def verify(self, authorization):
            assert authorization == "Bearer token"
            return PipelineActor(id="verified", role="analyst")

    async def app(scope, receive, send):
        captured.update(scope)

    async def run(policy):
        messages = []
        async def send(message):
            messages.append(message)
        scope = {"type": "http", "path": "/api/v1/example", "headers": [
            (b"authorization", b"Bearer token"), (b"user-id", b"forged"),
            (b"x-user-role", b"admin"),
        ]}
        await PipelineIdentityMiddleware(app, verifier=Verifier(), policy=policy)(
            scope, None, send
        )
        return messages

    messages = asyncio.run(run(None))
    assert messages[0]["status"] == 403
    assert not captured
    assert asyncio.run(run(lambda actor, scope: True)) == []
    assert captured["state"]["pipeline_actor"].role == "analyst"
    assert (b"user-id", b"verified") in captured["headers"]
    assert (b"user-id", b"forged") not in captured["headers"]
    assert not any(name == b"x-user-role" for name, _ in captured["headers"])


def test_middleware_rejects_duplicate_auth_and_websocket_api():
    async def app(scope, receive, send):
        pytest.fail("unexpected app call")

    async def run(scope):
        messages = []
        async def send(message):
            messages.append(message)
        await PipelineIdentityMiddleware(app, verifier=None)(scope, None, send)
        return messages

    duplicate = {"type": "http", "path": "/api/v1/a", "headers": [
        (b"authorization", b"Bearer a"), (b"authorization", b"Bearer b")
    ]}
    assert asyncio.run(run(duplicate))[0]["status"] == 401
    assert asyncio.run(run({"type": "websocket", "path": "/api/v1/a"}))[0]["code"] == 1008
    assert asyncio.run(run({"type": "http", "path": "/api", "headers": []}))[0]["status"] == 401
    assert asyncio.run(run({"type": "http", "path": "/images/user-file.png", "headers": []}))[0]["status"] == 403


def test_internal_model_calls_require_loopback_and_no_forwarded_identity():
    calls = []
    async def app(scope, receive, send):
        calls.append(scope["path"])
    middleware = PipelineIdentityMiddleware(app, verifier=None)
    async def request(path, method, client, headers=()):
        messages = []
        async def send(message):
            messages.append(message)
        await middleware({"type": "http", "path": path, "method": method,
                          "client": (client, 1234), "headers": list(headers)}, None, send)
        return messages
    assert asyncio.run(request("/api/controller/models", "POST", "127.0.0.1")) == []
    assert asyncio.run(request("/api/worker/embeddings", "POST", "127.0.0.1")) == []
    assert asyncio.run(request("/api/controller/models", "POST", "172.18.0.1"))[0]["status"] == 401
    assert asyncio.run(request("/api/controller/models", "POST", "127.0.0.1", [(b"x-forwarded-for", b"127.0.0.1")]))[0]["status"] == 401
    assert asyncio.run(request("/api/controller/models", "POST", "127.0.0.1", [(b"origin", b"https://ai.example")]))[0]["status"] == 401
    assert asyncio.run(request("/api/worker/models/startup", "POST", "127.0.0.1"))[0]["status"] == 401


def test_initial_policy_grants_only_reviewed_roles_methods_and_endpoints():
    analyst = PipelineActor(id="analyst-1", role="analyst")
    admin = PipelineActor(id="admin-1", role="super_admin")
    def allowed(actor, method, path):
        return authorize_pipeline_request(actor, {"method": method, "path": path})

    for actor in (admin, analyst):
        assert allowed(actor, "POST", "/api/v1/chat/react-agent")
        assert allowed(actor, "POST", "/api/v1/chat/knowledge-agent")
        assert not allowed(actor, "GET", "/api/v1/chat/react-agent")
        assert not allowed(actor, "POST", "/api/v1/chat/react-agent/other")

    assert allowed(analyst, "GET", "/api/v1/dashboards")
    assert allowed(analyst, "GET", "/api/v1/dashboards/page")
    assert allowed(admin, "GET", "/api/v1/dashboards")
    assert allowed(admin, "GET", "/api/v2/serve/model/providers/config")
    assert not allowed(analyst, "GET", "/api/v2/serve/model/providers/config")
    for actor in (admin, analyst):
        assert allowed(actor, "GET", "/api/v1/dashboard-folders")
        assert allowed(actor, "POST", "/api/v1/dashboard-folders")
        assert allowed(actor, "PUT", "/api/v1/dashboard-folders/folder_1")
        assert allowed(actor, "DELETE", "/api/v1/dashboard-folders/folder_1")
        assert allowed(actor, "PUT", "/api/v1/dashboards/dash_1/folder")
        assert allowed(actor, "POST", "/api/v1/dashboards/dash_1/copy")
        assert allowed(actor, "POST", "/api/v1/dashboards/dash_1/archive")
        assert allowed(actor, "POST", "/api/v1/dashboards/dash_1/restore")
        assert allowed(actor, "GET", "/api/v1/dashboards/dash_1/export")
        assert not allowed(actor, "POST", "/api/v1/dashboards/dash_1/export")
        assert not allowed(actor, "POST", "/api/v1/dashboard-folders/folder_1")
        assert not allowed(actor, "GET", "/api/v1/dashboards/page/extra")
    assert allowed(analyst, "POST", "/api/v1/dashboards")
    assert allowed(admin, "POST", "/api/v1/dashboards")
    assert allowed(analyst, "PUT", "/api/v1/dashboards/dashboard_1")
    assert allowed(analyst, "POST", "/api/v1/dashboards/dashboard_1/refresh")
    assert allowed(analyst, "POST", "/api/v1/dashboards/dashboard_1/widgets/widget_1/preview")
    assert not allowed(analyst, "POST", "/api/v1/dashboards/dashboard_1/publish")
    assert allowed(admin, "GET", "/api/v2/serve/model/providers")
    assert allowed(admin, "PUT", "/api/v2/serve/model/providers/config")
    assert not allowed(analyst, "GET", "/api/v2/serve/model/providers")
    assert not allowed(analyst, "PUT", "/api/v2/serve/model/providers/config")
    assert allowed(admin, "POST", "/api/v2/serve/datasources")
    assert allowed(admin, "PUT", "/api/v2/serve/datasources")
    assert not allowed(analyst, "PUT", "/api/v2/serve/datasources")
    assert allowed(admin, "POST", "/api/v2/serve/connectors")
    assert not allowed(analyst, "POST", "/api/v2/serve/connectors")
    assert allowed(analyst, "GET", "/api/v2/serve/connectors/")
    assert not allowed(analyst, "GET", "/api/v2/serve/connectors/one")
    assert allowed(analyst, "GET", "/api/v1/dashboards/dashboard_1")
    assert allowed(analyst, "GET", "/api/v1/dashboards/dashboard_1/permissions")
    assert allowed(admin, "GET", "/api/v1/dashboards/dashboard_1")
    assert not allowed(analyst, "GET", "/api/v1/dashboards/dashboard_1/members")
    assert not allowed(analyst, "GET", "/api/v1/dashboards/../other")
    assert allowed(analyst, "POST", "/api/v1/editor/sql/run")
    assert allowed(analyst, "GET", "/api/v2/serve/datasources")
    assert allowed(analyst, "POST", "/api/v1/editor/chart/run")
    assert allowed(admin, "POST", "/api/v1/editor/sql/run")
    assert allowed(analyst, "POST", "/api/v1/sql/editor/submit")
    assert allowed(analyst, "GET", "/api/v1/skills/list")
    assert allowed(analyst, "GET", "/api/v1/skills/detail")
    assert allowed(analyst, "POST", "/api/v1/knowledge/space/list")
    assert allowed(analyst, "GET", "/api/v1/knowledge/a/recall_retrievers")
    assert not allowed(analyst, "POST", "/api/v1/knowledge/a/recall_retrievers")
    assert allowed(analyst, "POST", "/api/v1/knowledge/space/add")
    assert allowed(admin, "POST", "/api/v1/knowledge/space/add")
    assert allowed(analyst, "POST", "/api/v1/knowledge/Không gian chung/query")
    assert not allowed(analyst, "POST", "/api/v1/knowledge/space/delete")
    assert allowed(admin, "POST", "/api/v1/knowledge/space/delete")
    assert not allowed(admin, "GET", "/api/v1/knowledge/space/delete")
    for path in ("/api/v1/knowledge/a/document/sync", "/api/v1/knowledge/a/document/sync_batch",
                 "/api/v1/knowledge/a/document/add", "/api/v1/knowledge/a/document/delete",
                 "/api/v1/knowledge/a/chunk/edit"):
        assert allowed(analyst, "POST", path)
        assert allowed(admin, "POST", path)
    assert allowed(admin, "POST", "/api/v1/knowledge/space/list")
    for actor in (admin, analyst):
        assert allowed(actor, "POST", "/api/v1/chat/dialogue/delete")
        assert allowed(actor, "POST", "/api/v1/chat/dialogue/clear")
        assert allowed(actor, "POST", "/api/v1/agent/files")
        assert allowed(actor, "GET", "/api/v1/agent/files/file_1/preview")
        assert allowed(actor, "DELETE", "/api/v1/agent/files/file_1")
        assert not allowed(actor, "POST", "/api/v1/agent/files/file_1/download")


def test_session_handoff_is_origin_bound_and_cookie_identity_is_revalidated():
    class Verifier:
        async def verify(self, authorization):
            if authorization != "Bearer valid.token":
                raise PipelineIdentityError(401)
            return PipelineActor(id="analyst-1", role="analyst")

    received = []
    async def app(scope, receive, send):
        received.append(scope)
    middleware = PipelineIdentityMiddleware(
        app, verifier=Verifier(), policy=lambda actor, scope: True,
        ui_origin="https://analyst.example.test", ai_origin="https://ai.example.test",
    )
    async def request(method, path, headers):
        messages = []
        async def send(message):
            messages.append(message)
        await middleware({"type": "http", "method": method, "path": path, "headers": headers}, None, send)
        return messages

    session = "/api/auth/funnelmetry/session"
    origin = (b"origin", b"https://analyst.example.test")
    auth = (b"authorization", b"Bearer valid.token")
    assert asyncio.run(request("POST", session, [(b"origin", b"https://evil.example"), auth]))[0]["status"] == 403
    result = asyncio.run(request("POST", session, [origin, auth]))
    assert result[0]["status"] == 204
    cookie = dict(result[0]["headers"])[b"set-cookie"]
    assert b"HttpOnly" in cookie and b"Secure" in cookie and b"SameSite=Strict" in cookie
    result = asyncio.run(request("DELETE", session, [origin]))
    assert result[0]["status"] == 204
    assert b"Max-Age=0" in dict(result[0]["headers"])[b"set-cookie"]
    assert asyncio.run(request("DELETE", session, [(b"origin", b"https://evil.example")]))[0]["status"] == 403
    cookie_header = (b"cookie", b"__Host-funnelmetry-ai=valid.token")
    assert asyncio.run(request("GET", "/api/v1/dashboards", [cookie_header])) == []
    assert received[-1]["state"]["pipeline_actor"].id == "analyst-1"
    me = asyncio.run(request("GET", "/api/auth/funnelmetry/me", [cookie_header]))
    import json
    assert json.loads(me[1]["body"]) == {"actor": {"id": "analyst-1", "role": "analyst"}}
    assert dict(me[0]["headers"])[b"cache-control"] == b"no-store"
    assert asyncio.run(request("POST", "/api/v1/dashboards", [cookie_header]))[0]["status"] == 403
    assert asyncio.run(request("POST", "/api/v1/dashboards", [
        cookie_header, (b"origin", b"https://ai.example.test"),
    ])) == []
    assert asyncio.run(request("GET", "/api/v1/dashboards", [
        (b"cookie", b"__Host-funnelmetry-ai=revoked"),
    ]))[0]["status"] == 401


def test_browser_form_handoff_validates_token_and_redirects_without_url_token():
    class Verifier:
        async def verify(self, authorization):
            if authorization != "Bearer valid.token":
                raise PipelineIdentityError(401)
            return PipelineActor(id="analyst-1", role="analyst")

    middleware = PipelineIdentityMiddleware(
        None, verifier=Verifier(), ui_origin="https://analyst.example.test",
        ai_origin="https://ai.example.test",
    )
    async def request(body, origin=b"https://analyst.example.test"):
        messages = []
        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}
        async def send(message):
            messages.append(message)
        await middleware({"type": "http", "method": "POST",
            "path": "/api/auth/funnelmetry/session", "headers": [
                (b"origin", origin),
                (b"content-type", b"application/x-www-form-urlencoded"),
            ]}, receive, send)
        return messages

    result = asyncio.run(request(b"token=valid.token"))
    assert result[0]["status"] == 303
    headers = dict(result[0]["headers"])
    assert headers[b"location"] == b"https://ai.example.test/"
    assert b"valid.token" not in headers[b"location"]
    assert b"HttpOnly" in headers[b"set-cookie"] and b"Secure" in headers[b"set-cookie"]
    assert asyncio.run(request(b"token=valid.token", b"https://evil.example"))[0]["status"] == 403
    assert asyncio.run(request(b"token=revoked"))[0]["status"] == 401
    assert asyncio.run(request(b"token=valid.token&token=valid.token"))[0]["status"] == 400
    assert asyncio.run(request(b"token=" + b"x" * 8192))[0]["status"] == 413


def test_cookie_role_changes_and_revocation_take_effect_on_next_request():
    class Verifier:
        actor = PipelineActor(id="alice", role="analyst")
        async def verify(self, authorization):
            if self.actor is None:
                raise PipelineIdentityError(401)
            return self.actor

    verifier = Verifier()
    received = []
    async def app(scope, receive, send):
        received.append(scope)
    middleware = PipelineIdentityMiddleware(app, verifier=verifier, policy=authorize_pipeline_request)
    async def request(path):
        messages = []
        async def send(message):
            messages.append(message)
        await middleware({"type": "http", "method": "GET", "path": path, "headers": [
            (b"cookie", b"__Host-funnelmetry-ai=valid.token"),
            (b"user-id", b"forged"), (b"x-user-role", b"super_admin"),
        ]}, None, send)
        return messages

    endpoint = "/api/v2/serve/model/providers/config"
    assert asyncio.run(request(endpoint))[0]["status"] == 403
    verifier.actor = PipelineActor(id="alice", role="super_admin")
    assert asyncio.run(request(endpoint)) == []
    assert received[-1]["state"]["pipeline_actor"].role == "super_admin"
    assert (b"user-id", b"alice") in received[-1]["headers"]
    assert not any(name == b"x-user-role" for name, _ in received[-1]["headers"])
    verifier.actor = None
    assert asyncio.run(request(endpoint))[0]["status"] == 401

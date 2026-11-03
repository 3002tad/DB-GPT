"""Pipeline identity verification and a fail-closed integration boundary."""

from dataclasses import dataclass
from http.cookies import CookieError, SimpleCookie
import json
import logging
from typing import Optional
from urllib.parse import parse_qs, urlsplit

import httpx

logger = logging.getLogger(__name__)

# The unified DB-GPT process registers its model workers over HTTP to its own
# loopback listener. These endpoints must never trust forwarded client IPs.
_LOCAL_MODEL_ENDPOINTS = {
    ("GET", "/api/health"),
    ("GET", "/api/controller/models"),
    ("POST", "/api/controller/models"),
    ("DELETE", "/api/controller/models"),
    ("POST", "/api/controller/heartbeat"),
    ("POST", "/api/worker/generate_stream"),
    ("POST", "/api/worker/generate"),
    ("POST", "/api/worker/embeddings"),
    ("POST", "/api/worker/count_token"),
    ("POST", "/api/worker/model_metadata"),
}

@dataclass(frozen=True)
class PipelineActor:
    id: str
    role: str


class PipelineIdentityError(Exception):
    """Identity is missing, denied, or temporarily unavailable."""

    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__("Pipeline identity verification failed")


class PipelineIdentityVerifier:
    """Verify each request against the Pipeline's live-session endpoint."""

    def __init__(
        self, endpoint: str, *, transport: Optional[httpx.AsyncBaseTransport] = None
    ):
        parsed = urlsplit(endpoint)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path != "/api/auth/ai-identity"
        ):
            raise ValueError("Invalid Pipeline identity endpoint")
        self._endpoint = endpoint
        self._transport = transport

    async def verify(self, authorization: str) -> PipelineActor:
        if not authorization.startswith("Bearer ") or not authorization[7:].strip():
            raise PipelineIdentityError(401)
        try:
            async with httpx.AsyncClient(
                transport=self._transport, timeout=3.0, follow_redirects=False,
                trust_env=False,
            ) as client:
                response = await client.get(
                    self._endpoint, headers={"Authorization": authorization}
                )
        except httpx.HTTPError as exc:
            raise PipelineIdentityError(503) from exc
        if response.status_code in (401, 403):
            raise PipelineIdentityError(response.status_code)
        if response.status_code != 200:
            raise PipelineIdentityError(503)
        try:
            payload = response.json()
            actor = payload["actor"]
            actor_id, role = actor["id"], actor["role"]
            if (
                not isinstance(actor_id, str)
                or not actor_id.strip()
                or len(actor_id.encode("ascii")) > 128
                or any(ord(char) < 33 or ord(char) > 126 for char in actor_id)
                or role not in ("super_admin", "analyst")
            ):
                raise ValueError("Invalid actor")
            return PipelineActor(id=actor_id, role=role)
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            raise PipelineIdentityError(503) from exc


class PipelineIdentityMiddleware:
    """Validate Pipeline sessions before supplying trusted identity to APIs.

    The policy callback is deliberately required. Without an implemented and
    reviewed execution policy every API request is denied after authentication.
    """

    def __init__(self, app, *, verifier, policy=None, ui_origin=None, ai_origin=None):
        self.app = app
        self.verifier = verifier
        self.policy = policy
        self.ui_origin = self._origin(ui_origin)
        self.ai_origin = self._origin(ai_origin)

    @staticmethod
    def _origin(value):
        if value is None:
            return None
        parsed = urlsplit(value or "")
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username
                or parsed.password or parsed.path or parsed.query or parsed.fragment):
            raise ValueError("Pipeline integration requires explicit HTTPS origins")
        return value

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "").lower()
        protected = path == "/api" or path.startswith("/api/")
        if scope["type"] == "websocket" and protected:
            return await send({"type": "websocket.close", "code": 1008})
        # User-generated images are served outside /api and have no owner
        # check. Keep them inaccessible until an authenticated route exists.
        if scope["type"] == "http" and (path == "/images" or path.startswith("/images/")):
            return await self._reject(send, 403)
        if scope["type"] != "http" or not protected:
            return await self.app(scope, receive, send)
        headers = scope.get("headers", [])
        client = scope.get("client")
        forwarded = {b"forwarded", b"x-forwarded-for", b"x-real-ip", b"cf-connecting-ip"}
        if (client and client[0] in ("127.0.0.1", "::1")
                and (scope.get("method"), path) in _LOCAL_MODEL_ENDPOINTS
                and not any(name.lower() in forwarded or name.lower() == b"origin" for name, _ in headers)):
            return await self.app(scope, receive, send)
        auth_headers = [value for name, value in headers if name.lower() == b"authorization"]
        origins = [value for name, value in headers if name.lower() == b"origin"]
        if path == "/api/auth/funnelmetry/session":
            return await self._session(scope, headers, origins, receive, send)
        if len(auth_headers) > 1:
            return await self._reject(send, 401)
        cookie_auth = not auth_headers
        if cookie_auth:
            cookie_headers = [value for name, value in headers if name.lower() == b"cookie"]
            try:
                if len(cookie_headers) != 1:
                    return await self._reject(send, 401)
                cookies = SimpleCookie()
                cookies.load(cookie_headers[0].decode("ascii"))
                token = cookies.get("__Host-funnelmetry-ai")
                if token is None:
                    return await self._reject(send, 401)
                authorization = "Bearer " + token.value
            except (UnicodeDecodeError, CookieError):
                return await self._reject(send, 401)
            if scope.get("method") not in ("GET", "HEAD", "OPTIONS"):
                if not self.ai_origin or len(origins) != 1 or origins[0] != self.ai_origin.encode("ascii"):
                    return await self._reject(send, 403)
        else:
            try:
                authorization = auth_headers[0].decode("ascii")
            except UnicodeDecodeError:
                return await self._reject(send, 401)
        try:
            actor = await self.verifier.verify(authorization)
        except PipelineIdentityError as exc:
            return await self._reject(send, getattr(exc, "status_code", 401))
        if path == "/api/auth/funnelmetry/me" and scope.get("method") == "GET":
            body = json.dumps({"actor": {"id": actor.id, "role": actor.role}}).encode("utf-8")
            await send({"type": "http.response.start", "status": 200, "headers": [
                (b"content-type", b"application/json"),
                (b"cache-control", b"no-store"),
            ]})
            return await send({"type": "http.response.body", "body": body})
        if self.policy is None or not self.policy(actor, scope):
            logger.info(
                "pipeline_access actor=%s role=%s method=%s status=403",
                actor.id, actor.role, scope.get("method"),
            )
            return await self._reject(send, 403)
        scope = dict(scope)
        scope["state"] = dict(scope.get("state") or {}, pipeline_actor=actor)
        scope["headers"] = [
            (name, value) for name, value in headers
            if name.lower() not in (b"user-id", b"x-user-id", b"x-user-role")
        ] + [(b"user-id", actor.id.encode("utf-8"))]
        async def audited_send(message):
            if message["type"] == "http.response.start":
                # No query string, request body, credentials or raw data.
                parts = path.strip("/").split("/")
                component = "/".join(parts[:4])
                logger.info(
                    "pipeline_access actor=%s role=%s method=%s component=%s status=%s",
                    actor.id, actor.role, scope.get("method"), component,
                    message["status"],
                )
            await send(message)
        try:
            return await self.app(scope, receive, audited_send)
        except Exception:
            logger.error(
                "pipeline_access actor=%s role=%s method=%s status=exception",
                actor.id, actor.role, scope.get("method"),
            )
            raise

    async def _session(self, scope, headers, origins, receive, send):
        if not self.ui_origin or len(origins) != 1 or origins[0] != self.ui_origin.encode("ascii"):
            return await self._reject(send, 403)
        cors = [(b"access-control-allow-origin", origins[0]),
                (b"access-control-allow-credentials", b"true"),
                (b"vary", b"Origin"), (b"cache-control", b"no-store")]
        method = scope.get("method")
        if method == "OPTIONS":
            cors.extend([(b"access-control-allow-methods", b"POST, DELETE, OPTIONS"),
                         (b"access-control-allow-headers", b"Authorization")])
            await send({"type": "http.response.start", "status": 204, "headers": cors})
            return await send({"type": "http.response.body", "body": b""})
        if method == "DELETE":
            cors.append((b"set-cookie",
                b"__Host-funnelmetry-ai=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0"))
            await send({"type": "http.response.start", "status": 204, "headers": cors})
            return await send({"type": "http.response.body", "body": b""})
        auth = [value for name, value in headers if name.lower() == b"authorization"]
        content_types = [value for name, value in headers if name.lower() == b"content-type"]
        form_post = (method == "POST" and not auth and len(content_types) == 1
                     and content_types[0].split(b";", 1)[0].strip().lower()
                     == b"application/x-www-form-urlencoded")
        if method != "POST" or (not form_post and len(auth) != 1):
            return await self._reject(send, 401)
        try:
            if form_post:
                if receive is None:
                    return await self._reject(send, 400)
                body = bytearray()
                while True:
                    message = await receive()
                    if message.get("type") != "http.request":
                        return await self._reject(send, 400)
                    body.extend(message.get("body", b""))
                    if len(body) > 8192:
                        return await self._reject(send, 413)
                    if not message.get("more_body", False):
                        break
                form = parse_qs(body.decode("ascii"), keep_blank_values=True,
                                strict_parsing=True, max_num_fields=2)
                if set(form) != {"token"} or len(form["token"]) != 1:
                    return await self._reject(send, 400)
                authorization = "Bearer " + form["token"][0]
            else:
                authorization = auth[0].decode("ascii")
            await self.verifier.verify(authorization)
            token = authorization.removeprefix("Bearer ")
            if not token or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._" for c in token):
                return await self._reject(send, 401)
        except (UnicodeDecodeError, ValueError, PipelineIdentityError) as exc:
            return await self._reject(send, getattr(exc, "status_code", 401))
        cors.append((b"set-cookie", (
            "__Host-funnelmetry-ai=" + token + "; Path=/; Secure; HttpOnly; SameSite=Strict"
        ).encode("ascii")))
        if form_post:
            if not self.ai_origin:
                return await self._reject(send, 503)
            cors.append((b"location", (self.ai_origin + "/").encode("ascii")))
        await send({"type": "http.response.start", "status": 303 if form_post else 204, "headers": cors})
        return await send({"type": "http.response.body", "body": b""})

    @staticmethod
    async def _reject(send, status):
        await send({"type": "http.response.start", "status": status, "headers": [
            (b"content-type", b"application/json"), (b"cache-control", b"no-store")
        ]})
        await send({"type": "http.response.body", "body": b'{"error":"access_denied"}'})

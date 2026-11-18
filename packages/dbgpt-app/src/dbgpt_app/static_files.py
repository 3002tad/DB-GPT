"""Static directory redirects that preserve the browser's public origin."""

from urllib.parse import urlsplit, urlunsplit

from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope


class SameOriginStaticFiles(StaticFiles):
    """Keep slash canonicalization relative behind HTTP tunnel origins.

    Do not enable proxy/client-IP trust to correct an HTML directory redirect.
    Only StaticFiles' own redirects are changed; auth/external redirects and
    API routing retain their existing semantics.
    """

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        if response.status_code in (301, 302, 307, 308) and "location" in response.headers:
            location = urlsplit(response.headers["location"])
            # A leading // would be a network-path redirect. Keep exactly one
            # leading slash, retain URL-encoded path/query and drop authority.
            response.headers["location"] = urlunsplit(
                ("", "", "/" + location.path.lstrip("/"), location.query, "")
            )
        return response

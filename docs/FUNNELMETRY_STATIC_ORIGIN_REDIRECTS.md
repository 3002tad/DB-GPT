# Static page redirects behind the tunnel

The browser reaches DB-GPT over HTTPS, while the tunnel origin uses HTTP.
Starlette StaticFiles normally adds a directory's trailing slash using an
absolute URL derived from the ASGI scope. With the origin's HTTP scheme, an
HTTPS request such as `/construct/models-config` could redirect to an HTTP URL.
Secure cookies would not be sent to that URL, and embedded navigation could
also be blocked as mixed content.

`SameOriginStaticFiles` preserves the native slash redirect but changes its
Location to a relative path, including the encoded path, query and root_path.
It drops the authority and ensures a single leading slash so the browser keeps
its original scheme/host. The static HTML mount uses this implementation;
images served in HTML mode use it as well. Missing files remain 404.

No frontend route list or per-page redirect workaround is needed. The fix does
not enable Uvicorn proxy-header trust, alter the socket client IP, trust
forwarded Host/Proto headers, change cookie flags or relax Pipeline identity.
In particular, integrated mode retains `proxy_headers=False` for loopback-only
model endpoints. Auth/external redirects and API slash redirects are outside
this StaticFiles-specific change.

Tests simulate external HTTPS and an internal HTTP ASGI scope, following the
redirect with a Secure cookie. They also cover both export roots, Models,
Connectors, Evaluation, Knowledge, URL encoding, query/root_path preservation,
an untrusted forwarded host/client IP, and scheduler/static-route regressions.
These are fixture tests; live tunnel/browser acceptance remains necessary after
deployment. This correction does not rewrite Cloudflare configuration.

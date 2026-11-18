# Dashboard publication in Funnelmetry

## Workspace permissions

Analyst and Admin may publish dashboards on which they have the native
Dashboard PUBLISH capability. The Pipeline role admits the operation; object
ownership/membership and source authorization remain enforced by
DashboardService. Admin does not bypass ownership merely by being Admin.

The integration admits these exact routes:

- POST `dashboards/{id}/publish`
- GET/POST/DELETE `dashboards/{id}/live-share`
- GET `dashboards/{id}/publications`
- POST `dashboards/{id}/publications/{revision}/rotate`
- DELETE `dashboards/{id}/publications/{revision}`

All paths above are under `/api/v1/` and require a valid Pipeline session or
bearer. Existing revision checks and publication validation are unchanged.
Publishing a chart may still return a validation error if its data bindings
are incomplete; the fix does not turn validation failures into success.

## Shared links

Visitors holding a publication token can use GET
`/api/v1/public/dashboards/{token}` and POST
`/api/v1/public/dashboards/{token}/filter` without a Pipeline login. These are
the only publication-token exceptions in the identity middleware. Token
validation, expiry and revocation stay in the native publication services.
The filter endpoint applies supported filters to the authorized dataset;
visitors cannot submit SQL or modify the dashboard. Native live shares can
renew their bounded dataset and recheck their owner's source authorization.

Public share pages skip login discovery and workspace model/admin queries.
Opening a link does not clear an existing workspace identity in localStorage.

## RUN18-02 status

The user approved enabling publication/sharing for both roles on 2026-11-18.
Previously the editor displayed publication controls while the integration
policy denied both publish and live-share status, producing 403 responses.

Thirteen targeted tests passed with the pending source and current image's
dependencies in a separate process. They cover real publication endpoints,
identity middleware, SQLite data, both roles, anonymous reads/filters,
rotation/revocation, owner checks and live-source denial. No live data or LLM
was used. Code is not deployed; frontend build and Analyst browser acceptance
remain pending. Retest fixed and live links plus revocation after deployment.

## ADMIN18-02 verification

ADMIN18-02 has the same integration-policy cause as RUN18-02 and is covered by
the correction committed in `e05cda30`. It does not require a second permission
expansion. The editor and live-share control do not add an Admin-specific role
restriction; native object PUBLISH/source checks apply to both roles.

Follow-up regression passed 14 targeted backend tests, adding the full Admin
live-link lifecycle with an actor ID distinct from `super_admin`: publish,
live-share status/create, anonymous read/filter with fixture data, revoke and
subsequent rejection. Another Admin and a spoofed user-id header do not bypass
ownership. Existing fixed-snapshot rotation/revocation tests still pass for
both roles. No additional production policy/handler change was necessary.

This is source/fixture verification, not deployed-browser acceptance. Deploy
the committed fix and verify publication from each role before closing the live
incident; do not infer deployment from passing tests in a separate process.

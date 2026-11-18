# Semantic metadata and datasource registration

Semantic Center stores a separate registry (`sem_datasource`) and metadata
snapshots, meanings and versions. Datasources stores connection configuration
in `connect_config`. Deleting a connection removes its configuration, profile
and cached connector; it does not cascade-delete semantic definitions or
historical metadata. Automatic registration on connection creation does not
make these two registries the same lifecycle.

The Semantic Center list and detail APIs expose `connection_status` separately
from governance `status`:

| Value | Meaning |
| --- | --- |
| `configured` | `conn_id` is still registered as a datasource name. |
| `missing` | No connection configuration with that name exists. |
| `unknown` | The registration lookup failed; deletion is not established. |

This lookup selects names only, once per request. It opens no source connection,
returns no credentials, changes no stored semantic lifecycle and requires no
schema migration. `configured` is not a connectivity, freshness or quality
certificate. Reusing a name does not prove that the underlying source is
unchanged; review and synchronize the intended source before relying on it.

The UI labels missing registrations in the list and shows an explanation on
detail. Metadata and offline governance remain accessible. Sync is disabled
for a known missing registration, and the sync API returns HTTP 409 before
opening a connector (including requests with an alternate `db_name`). A
registry lookup failure is shown as unknown, not as deletion.

No automatic cascade, retired-metric rewrite, vector-chunk purge or credential
revocation is performed. Retained metadata is a previous snapshot; it must not
be presented as proof that the source remains live. Existing datasource policy
and query credentials still determine actual execution access.

## Verification

- `packages/dbgpt-app/src/dbgpt_app/tests/test_semantic_source_registration.py`:
  real SQLite metadata registry and FastAPI routes; removal, retention of table
  and semantic rows, unaffected source, missing-source sync, unknown registry and
  registration returning without a fabricated sync timestamp.
- `web/tests/pages/construct/semantic.registration.test.tsx`: real list/detail UI with
  API fixtures, localized warnings and action availability.

These are targeted regressions, not a live source reconnection or deployment
acceptance test.

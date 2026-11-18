# Manual model metadata

Admins can declare capabilities in **Model Providers → model row → Model
metadata**. Configure an explicit provider API endpoint first. This replaces
the attempted ADMIN18-07 automatic Qwen snapshot catalog; there is no Qwen ID
list, endpoint inference or automatic official-document lookup in this change.
The seven models from the audit remain unfilled until an operator supplies
their endpoint-specific values.

Fields:

| Field | Meaning |
| --- | --- |
| Context window | Total context tokens per request. |
| Maximum output | Maximum generated output tokens per request. |
| Function calling | Supported, unsupported, or unspecified. |
| Reference | Documentation or provider-console reference checked by the operator. |
| Date checked | Operator-supplied date of that check. |

Declared token counts must be positive integers; booleans and fractional values
are rejected by the API. When both token bounds are declared, output must not
exceed context. Any declaration requires a reference and check date. These are
**user declarations**, not automatic certification, remaining quota, TPM limits
or proof that a generation succeeded. The UI labels the provenance accordingly.

Empty fields retain existing adapter/catalog metadata. Clearing all fields
removes the effective override and restores normal fallback. A false function
calling declaration is distinct from unspecified. Metadata does not change
Agent policy or remove native tools/skills; it describes provider capabilities.

## Persistence and runtime

The additive table `dbgpt_model_manual_metadata` lives in DB-GPT's internal
metadata database (MySQL in the current deployment). Model service startup
creates this table with `checkfirst=True`; no existing columns, credentials or
chat history are rewritten. Deployments need permission to create this new
table. Existing rows survive repeated bootstrap. No Medusa or analytical
PostgreSQL schema is changed.

Rows are scoped to the exact configured endpoint and model name using a SHA-256
key; the registry does not duplicate endpoint credentials. Providers using the
same endpoint/model share that declaration. Changing endpoint or model does not
silently reuse another declaration. For one model, context/output/function
calling fields are replaced together by a form submission; null fields mean no
manual override. Server `updated_at` is distinct from the operator's check date.

The provider catalog and default worker read this same registry. The default
LLM client asks the worker for current metadata instead of keeping its old
process-lifetime metadata cache. Resolved context carries `user_config`
provenance; an explicitly smaller Agent budget remains effective. Existing
per-run Agent context managers keep their resolved budget for that run; start a
new run/session to exercise a changed declaration. No active generation is
stopped or restarted by saving the form.

This is implemented for the current deployment where model service and worker
share the DB-GPT metadata database in the same process. Remote workers without
access to that registry use ordinary adapter/fallback behavior; this change does
not certify distributed metadata synchronization. Registry reads fail open to
existing model metadata if unavailable; writes must succeed to claim a save.

## API and authorization

`PUT /api/v2/serve/model/providers/models/metadata` accepts provider, model and
the declaration. The endpoint uses the stored provider configuration, returns
no API key, and is allowed only for Pipeline Admin (`super_admin`). Analyst is
denied by backend policy; unauthenticated requests still require login.

## Verification

- `test_manual_model_metadata.py`: real temporary SQLite, FastAPI, Pipeline
  identity/policy, numeric/provenance validation, persistence/bootstrap, worker
  and context-budget propagation, clear/fallback, endpoint isolation and fresh
  default-client metadata reads.
- `ManualModelMetadataForm.test.tsx`: real Ant form submission and validation.
- `ModelContextMetadata.test.tsx`: declared provenance, quota distinction and
  unknown-window display.

These tests do not call a paid model or certify user-entered numeric values.

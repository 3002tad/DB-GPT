# TaskFlow datasource selection

The chat composer can select a datasource for a TaskFlow run. This is an
execution binding, not just an attachment displayed above the message.

## Request and execution

1. The composer sends `ext_info.database_name` alongside the flow UID.
2. Chat completions forwards the name in `CommonLLMHttpRequestBody.extra`.
3. The flow service copies the saved DSL and binds database Agent nodes,
   database-query nodes and database-backed chart nodes to the selected source.
4. Pipeline integration checks the effective datasource bindings against the
   actor's existing analytical-source policy before building the DAG.
5. The service compiles a private DAG for this run. It does not update the
   saved flow, template, localStorage template-instance cache or deployed DAG.

An explicit chat selection applies to the database nodes throughout the run.
Without a chat selection, the flow retains its configured sources, including
multiple sources; their existing authorization still applies. Non-database
tools, skills, knowledge resources and file-only charts are preserved. No
fallback to a sample database occurs for an invalid selection. Legacy AWEL
flows without a selection keep their previous execution path; an explicit
override is supported only for TaskFlow DSL flows.

## RUN18-01 regression

The DB Data Fetch built-in template contains `Walmart_Sales` in three Agent
nodes. Previously the chat displayed the selected Funnelmetry database but
did not include it in the workflow request. The template's cached instance
therefore queried Walmart. This correction also handles existing saved
instances, because it resolves the binding at execution time.

Targeted checks cover API forwarding, all three Agents in a compiled DAG,
default and multi-source preservation, forbidden-source rejection before
execution and independent concurrent runs. Model responses are controlled
in these tests; they do not call a provider or prove live PostgreSQL results.

Tests:

- `packages/dbgpt-serve/src/dbgpt_serve/flow/tests/test_taskflow_bindings.py`
- `packages/dbgpt-app/src/dbgpt_app/tests/test_pipeline_module_access.py`

Source regression passed on 2026-11-18 using the current image's dependencies
in a separate test process. Deployment and the Analyst UI retest are pending.
Acceptance after deployment must query `funnelmetry_demo.sessions`, verify
the actual source and compare the count to PostgreSQL. `SELECT 2+3` alone
cannot certify that this binding defect is resolved on the VPS.

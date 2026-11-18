# Conversation continuity and analytical execution feedback

Funnelmetry preserves native DB-GPT SQL, Python, tools and workflows. These
adapters carry resource selections, actual execution status and evidence across
turns; they do not introduce a fixed analytical workflow or a model-call cap.

## Resource selections

Each version-2 ReAct history envelope can contain `resource_context`: an
allowlisted snapshot of database name/type, KB name/ID and skill name/ID. It
contains no credentials, connector configuration, prompt or raw data. Success,
interruption and error checkpoint paths use the same snapshot builder.

On history load, the UI resolves references against the current actor's listed
datasources, knowledge spaces and skills. Missing resources are left unselected
with a visible warning. Backend access checks still apply on every execution.
An explicit empty snapshot clears earlier selections; the UI does not silently
reapply them. Legacy histories support only the known attachment prefixes and
the recorded `skill-read-selected` event, not resource names inferred from prose.
Sending waits for resource restoration to finish; conversation epochs reject
late restoration from another task. No browser localStorage is authoritative.

## Reusing evidence

The owner/session-scoped evidence catalog supplies previous artifacts on ordinary
follow-ups, in addition to explicit report recovery. Original run IDs, source
query, selectors, truncation and timestamps remain attached. Evidence reuse does
not certify unchanged source freshness or allow adding separate aggregates to
invent a new grain. Query additional rows or aggregates when a finer question
needs them. A current snapshot is not a historical observation.

Python receives captured SQL through `SQL_RESULTS` and `sql_result_frame(index)`.
Using an input records its artifact ID; the nonexistent `db_gpt_tools` module is
not required. Python computations on constants remain available. Their metadata
and tool result mark uncaptured inputs; metric coordinates from such computations
are `computation_only`, not proof of source observations. When current-turn
Python results lack input lineage in a source-analysis session, the final answer
includes an explicit evidence limitation. This is provenance feedback, not a
proof of arbitrary free-text accuracy or an automatic audit of every script.

## Tool errors and recovery

Python failures, timeouts, invalid syntax and empty input return `success=false`
and stable `error_code` values. Native tool action status therefore agrees with
the captured artifact's execution status. Recovery hints explain missing input
or imports without disabling Python or other tools.

Missing datasource has a distinct nonretryable-condition result; selecting a
source repairs it, changing SQL does not. Repeated-result recovery recognizes
single envelopes as well as batches and identifies this error across changed
SQL. It advises a different next action without limiting Agent reasoning.

After undefined relation/column or chart execution errors, bounded schema hints
use the selected connector's granted relation inventory. The metadata lookup is
cached for the turn and waits at most five seconds; cancellation of that wait
does not guarantee a synchronous connector thread was stopped. The adapter
never rewrites model SQL or adds source columns. It does not infer relationship
cardinality from names; the Agent must verify joins, grain and fanout.

HTML binding errors retain full diagnostics in the existing checkpoint and send
a bounded 3,000-character error preview with targeted repair guidance. Existing
artifact/target/selector validation stays active. Full HTML and successful
analysis do not need to be regenerated to repair a missing binding.

## Stream and UI state

While the native ReAct SSE queue is idle, a comment heartbeat is sent every ten
seconds. It is transport traffic, not an Agent step or persisted message, and
does not call an LLM. It reduces idle disconnect risk but does not guarantee a
browser/proxy/provider connection remains available.

Trace failures include exception class and whether the LLM call was cancelled,
even when the exception's string is empty. Transport closure logs distinguish
closure before/after final delivery. No prompt or tool payload is added to these
diagnostic fields.

The UI retains partial Markdown and artifacts when the stream ends prematurely,
marks the turn interrupted, and settles active tasks. A delivered final answer
is not overwritten by a later transport error. Explicit backend errors remain
failed executions. Reopening history retains incomplete stages rather than
claiming completion. Replayed step IDs are deduplicated using the latest stored
version; displayed step counts are recorded execution steps, not provider calls.

These changes need a newly built/deployed image and a targeted browser
follow-up/reload/long-wait check before live acceptance. Unit/regression tests
alone do not establish provider reliability, analytical answer correctness or
that an earlier transport failure was caused by Cloudflare.

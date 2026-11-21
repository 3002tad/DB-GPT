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

## Conversation model

The Agent composer restores an explicit model from its URL, then the latest
persisted view turn, before using the server default. A manual selection updates
only the model query parameter (shallow replace), preserving the task and its
resources. The selector, request and context meter use the same resolved model.
Unavailable models fall back to the usable inventory; no context measurement
from another model is relabeled as the selected one.

New ReAct checkpoints store `model_name` even before a context measurement exists.
History returns the recorded message/turn model instead of stamping the current
server default onto every message. Older ReAct turns can recover it from the
latest valid timestamped context snapshot. Unknown legacy turns remain unknown.
History loading is scoped to the conversation and blocks sending until restored;
a late response cannot replace an explicit model selection. No model migration,
history rewrite or LLM call is needed to restore these preferences.

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

SQL-to-Python handoff also supports stable producer IDs:
`df = sql_result_frame('sql-...')` or `sql_result_frame(artifact_id='sql-...')`.
The SQL tool returns this exact loader in `python_input`, before row previews.
`SQL_RESULT_CATALOG` lists the available IDs, SQL, columns, row counts and
truncation flags without reading the datasets or recording input lineage.
Selecting an ID reads only that producer, preserving full results and typed
values; a later query cannot silently change the meaning of the selected ID.
Numeric indexes remain supported for existing skills.

Unavailable IDs return an actionable Python input error. Literal computations
still execute; when they have no captured inputs, the tool explains how to
recompute from a captured source. Comments and self-declared artifact IDs in
`REPORT_RESULT` do not establish provenance, even if their numbers happen to
match SQL. Recorded lineage means an input was accessed, not that every output
depends on it or that arbitrary code/narrative has been certified. No AST
rewriting, content-based auto-binding or new mandatory execution gate is added.

## Tool errors and recovery

Python exposes `OUTPUT_DIR` as an alias of the existing per-conversation
`PLOT_DIR`. Use `output_path('exports/summary.csv')` or
`output_path('plots/chart.png')` to create the required parent directories there;
relative native file paths still use the same working directory. The helper
does not create a global `/app/workspace`, rewrite arbitrary Python paths, or
extend file permissions. Its path validation applies to the helper, not all code.

Assign `REPORT_RESULT` directly to capture NumPy scalars and typed values.
When JSON text is needed for printing or saving, `result_json(REPORT_RESULT)`
uses exactly the capture normalizer: booleans/numbers retain their types,
Decimal/date/nonfinite values retain typed representations, and unsupported
objects remain errors. It does not monkeypatch `json.dumps`, stringify unknown
objects, or certify the computation's source lineage. Direct native JSON errors
and missing export directories remain failed calls with specific recovery hints.
Each Python call starts fresh variables; files in the same workspace persist.

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

## Requested outputs and failed report delivery

Report generation is an available capability, not a mandatory final phase of
every analysis. The report policy, general/skill prompts, restored-draft prompts
and Python image feedback follow the current requested outputs. CSV/PNG exports
and chat answers do not imply an extra HTML report. Report, SQL and Python tools
remain available; this is guidance rather than a keyword-based tool restriction.

When a report fails, the final response retains the existing analytical answer
and export links, followed by a short localized delivery limitation. Known raw
report diagnostic blocks are removed from the final narrative. The full error
and saved draft remain in report state/checkpoint and execution steps for repair;
no evidence binding validation is bypassed. A failed render does not publish a
ready report ID. History and terminal SSE receive the same final content. This
does not reconstruct an analytical answer if the model supplied only an error.

Targeted regressions cover long binding failures, interrupted executions,
preserved SQL evidence, final/history consistency and successful report
publication. Browser delivery and the model's output choices require live
acceptance on the rebuilt version; unit tests do not certify those behaviors.

## Generated CSV and image files

The artifact rail resolves path-only file metadata through the existing file
endpoint. CSV and other supported text files show escaped plain text, with a
bounded preview and a notice when truncated. Supported images load as blobs;
switching the selected file cancels the previous request and releases its object
URL. Reloaded artifacts do not need inline content to be previewable.

Bundle downloads fetch the actual bytes with the actor header and session cookies,
instead of saving file metadata as JSON. Missing URLs and HTTP errors are shown as
unavailable files; they do not trigger `/undefined` requests or successful empty
downloads. Inline text, report references and query artifacts retain their own
renderers. Existing server path/access checks remain authoritative; a file outside
the served roots is still unavailable. This does not certify that every filename
discovered from model/tool text exists (the artifact discovery issue is separate).

## Observed output files

File cards are built from typed producer outputs, not a regex scan of final
answers, code, stdout, stderr or tracebacks. Python and shell compare workspace
file signatures before and after execution; the main/sub-agent skill adapters
also emit actual changed non-image exports. Existing image publication remains
separate, avoiding a second card for an already published Python image.

File metadata includes size, SHA256, `existence_verified` and `producer_status`.
An output saved before a failed execution remains accessible with failed producer
status. Presence does not certify analytical correctness or execution success.
Unchanged files, missing files, symlinks, execution controls and known dependency
or cache trees do not become new outputs. Files outside the workspace are not
automatically discovered from a path printed in text; tool execution permissions
are unchanged. This observation is not a guarantee of later availability or
exclusive authorship when tools run concurrently in a shared workspace.

Typed legacy exports and native file-write acknowledgements remain compatible;
their metadata is not retroactively marked existence-verified. History reload
uses stored typed outputs, including sub-agent file chunks. A legacy filename
mentioned only in prose no longer creates a downloadable card. Old history is
not rewritten and vanished files still report unavailable at preview/download.

## Native SQL charts in chat

`chart_query` continues to use ChartAction for read-only SQL, native chart
generation and SQL-to-chart evidence capture. Its result now carries a typed
`chart` chunk with the native `vis-db-chart` payload, rather than relying on the
model to reproduce a Markdown chart block. Captured chart/source IDs are attached
when available; the adapter does not query again to build the UI payload.

Chat renders the structured chart with the existing native ChartView/AutoChart.
It remains visible when other artifacts are consolidated into a bundle, and is
also available in the rail and execution details. ChartView loads client-side;
chart, SQL and data tabs remain accessible. Empty queries show the empty state
and data/SQL tabs instead of inventing a zero-valued graph. Malformed payloads
are not promoted into native charts.

History restoration recognizes the exact fenced `vis-db-chart` protocol in
recorded tool outputs. It does not treat arbitrary model JSON as a chart, rewrite
old history, or execute SQL/LLM calls on reload. Harness envelopes and sub-agent
recorded chunks preserve typed charts too. Generic chart tool outputs retain
their existing renderer. Guidance discourages copying chart JSON into prose,
but does not certify that every model final answer follows that guidance.

Regression tests verify real SQL/capture and UI delivery separately. UI tests
replace only the G2 canvas with a test renderer to verify payloads and tabs;
real browser canvas visibility/rendering still requires acceptance after deploy.

## Tool discovery and aggregate SQL recovery

Turn guidance lists callable names separately from discoverable names. Before
using a function whose schema is not supplied, the Agent is instructed to search
its canonical name/capability, wait for discovery, then use the returned schema
on the next round. Discovery does not grant permissions or activate a guessed
function automatically. An empty search does not claim next-round availability.

A missing tool returns `TOOL_NOT_ACTIVE` with a discovery hint only when the
current ToolPack actually has `tool_search`. Missing required arguments return
the registered parameter schema, including optional fields, before execution or
approval. Native transport can additionally supply its public `intention` field;
that is not an argument of the underlying tool. No argument names/SQL are inferred
or rewritten on the model's behalf, and existing authorization checks remain.

SQL grouping failures (`42803`, nested aggregates or grouped-column diagnostics)
return `SQL_GROUPING_ERROR` with subquery/CTE recovery guidance. The Agent retains
responsibility for grain, DISTINCT keys, NULL semantics, scope and overlapping
groups; summing group counts is not automatically a global distinct count. Valid
aggregate window expressions remain available. These are actionable feedback and
prompt guidance, not a SQL grammar gate or a fixed analytical workflow.

## Execution summary across reloads

Version-1 `execution_summary` inside ReAct history carries `recorded_steps` and
`tool_steps`, plus optional `duration_ms`/`duration_complete`. Terminal SSE copies
this exact summary from the persisted history payload. The composer status line
uses the summary for both live completion and reload; legacy payloads fall back
to the same unique-visible-step counting rule without inventing a duration.

Repeated IDs update one visible step (notably the task-plan card). Progress and
terminate are excluded. Different IDs preserve distinct failed/retried steps.
These are recorded UI steps/tool steps, not provider requests, model rounds,
atomic tool invocations inside a batch, or a recursive total of sub-agent calls.
The vi/en/zh labels explicitly say tool steps.

Turn duration uses the server monotonic clock from ReAct implementation startup
through terminal history assembly, including model/tool/approval waiting. It is
wall duration, not Python CPU time or provider latency. It freezes on terminal
success, failure or interruption; refreshing cannot increase it. Running
checkpoints retain a partial measurement, but the status line only displays a
complete duration. No browser receipt-time estimate is presented as a durable
measurement. Existing history is not rewritten, and missing measurements remain
unknown. Other harnesses without this summary continue using the legacy fallback.

## Approval review and Vietnamese intent

Approval cards keep a bounded preview; **View complete arguments** fetches all
arguments from `GET /api/v1/chat/approval/{id}/details` only when requested.
Both trusted Pipeline roles can access this route, and the handler checks the
conversation owner in integrated mode. Viewing does not resolve an approval or
execute a tool. Full code remains outside compact SSE/audit payloads; the UI
renders it as escaped, scrollable text. A failed fetch can be retried.

Intent analysis and its unavailable-analyzer fallback support Vietnamese.
The scope selector uses localized labels and explains that **once** approves
one invocation. Code session/always memory matches the exact script and all
arguments; changing either requires a fresh decision. Strict mode can still
ask again. This is existing permission behavior, not a restriction added to the
Agent. No automatic broad grant or change to SQL/tool capabilities is made.

## Usage availability at conversation creation

The Agent UI allocates a conversation ID before sending a turn (or uploading
files). That ID does not prove an owned conversation row exists. ReAct emits
`conversation.ready` with `conversation_id` immediately after the initial
storage save succeeds; Pi emits the same event only if opening storage succeeds.
The Agent token meter waits for this acknowledgement, or a successful owned
history load, before making usage requests. Epoch/ID checks and owner-scoped
readiness prevent late responses from enabling another task's meter. The native
TaskFlow stream keeps its existing polling behavior; it does not consume this
ReAct/Pi acknowledgement.

After acknowledgement, polling during execution, the final delayed refresh and
focus refresh remain unchanged. An empty provider aggregate is unknown, not
zero; real token totals continue coming from the provider aggregate. Invalid or
foreign conversation IDs still fail the existing backend ownership check; no
404-to-success translation or pre-persistence telemetry access is introduced.
This event is additive and creates no database migration or history rewrite.
Deploy the client and streaming backend together to enable first-turn polling;
old histories restore readiness through the authenticated history endpoint.

## Native prompt and history input duplication

The native ReAct objective stays in the current user message, rather than being
copied into the system prompt as well. An exactly matching `Question: ...` memory
entry is omitted only if that exact user prompt is present. Observations, errors,
reasoning and distinct historical user requests remain. The legacy text protocol
keeps its existing objective rendering.

The system template and native request adapter share one protocol instruction;
the adapter adds it only if absent. All tool schemas, tool choice, reasoning,
output budgets and recovery guidance remain available. History projection now
preserves known roles rather than alternating them by array position, without
mutating the supplied messages. Identical AI/view answer representations collapse
only within a known positive round; different replies, unknown rounds and later
questions are retained. This changes request projection, not stored history.

`Native request shape` logs aggregate character lengths by role, tool-call payload
length and tool schema size after context management. It contains no message text,
tool names or arguments. Characters are diagnostic sizes, not token estimates or
provider billing; provider usage remains authoritative. Full tool definitions and
historical evidence still cost input on each model call. No percentage reduction
in real usage is certified by unit tests; compare the same prompts/provider model
after deployment, checking follow-up accuracy as well as reported input usage.

## Reference counts are not document counts

The answer footer and references tab count retrieved reference entries/excerpts.
Several excerpts can belong to the same document. The vi/en/zh labels and panel
explanation make this distinction explicit; the compact tab count has the same
accessible label and tooltip as the footer. No independent-document count is
inferred from display names, chunk IDs or array length. Existing citation indexes,
IDs, source names, excerpts and navigation remain unchanged, including reloaded
history. Semantic metadata objects and SQL evidence keep their separate panels.

## Time-series narrative scope

Chat prompt construction and the active report-object author share concise
`TREND_GUIDANCE`. The ecommerce analysis skill repeats the relevant behavioral
rule in Vietnamese. A trend claim needs a stated interval and grain, adjacent
observations, intervening reversals and the latest segment. Net endpoint growth,
a rebound in the last period and sustained recovery are different claims.
Missing/null, irregular or partial periods cannot be silently converted to zero
or a complete consecutive sequence. A smoothed chart is not the numeric source.

Use SQL/Python on captured inputs when comparison evidence is missing; reuse
sufficient existing results. This does not add mandatory extra queries, a tool
gate, a sentence-removal filter or a forced analytical workflow. Unit tests check
prompt delivery and compatibility, not empirical LLM narrative correctness.

After deployment, the following **synthetic test cases** can be given as captured
SQL/Python results (not as historical measurements from the reference shop):

| Observations | Expected distinction |
| --- | --- |
| Jun=100, Jul=80, Aug=60, Sep=40, Oct=50 | Three declines then one rebound; not gradual recovery throughout Jun–Oct. |
| 40, 50, 60, 70 in complete consecutive periods | Observed increases across that interval; no causal or future-growth claim. |
| 60, 80, 80, 70 | Positive endpoint change can coexist with a flat segment and a latest decline. |
| 100, NULL, 120 | Missing value, not zero; do not certify a continuous increase. |
| Jun=100, Aug=120, Oct=140 | Observed increases at irregular intervals do not establish consecutive monthly growth. |
| 0, 10 | Absolute increase is observable; percentage growth from zero is undefined. |

The original DEEP18-14 case specifically requires naming the Jun→Jul→Aug→Sep
declines before the October rebound. The actual values must come from its
captured data; the synthetic values above must never be substituted for them.

## Confirmed clarification scope

Question-tool answers are retained separately from the rolling tool transcript.
Only answered pairs are recorded; rejected, timed-out and empty answers do not
become decisions. Server history snapshots carry `user_decisions` on progress,
error and final paths. Older histories recover only structured question-tool
recaps, never model prose. No new table or localStorage cache is required.

Native calls receive one compact chronological projection in system context.
Explicit later corrections and the current user request take precedence.
Repinning replaces the previous projection instead of accumulating copies.
The final review instruction checks period, ranking criterion, top-N and grain;
it is behavioral guidance, not a claim that model compliance is guaranteed.

Terminal turns leave unfinished plan objectives pending with an explanation;
they are not inferred completed from a successful SQL read, or cancelled merely
to remove them from the completion denominator. The user can continue the task.

The backend no longer advances analysis tasks from words in thoughts, tool
counts or mentions of the next task. Explicit `todowrite` updates own analysis
progress. A task may use `kind=final_response` for final chat delivery, not data
collection, calculations, file exports or report generation. Successful final
delivery reconciles that task and emits a plan update before persisting history.
For older plans, narrowly recognized final-summary labels (including Vietnamese)
can reconcile the single remaining pending task; unrelated pending analysis is
never inferred complete. Task completion does not certify analytical claims.

## Generated chart delivery

In Pipeline identity mode, persisted `/images/<name>` URLs are internally routed
to `/api/v1/chat/generated-image/<name>`. GET/HEAD require the normal verified
actor via cookie or Bearer and ownership of the image. A per-image index is
written before emitting live image chunks; old images fall back to structured
image evidence in that actor's stored conversation history. A URL merely quoted
in user prose does not grant access. Files outside the generated-image root,
directory listings and non-image files remain unavailable. No public static
image directory is opened and no image bytes enter model prompts.

Image responses are private/non-cacheable with nosniff and sandbox CSP. Failure
to write the derived ownership index does not abort analytical execution; history
is the fallback. A later owner cannot overwrite the first index entry. Source
verification covers authenticated rendering, other-owner rejection, traversal,
native history recovery and GET/HEAD responses. Live/browser acceptance is still
required after deploying this change.

Final answers replace unambiguous inline local `plots/...` image paths only with
actual generated URLs returned in this turn; code fences and ambiguous/missing
filenames are retained. Trend guidance distinguishes partial weeks, half-month
descriptive differences and statistical tests, while keeping tools/thinking
available. These instructions require a new model evaluation for acceptance.

## Follow-up evidence inventory and result reuse

Conversational ReAct prepends a bounded inventory of successful captures from
earlier turns in the same owner/conversation, using the existing EvidenceCatalog
and SessionArtifactSink. No new database or result-row copy is created. The
initial metadata payload is bounded to approximately 6,500 characters with
total/shown/omitted counts. SQL/Python captures take priority over incidental
file/reference captures. No result blob is read to build this prompt.

Entries contain artifact/run IDs, capture time, logical database, columns,
row count, SQL excerpt/hash, input artifact IDs and saved scalar field labels.
Recorded grain, scope, time window, parameters, quality and semantic version
are included only when captured. Unknown scope remains unknown; SQL excerpts
and producer labels are not certified business definitions. Capture time does
not establish source freshness. Different sources, periods, filters or grains
can require new queries; monthly totals cannot provide daily observations.

`session_evidence` is available at the start of ordinary analytical turns and
through suite filtering unless explicitly denied. It searches/paginates all
successful captures, including entries omitted from the prompt. An artifact ID
exposes saved scalar coordinates; `read_values=true` reads the integrity-checked
original result without a source query. Each scalar page reads its blob once,
retains producer/authority labels and reports corrupt/missing results. SQL
tables remain accessible through Python `sql_result_frame(artifact_id)` when
authorized. Other artifact entries are locators for their native tools.

The tool is scoped by the existing owner/session catalog, with no caller-supplied
owner or conversation. It exposes no blob URI/private path or connection secret.
Inventory contents are data, not executable instructions. Capture failure leaves
analysis tools available. Constrained modes lacking this tool, including a
greeting-only turn, receive no instructions to call it. This change covers
conversational ReAct, not the separate Pi harness.

Reuse is an informed Agent choice, not a SQL cache or execution gate. No prior
narrative becomes evidence and no old observation is silently refreshed. Source
regression and read-only real-catalog checks pass; model behavior and token
savings require evaluation after deployment.

## Native public final responses

With native `tool_choice=auto`, a provider may finish with public text and no
tool calls. The current response is retained ephemerally and consumed once by
`act()` only when its text matches the message being executed. It follows the
ordinary final-answer verification path; no synthetic provider tool call is
recorded. This ends the turn, not a certification of claims or pending plan work.

Private reasoning, explicit ReAct/tool-call wrappers, errored responses and
explicit non-stop finish reasons (including length/filter termination) cannot
use this path. A new model request clears the previous candidate. Legacy
adapters without finish_reason remain supported. Valid native calls still take
precedence over accompanying prose. Actual protocol failures retain bounded
repair, a failure category and a Vietnamese/English terminal explanation.

Interpretation guidance also requires computed ratios/complements, declared
timezone for filtering and grouping, duration-aware hourly comparisons, and
separation of checkout starts from abandonment. These instructions do not act as
a SQL gate or certify LLM arithmetic. Regression and saved-output replay cover
delivery; a model evaluation is still required for explanation quality.

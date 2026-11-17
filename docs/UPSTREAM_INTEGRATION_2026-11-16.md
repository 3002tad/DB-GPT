# Upstream integration candidate ? 2026-11-16

Status: SOURCE MERGE CANDIDATE / NOT DEPLOYMENT ACCEPTED.

The user authorized a separate integration branch containing all upstream main
updates and PRs #3373, #3389, #3380 and #3404. Main and the VPS runtime are not
changed by this integration. Open PR heads are development snapshots, not
upstream releases. #3348 and #3373 are already included in upstream main; the
#3373 branch is also merged to retain its ancestry and relocated tests.

## Pinned inputs

- `main`: `90431ed62c9cf6067e1f6ad4d135aa18dd9c1081`
- `upstream/main`: `584a71b36330258d42a337dbfc1d7737e16ca58a`
- `upstream/pr-3373`: `938983a6a5992f8877c300c5b1850458fe01b530`
- `upstream/pr-3389`: `857b9560ef36b4e70d6491f085c627ddc7f00309`
- `upstream/pr-3380`: `f3cb3630a93c6cc408ad503f8bfd532dccd20312`
- `upstream/pr-3404`: `54f7660dc86744275ec5a2adfe18ea2bb95ddb43`

## Conflict decisions

- Integrate upstream Dashboard translation namespace and template flow. Bridge
  its English strings through the existing Vietnamese dictionary/dynamic
  translator. Unmapped new strings can fall back to English; this is not a new
  complete Vietnamese localization acceptance.
- Preserve Pipeline identity, role filters, embedded return link, theme bridge,
  selected-model pinning, provider usage and advisory progress. Preserve the
  fork's concise prompt and quality guidance while accepting upstream tool
  discovery, semantic-center and plugin code.
- Preserve MCP isError handling together with the new tool-argument validation
  and approval hook. Preserve SQL timeout/cancellation, schema-discovery recovery
  and quality warnings together with the new structured query artifact.
- Use upstream's shared subagent SQL implementation. Keep fork regression tests
  separately where upstream moved/replaced the original suites.
- Register chart/report capabilities alongside upstream native tools before
  tool consolidation and suite filtering. Prompt/tool-name compatibility needs
  runtime verification, especially `code`, `bash`, `run_skill_script` and reports.
- Use a coherent PR #3404 bundled static tree instead of attempting to merge
  generated hashes. It is upstream output, NOT a build of merged Funnelmetry
  source. A fresh source UI build and copy are mandatory before deployment.

## Checks performed

- Python AST parsing of changed source: passed.
- TypeScript parser over changed UI source: zero parse errors.
- TypeScript name scan with no dependency resolution: fixed missing navigation
  icon; only Node `setImmediate` test globals remain. This is not full typecheck.
- Existing claim-guard unittest suite: 22 passed.
- Existing prompt-budget unittest suite: 5 passed after compatibility fixes.
  The upstream prompt has no separate CODEGRAPH/image-hint interpolation; KB
  tools/descriptions and actual file/KB/database context remain. Tests assert
  those real contexts and the current code/bash/html tool factories instead of
  removed placeholders. Selected-skill analysis now includes code and read_file.
- Turn tool-availability tests: 4 passed. Guidance follows actual active names
  and discoverable catalog; knowledge-only and suite-bound turns do not receive
  instructions to call an unregistered tool_search.
- Local checkout has no web node_modules or complete Python dependency environment;
  full TypeScript, backend/import tests and UI build remain pending.

## Required before deployment acceptance

1. Verify the repaired prompt/tool compatibility at runtime: native tool names
   and discovery, selected skill/KB, lead/child evidence and report delivery.
2. Run full typecheck/build and focused SQL, MCP, subagent, report, semantic and
   plugin regressions in the installed dependency environment.
3. Reconcile newly introduced APIs/modules with Pipeline Admin/Analyst policy;
   verify access rather than adding blanket URL-prefix permissions.
4. Confirm Semantic Center remains consistent with Funnelmetry's authoritative
   PostgreSQL semantic catalog. Importing its code does not approve a second
   competing metric authority, an alternative engine cutover or new mandatory
   execution isolation (DEC-147/148/149 still apply).
5. Smoke-test login/embed/theme/navigation and one scoped analytical question.
   The Q08 101750-versus-57475 issue is not proven fixed by this merge.

No LLM calls, KB publication, data migration, VPS rebuild or deployment were
performed for this source integration.

## Follow-up tool compatibility repair

Follow upstream's canonical code/bash/run_skill_script names and dynamic catalog.
Do not restore retired model entries or eagerly expose every tool for a selected
skill. Keep renamed capabilities in the discoverable catalog; tool_search activates
them for the next round. Guidance is generated from the real turn pack, so it
cannot tell a knowledge-only Agent to call an absent discovery function.
Owned skill/report prompts use canonical names. Loaded historical skill guidance
is explained by alias hints only when its canonical capability is available.
The report agent still delegates missing calculations via its upstream protocol.
These offline checks do not establish that Q08 is corrected or that all newly
introduced modules pass runtime policy checks.

## Pre-commit review ? 2026-11-16

### Confirmed repairs

- Fixed a merge regression in next.config.js: static export defaults to same
  public origin, while local development retains localhost:5670. Explicit empty
  API_BASE_URL is respected. Five Node tests execute the actual config with
  plugin-loading stubs and verify origins, identity flags and TS checking.
- Fixed interpolation of Vietnamese Dashboard templates after translation,
  including numeric zero. Four Node tests transpile and exercise the actual
  helper with i18next/resource stubs; they do not certify the full locale pack.
- Tool names, discovery and selected-skill code/read_file registration repairs
  are described above. No blanket permission expansion was made in this review.

### Verified checks and limits

- 61 Python tests passed, plus nine unittest subtests: Pipeline identity/role
  regressions, prompt-budget compatibility, tool availability and claim guard.
- Nine focused Node tests passed (five origin and four Vietnamese bridge).
- 335 changed Python files passed AST parsing and pyflakes undefined-name scan.
- Changed TypeScript source passed parser and limited noResolve name scanning;
  setImmediate in tests needs Node typings. This is NOT a complete typecheck.
- Main remains 90431ed6. All five fetched upstream refs are ancestors of the
  integration branch. No unresolved git conflicts remain.

### Deployment blockers identified during review (see follow-up below)

1. The Pipeline boundary denies the newly introduced routes for BOTH Analyst
   and Admin: GET /api/v1/suites, GET /api/v1/semantic/spaces,
   POST /api/v1/chat/sql/run, GET /api/v1/chat/approval/pending.
   Native pages depending on these will receive 403. Review each module's
   read/write authority, ownership and UI actions before enabling exact routes.
   Existing identity tests passing does not establish new-module coverage.
2. Full dependency-based TypeScript/backend tests and UI build are pending.
   In particular SQL/MCP/report/subagent tests and Semantic/Plugins bootstrap
   have not been executed in the complete application environment.
3. Bundled static output still comes from the upstream PR. Rebuild from merged
   source before deployment; do not use the committed bundle as acceptance proof.
4. Upstream introduces new UI/financial/plugin copy. Existing Vietnamese UI is
   not a complete localization of new modules; their fallbacks need UI review.

Source can be kept on the integration branch for further development, but this
review does not approve merging it into main or deploying over the VPS runtime.
No additional commit/push or model call was performed during this review.

## API / Pipeline policy compatibility follow-up

The route-policy blocker above is repaired at source level, not yet certified
through a deployed HTTP/UI test. Policy uses exact methods and endpoint shapes,
not a wildcard allowing all /api/v1 routes.

| Module | Analyst | Admin |
| --- | --- | --- |
| Semantic metadata: browse, sync/activate, drafts, review, metric publication | Shared trusted analytical workspace | Same |
| Plugins: browse/use, enable/disable, import/create/edit/build/install/configure/remove | Shared trusted workspace, consistent with existing skill management | Same |
| Plugin registry global rescan (/suites/sync) | Denied, including its mutating GET | Allowed |
| SQL edit/re-run | Owned conversation, existing datasource grant, read-only SQL | Same |
| Approval pending/log and resolve once/session | Owned conversation | Same |
| Approval session mode | Own existing or new conversation | Same |
| Global approval policy/whitelist, engine settings | Denied | Allowed |
| Resolve approval with global always scope | Denied and option hidden | Allowed for owned conversation |
| Loopback harness tool runner/status/file-serving API | Not added to public role allowlist | Not added to public role allowlist |

Additional handler changes:

- Pending approvals and resolution require an existing owned conversation in
  Pipeline mode. Session-mode changes use the existing ownership guard that
  also permits a new conversation, preserving the new-task workflow.
- Semantic connector creation reuses PipelineDataSourcePolicy's pinned source,
  PostgreSQL type and connection-identity checks. Backfill checks the connector
  before registering a space, so it cannot sync an internal credentials DB.
- Standalone DB-GPT retains its native behavior when Pipeline identity is off.
- Semantic Center definitions remain DB-GPT-local analytical metadata. API access
  does not make them authoritative Funnelmetry metrics or replace the PostgreSQL
  semantic catalog (DEC-147/149).

Validation: 69 focused Python tests pass (plus nine subtests), including seven
new tests that compare the real upstream route decorators with role policy,
exercise ownership/resolve handlers in isolation, verify global-scope rejection
before mutation, and check semantic connector grants. Nine Node origin/locale
tests remain passing. Changed TypeScript parses; full typecheck/build, database
bootstrap and deployed UI/network validation are still required. Isolated handler
checks are not a full ASGI/DB integration test. Main/VPS remain unchanged.

## UI TypeScript repair validation

VPS worktree /srv/KLTN/DB-GPT-integration-build was based on e5c2837e,
then received the local UI repair patch without changing the running service.
Full `tsc --noEmit --pretty false --incremental false` completed with exit 0.
Repairs cover duplicate locale properties, obsolete API arguments, event callback
signatures, typed query artifacts with required-field checks, the artifact_bundle
union member, test fixtures and stale sidebar fields. No ignoreBuildErrors or
broad any cast was added to suppress the compiler.

Focused Vitest run: SemanticProvenance, QuestionDock, chart-content-size and
query-export tests passed. app/i18n.test.ts still has two failures: the synthetic
voice-source label falls back to English and newly merged English keys lack
Vietnamese entries. These are localization coverage gaps, not TypeScript errors;
the checks were retained. Existing QuestionDock act warnings were also observed.
No UI build/image rebuild, commit, push or deployment was performed for this
repair patch; the backend-candidate image still points to e5c2837e.

## Vietnamese coverage follow-up

Both remaining i18n failures are resolved. Added upstream-integration.ts with
Vietnamese values for 838 previously missing top-level entries (941 string
leaves, including the nested Semantic Center). Existing Vietnamese definitions
are retained. The synthetic voice-source label is translated in the Dashboard
copy bridge, while unknown/user-defined source names remain unchanged.

The coverage and interpolation tests now recurse through nested translations;
they are not relaxed to accept English fallback as Vietnamese coverage. English
and Chinese locale selection and unknown-key fallback remain supported.

VPS verification on the integration worktree plus this patch:
- app/i18n.test.ts: 11/11 passed, including nested key coverage and placeholder parity.
- Full tsc --noEmit --pretty false --incremental false: exit 0.
- git diff --check: passed locally.

This verifies the locale resources covered by the tests, not every hardcoded
string in every newly imported module. No commit, push, image rebuild or runtime
deployment was performed for this translation patch.

## Runtime regression follow-up (2026-11-16)

VPS logs from the integration candidate confirm repeated Analyst GET 403 on
`/api/v2/serve/awel/chat/flows` and a separate MySQL missing-table error for
`dbgpt_serve_plugins`. The latter is a schema bootstrap failure, not a role denial.
Source now allows only GET on the chat-flow listing for both trusted roles and
creates the two plugin registry tables with checkfirst during plugin startup.
The sidebar Semantic Center label uses the locale catalog. Flex minimum sizes
were corrected around the main content and chat page to prevent content from
forcing the composer outside its bounded viewport.

Local route checks pass for both roles, reject POST to the listing and retain
the Analyst restriction on global plugin sync. Full pytest is unavailable in
the local Python environment; frontend dependencies are also absent locally.
These changes have not yet been built/deployed or verified in a real browser.
Do not mark the UI regression case closed on source checks alone.

## BUG-01: isolate model metadata caches

The live model allocation failure was caused by LLMClient's class-level TTL
cache. Independent proxy clients and aggregate clients shared the model-list
key, so a proxy worker could fail its own metadata lookup after another
worker populated the cache. DefaultLLMClient.models() then failed before the
Agent applied the requested model priority. This was not evidence of a model
selection override.

The cache is now lazy and instance-local, preserving TTL and subclasses that
do not call a base constructor. Four regression tests pass in the runtime
image; the unpatched image fails three, including the exact missing-model
exception. No model/API call is needed by these tests.

Deployed worktree image: funnelmetry-db-gpt:ff22dfc5-bug01-cache-fix.
Analyst UI retest reached the provider using qwen3.5-27b. A separate provider
400 rejects required/object tool_choice with thinking mode (BUG-13); the run
ended failed. Model allocation is verified fixed, full Chat acceptance remains
open. See System_Local_Docs/DB_GPT_MODULE_UI_RUNTIME_AUDIT_2026-11-16.md.

## BUG-13: thinking-compatible native tool selection

Native Agent requests now use tool_choice=auto during normal turns, protocol
recovery, report authoring and financial pending/completion phases. Tool
filtering, recovery guidance and workflow validation remain active. Thinking
configuration is not disabled or otherwise changed.

The request regression test covers normal/recovery/report, retains the selected
model and native tool definitions and verifies returned tool calls. It passes
in an isolated runtime container. Financial request expectations were updated;
the financial pytest suite could not execute because pytest is absent from the
runtime image, so full financial-workflow acceptance remains open.

Deployed worktree image: funnelmetry-db-gpt:ff22dfc5-bug13-auto. Analyst UI
conversation a8e614df-4583-432d-b16b-a70edaf78f41 used qwen3.5-27b and completed
with a Vietnamese answer. Provider payloads use auto, with no thinking-mode
InvalidParameter in this turn. The evidence postprocessor unnecessarily
removed part of the conceptual answer; this is tracked separately as BUG-14.
No full analytical/Dashboard/financial retest was performed in this change.

## BUG-03: additive Semantic Center schema bootstrap

MySQL skips generic automatic metadata DDL migration. The imported semantic
models therefore did not create their tables on the existing deployment.
Added an explicit semantic-only bootstrap called during metadata initialization:
creates missing module tables with checkfirst, without ALTER/DROP or data reset.
A SQLite regression verifies partial-schema creation, repeatability and existing
row preservation. Runtime MySQL startup succeeds and Analyst GET
/api/v1/semantic/spaces now returns 200 via Playwright (previously 400).

Deployed worktree image: funnelmetry-db-gpt:67f78553-bug03-schema. The Semantic
Center page still renders only its shell/tabs; that UI problem and SQL error
presentation (BUG-04) remain open. No semantic sync/publication was tested.

## Semantic Center page rendering

ConstructLayout renders page children only inside a tab matching the route.
The semantic route was absent from the item list, causing a blank content area
even after the API schema repair. Added a shared Semantic Center tab. Existing
role filters remain unchanged; Workflow/Plugin routing is outside this fix.

Regression render tests for Analyst/Admin plus i18n pass 13/13. Production
build (including TypeScript/static export) passes. Worktree image
funnelmetry-db-gpt:67f78553-semantic-ui was deployed with the earlier trace
label translations. Analyst Playwright now shows the semantic title, counters,
registration button, search and an empty table (zero registered spaces). GET
/api/v1/semantic/spaces returns 200. No source registration/sync/publication
was performed. Admin tab visibility in the deployed build remains BUG-11.

## BUG-04: Semantic API error presentation

Added a route-level SemanticRoute boundary: unexpected failures return HTTP
500 with SEMANTIC_REQUEST_FAILED and a generated reference ID, without raw SQL,
parameters, driver messages or internal connector URLs. HTTP >=500 retains its
status with the same safe envelope. Validation and business HTTP <500 remain
unchanged. Logs retain reference ID, exception class and stack locations,
without raw exception messages/SQL parameter dumps. Other SQL/Agent routes
retain their existing error handling for tool recovery.

Three isolated ASGI tests pass (SQL failure, connector failure, success/404).
Deployed worktree image: funnelmetry-db-gpt:67f78553-bug04-errors. No deliberate
live database failure was induced to test this boundary.

## BUG-05: connector catalog and Analyst UI

Allowed only GET /api/v2/serve/connectors/types for Analyst: static catalog and
field schemas contain no saved credentials. Create/update/delete, connection
configuration, test/tools and pending confirmations remain Admin operations.
The connector page now renders read-only cards for Analyst and hides management
forms/actions. With no stored role, the page discovers the backend actor via
/api/auth/funnelmetry/me (the existing bundle has no identity build flag and
uses a native mock user). This local fallback does not fix global BUG-11.

Two policy tests and four UI tests pass, as do TypeScript/static export.
Deployed worktree image: funnelmetry-db-gpt:67f78553-bug05-role-ui. Analyst
Playwright sees catalog entries with identity/types HTTP 200 and no add/activate
buttons. Admin browser creation and actual MCP invocation were not tested.

## BUG-06: Workflow list and editor dependencies

The legacy `/construct/flow` route redirects to `/construct/taskflow`, but
ConstructLayout still selected a `flow` tab. As children are rendered inside
the selected tab, the current route showed an empty content area. The tab and
sidebar now target `taskflow`; the legacy redirect remains compatible.

Added explicit shared Analyst/Admin policy entries for node kinds, agent
options, template detail and generation-session operations. No wildcard AWEL
permission was added. Generation sessions now derive their owner from the
verified Pipeline actor when integrated; standalone API-key ownership is
unchanged. Existing session-store owner checks and publishing validation remain.

Four policy/identity tests and four ConstructLayout render tests pass.
Production build including TypeScript/static export passes. Deployed worktree
image: `funnelmetry-db-gpt:67f78553-bug06-workflow`.

Analyst Playwright acceptance: list renders with three built-in templates;
new editor initializes; save draft succeeds; reopening restores the saved name
and canvas; template copy opens in editor. Test draft
`aa65f56d-675a-4443-8488-213a9e92e6b0` was deleted through UI with HTTP 200,
and the list returned to empty. Node kinds, agent options, session creation,
draft updates, save and reopen all return 200. No model execution or publishing
was attempted. Admin browser testing and existing BUG-09/10/11 remain separate.

## BUG-07: Plugin page content

`/construct/suites` already fetched its registry successfully, but had no
matching ConstructLayout tab. Added a shared Plugin tab using the existing
`suites` translation and Appstore icon. No API policy or Plugin execution
behavior changed.

All six ConstructLayout render tests pass (Plugin, Workflow, Semantic Center;
Analyst and Admin). Production build including TypeScript/static export passes.
Deployed worktree image: `funnelmetry-db-gpt:67f78553-bug07-plugin`.

Analyst Playwright shows seven plugins, opens `db-query` details and its commands,
then selects `/nl2sql`: chat receives the correct suite/command selection
without submitting to the model. Registry/detail requests return 200. Package
installation/import/removal, enable/disable, configuration, actual model
execution and Admin browser testing were not performed. Chinese manifest/README
content remains tracked separately under BUG-09.

## BUG-08: Application deletion confirmation

Application removal used static `Modal.confirm`, while the dropdown action
was attached only to the label span instead of the menu item. Replaced it with
the existing AntD App context modal and a menu-item click handler. Confirmation
names the selected application and uses existing localized labels.

The delete hook calls only the selected app code, disables duplicate submissions
and closes/refreshes only on a successful response. Network and business errors
keep confirmation open for retry and show a localized error, without unhandled
promise rejections. Backend authorization and deletion semantics are unchanged.

Four tests cover cancellation, successful selected-app deletion and retry after
business/network failures; no unhandled rejections remain. Production build,
TypeScript and static export pass. Deployed worktree image:
`funnelmetry-db-gpt:67f78553-bug08-app-delete`.

Analyst Playwright confirms the modal names `UI audit temporary 20261116`;
Cancel leaves it intact without a removal request. Reopening and confirming
deletes only app `6958747a-e1d9-11f1-9586-02420a000316` via
`POST /api/v1/app/remove` (200). Refreshed list and full browser reload both
show the six pre-existing native applications, without the test draft. No
console errors were observed. Failure/retry are covered by isolated UI tests,
not by deliberately breaking the live API. Admin browser testing, publishing
and execution are outside this acceptance.

## BUG-09: Vietnamese module localization after upstream integration

The audit covered both localization keys and direct UI copy before packaging:
all 2,573 general English keys have Vietnamese entries; all 1,436 Dashboard
namespace keys now resolve through the Vietnamese presentation dictionary
without English fallback. A shared module dictionary covers datasource forms,
workflow editor labels, manifest fields, runtime phases and placeholders.

Fixed several independent language-selection paths: datasource copy previously
treated vi as en; Plugin presentation treated vi as zh; workflow conversation
and manifest labels had their own bilingual switches. The Dashboard namespace
is now registered for vi, including long help, validation, sharing, schedules,
annotation controls, template descriptions and built-in example prompts.

Bundled Plugin names and 35 skill summaries have Vietnamese presentation.
Translated command labels/descriptions do not change IDs, skill bindings,
datasource scope or source objects. Available English package translations
are used as fallback for untranslated source examples; original Chinese README
content remains available under an explicit collapsed source-document section.
Custom packages, user content, SQL, results and arbitrary Agent messages are
not machine-translated or rewritten. Only known workflow phase enums are mapped.

Application modes and descriptions use localized presentation. New native apps
no longer unconditionally receive zh: a Vietnamese UI selects the supported en
prompt fallback; existing app language remains unchanged when edited. Native
app prompt configuration still supports en/zh; this change does not claim a
new vi prompt catalog. Added localized labels for permission management,
document upload/sync, knowledge-space absence, result limits and API notices.
Raw source-error details retain their original content.

Targeted locale/Dashboard/navigation/delete tests pass (56 cases), as do the
35 Plugin command/presentation tests and two API notification locale tests.
Final follow-up locale suite passes 25 tests (12 module cases, 11 general locale
cases, two API notice cases). TypeScript preflight and production/static export
of 70 pages pass. Deployed worktree image:
`funnelmetry-db-gpt:67f78553-bug09-vi-final` (uncommitted worktree changes).

Analyst Playwright acceptance covers Dashboard gallery/create and vi/en/vi
switching with draft text retained, datasource list and dynamic counts,
Workflow list/editor, Plugin details/commands/skill summaries, application
creation modes and Knowledge Base creation form. Final follow-up confirms
`1 kết nối dữ liệu nghiệp vụ.`, `Tổng quát` and `Kho mã Git`. Forms were cancelled,
no new application/knowledge objects or model runs were submitted. No console
errors were observed on the final image. Admin-specific workflows and arbitrary
model text were not validated. Brand names, identifiers, text in illustration
assets and original package documentation may remain English/Chinese; these
are not claimed as translated user-interface controls.
## BUG-10: one workflow navigation entry

The sidebar retains Workflow AWEL as the single entry to
`/construct/taskflow`. Removed the duplicate tail entry labelled Workflow
(`Luồng công việc` in Vietnamese) and its unused icon import. Both entries
previously shared the same destination, active-route conditions and role
filter; they did not expose separate modules. This applies to expanded and
collapsed navigation, which consume the same menu definitions.

The legacy `/construct/flow` redirect, TaskFlow editor, scheduled tasks and
Admin/Analyst permissions remain unchanged. Six Construct navigation tests
(including both roles) and TypeScript preflight pass. Source inspection confirms
one workflow destination in the shared sidebar menu. Runtime deployment and
browser acceptance of this change are pending.

## BUG-11: runtime identity drives integrated navigation

The previous layout only read Pipeline identity when the build-time public
flag was present. A static bundle missing that flag used native mock login,
exposed Admin tabs to Analyst and reached APIs which correctly returned 403.

The application now discovers `/api/auth/funnelmetry/me` before rendering
authenticated content and provides the verified runtime role through one React
context. Sidebar, Construct tabs, connector controls and global approval scope
use that shared identity. Direct Analyst navigation to existing Admin-only
configuration pages retains the Admin-only notice. Backend permissions and
Agent/tool capabilities are unchanged.

Native standalone login is allowed only on an absent identity endpoint (404)
when the build does not explicitly require integration. HTTP 401/403/5xx,
network errors and malformed/unsupported identities do not fall back to mock
login. Stale localStorage roles do not override the runtime context. The public
build flag remains supported but is no longer the only integration signal.

Validation: 23 tests pass across runtime discovery, Admin/Analyst Construct
tabs and connector presentation; TypeScript preflight passes. Tests include
missing build flags, stale stored Admin identity, standalone 404 and rejected
sessions. This source fix has not been rebuilt/deployed or browser-accepted;
it does not assert that every 403 in other modules has been resolved.

## BUG-12: operational timestamp presentation

Conversation APIs serialize database timestamps without timezone suffixes;
application metadata uses naive UTC timestamps. The VPS and DB-GPT container
were both verified as UTC on 2026-11-17. Native browser/Moment/Day.js parsing
interpreted those strings as local time, displaying a fresh record as seven
hours old in Vietnam.

`web/utils/server-time.ts` now interprets legacy naive operational timestamps
as UTC before local display/comparison. Explicit Z/offsets, numeric epoch
milliseconds and Date inputs retain their instant; missing/invalid timestamps
remain invalid. This is an operational-metadata convention for the UTC server,
not a generic interpretation of analytical data or non-UTC historical imports.
Changing the server clock timezone requires revisiting this convention.

The source sweep covers 35 consumers across conversation history/sidebar,
applications/legacy agents, TaskFlow, Knowledge Base sync, scheduled task
list/detail/run history, model heartbeat, observability and execution traces,
financial progress/history, Semantic Center and Dashboard lifecycle/shares/
freshness. Schedule run durations now also compare mixed offset/naive strings
consistently. Sidebar ignores invalid timestamps rather than throwing during
relative formatting. Calendar filters, analytical chart/date columns, local
draft timestamps, numeric artifact timestamps and cron wall-time configuration
are unchanged. Semantic Center uses the Vietnamese date locale when selected.

An additional application timestamp defect was found: `GptsApp` and
`GptsAppDetail` evaluated their default timestamps once at module import.
Both now use `Field(default_factory=datetime.utcnow)` for each new object.
Explicit timestamps and existing database rows are preserved; no migration
or database rewrite is required.

Validation: 13 timestamp tests pass separately in UTC, Asia/Ho_Chi_Minh and
America/New_York (including DST offsets); 32 existing schedule/Dashboard/
provenance regression tests pass in the Vietnam timezone. The schedule-drawer
test's incomplete react-i18next mock was corrected to retain real exports.
TypeScript preflight passes. Focused Pydantic checks on the actual timestamp
field declarations confirm fresh defaults for both models and preservation of
explicit values; the complete model module compiles. These are not full DAO
or end-to-end runtime acceptance tests. Source is not rebuilt/deployed yet.

## BUG-14: distinguish explanation from empirical claims

The final-answer guard previously treated terms such as conversion rate and
added-to-cart as measured business claims even in a general definition. This
removed part of the two-sentence funnel explanation observed during BUG-13
retesting. A separate unconditional KB-retrieval/listing exemption could also
let unrelated shop-outcome assertions through.

The guard now scopes each sentence as conceptual, empirical or uncertain,
using the current user request as a presentation hint, not an Agent router.
Definitions, qualified hypotheses, examples and proposals remain visible
without SQL. A conceptual request does not exempt a measured shop claim in
the same answer. Listing/retrieving KB alone no longer exempts the whole answer.

Clearly empirical unsupported assertions in the recognized narrow source
cases retain the existing removal behavior. Ambiguous interpretations are
retained with an explicit review note. Custom SQL, CTEs/joins, Python results
and document excerpts outside the guard's understanding are reviewed rather
than deleted for not matching known SQL source names. This is not evidence
certification: even matching query keywords receive a review note for the
high-impact claim families because SQL text alone cannot verify result values
or business meaning. Empty KB listings or reference shells do not certify data.
Proposed SQL examples are preserved verbatim with a source-verification notice
when they reference unconfirmed relations, instead of being erased.

No execution-loop, prompt, model setting, budget, tool registration/discovery,
skill, SQL permission or KB-retrieval behavior changes. The Agent API only
passes `request_text=user_input` to the existing final-presentation guard and
uses an accurate review log label for both removed and retained claims. There
are no added model calls. Reports still follow their existing separate path.

Validation: 40 claim-guard tests pass, including the observed conceptual answer,
definitions across business families, mixed conceptual/measured statements,
hypotheses and contrasting factual clauses, KB listing/content distinctions,
custom SQL/Python results, unknown scope, sellable-stock wording and preserved
SQL examples. Four tool-availability and five skill-prompt regression tests also
pass; both changed API/guard modules parse successfully. These deterministic
heuristics do not certify arbitrary prose, numeric correctness or causation.
Source has not been rebuilt/deployed or browser/model accepted for BUG-14.

## Sidebar follow-up: connector visibility and usable history space

Runtime identity exposed an overly broad UI restriction: Analyst could no
longer reach Connectors, although the backend already permits its redacted
list/catalog reads and the page has read-only presentation. Connector navigation
is restored in the sidebar and Construct tabs; the top-level Admin-only page
block no longer includes Connectors. Create/edit/delete/test controls remain
Admin-only. No backend policy or credential visibility is expanded.

Expanded navigation now combines Pipeline return/collapse into one compact
header, uses shorter menu rows and caps its own scroll region at 55% height.
Task history receives the remaining flexible space with its own scrollbar;
footer controls do not shrink. Collapsed navigation also scrolls independently
instead of pushing its footer beyond a short viewport. Routes and Agent task
behavior remain unchanged. Targeted Construct/connector tests pass (12 cases).
The follow-up has not been rebuilt/deployed or browser-accepted yet.

## E2E-01: normalize semantic callables during native discovery

`make_semantic_tools` returns decorated callable functions whose registered
resource lives at `._tool`. Native discovery read `.name` directly from those
functions whenever a datasource was loaded, crashing before the first model
turn. Full-catalog construction and KB discovery already used ToolPack.

Semantic initial-name collection now also uses `ToolPack(...).sub_resources`.
All four semantic tools remain initially available; names, schemas, executable
bindings, connector permissions, prompts and discovery catalog are unchanged.
Connector extras are already flattened BaseTool resources by their selector;
they do not require the same fix.

Regression tests execute the actual initial-name production AST with real
ToolPack and semantic factories, without importing the full API or booting
models/databases. Four focused factory/discovery tests pass in the deployed
container dependencies using candidate source under `/tmp` (pytest absent,
test functions invoked directly). The same regression reproduces the exact
AttributeError against deployed baseline source. Four tool-availability and
five skill-prompt tests pass locally. No LLM call, source hot patch or runtime
deployment was performed; model/UI acceptance remains pending deployment.

## E2E-02: align PostgreSQL discovery and Dashboard query scope

The saved `funnelmetry_handoff` connector introspects `funnelmetry_ai` only
(seven views), while its analytical role can SELECT 42 relations across
`funnelmetry_ai` (7), `funnelmetry_demo` (24) and `funnelmetry_explore` (11).
Its search path is `funnelmetry_ai, pg_catalog`. Model schema queries could
therefore discover demo relations that Dashboard's native table-name allowlist
rejected. Changing SQL to `public.sessions` did not fix that mismatch.

A shared PostgreSQL inventory now derives qualified relations and columns from
the connection's existing SELECT/USAGE grants. Planning context, subagent schema
fallback, Dashboard validation/execution, generated filters, source inspection,
annotation metadata and temporal profiling use this inventory. Unqualified
aliases are included only when PostgreSQL reports the relation visible on its
search path. Explicit include/ignore restrictions remain schema-specific;
metadata failures do not silently fall back to the seven-view catalog. Other
dialects retain native discovery. This changes neither database grants nor
datasource authorization, SQL read-only validation or metric/quality semantics.

Nine regression tests pass against candidate modules loaded from `/tmp` in the
runtime dependency environment. They cover qualified/quoted names and CTEs,
wrong-schema rejection, search-path visibility, explicit include/ignore lists,
empty/failing discovery, SQLite compatibility and qualified temporal probes.
Read-only verification using the real PostgreSQL connector reproduces the native
seven-table inventory and finds all 42 readable relations with the candidate.
The requested monthly facebook/tiktok/zalo session query validates and executes
(39 rows, 13 months, 3 sources); `public.sessions` remains rejected. The demo
session count was 101,750 at verification time. No database writes, grant changes,
LLM calls, active source hot patch or runtime deployment were performed. UI chart
generation, publication and repair/revision continuity remain pending acceptance
after deployment; these SQL checks do not certify the full Dashboard workflow.

## E2E-03: validate application configuration before saving

The extra-configuration page previously sent an empty native `team_context`
without validating the scene form, producing Pydantic union errors for string,
AWEL DAG and native scene fields. It also parsed stored app JSON on every render,
re-running parameter initialization and potentially overwriting current edits.
Clearing an AWEL selection left the previous context in the pending payload.

The page now keeps stable initialization data, invokes the active form's real
validation before updating, and shows localized field errors. Native apps must
have their selected scene and loaded scene name; AWEL apps must have a valid
DAG ID. Clearing a workflow explicitly clears its pending context. Missing
scene metadata or a workflow without a DAG produces an actionable localized
message without sending an invalid update. Native resource tooltips use the
existing translated label. Draft creation, agent/model/resource choices,
single-agent/auto-plan execution and backend permissions/contracts are unchanged.

Seven tests pass: four component scenarios exercise real AntD Form validation
with mocked API calls (missing native scene, new scene persistence, cleared
workflow and valid existing workflow), plus three mode/payload contract tests.
The component harness adapts Select's popup to a native select because jsdom
cannot parse an AntD popup CSS selector; it does not certify dropdown rendering.
Full candidate-web TypeScript checking passes with `tsc --noEmit --incremental
false`. Tests and checks ran in the `/tmp` UI workspace with existing dependencies,
without application writes, LLM calls, production rebuild or deployment.
Real-browser/API acceptance remains pending deployment.

## E2E-04: retire the Walmart skill and complete catalog metadata

Removed `skills/walmart-sales-analyzer` (instructions, scripts and template),
its sdist/wheel inclusion, UI presentation/description entries and built-in
skill documentation. Packaged report/dashboard expectations no longer require
it. Startup provisioning removes the exact legacy built-in directory and skips
re-seeding it from an older bundle; a symlink is unlinked without traversing its
target. Personal skills under `user/` and other built-ins are preserved.

The recursive skill loader used to interpret arbitrary JSON/YAML reference
assets as unnamed skills with the fallback name `Unknown`. Structured skill
definitions now require explicitly named metadata; valid named custom skills
and Markdown workflows remain supported. CSV/Excel scaffold SKILL.md files are
replaced with executable-workflow guidance, including actual helper availability,
sample/full-file scope and evidence limitations. SQL's summary is concise, and
CSV/Excel/SQL have Vietnamese/English display summaries. Personal descriptions
are never overwritten by official display translations. The skill-creator
template's TODO placeholder remains intentional; it is not an installed skill's
description.

Six Python retirement/loader tests and two UI-description tests pass; full
candidate-web TypeScript checking passes. Source/package-map retirement and
documentation JSON checks pass. Verification used candidates and temporary
fixtures, with no LLM calls, production skill-directory mutation or deployment.
The startup cleanup will take effect on deployment; current VPS/UI acceptance
is pending. This case retires the skill, not every upstream Walmart dataset,
example datasource or gallery fixture elsewhere in the repository.

## E2E-05: recover from typed context labels without source bindings

The UI's `[Database: …] [Knowledge: …]` display prefix is not the actual
datasource/KB binding: execution uses `ext_info`. Manually typing this prefix
without selecting the controls previously sent an unbound request into native
discovery, causing repetitive tool searches. A narrow preflight now detects
missing selections for leading context labels. It preserves the input and
explains how to select the datasource/KB. Explicit context overrides remain
supported. The API independently returns a localized final response and done
before model execution for the same missing-binding case, after resolving
owned uploaded-dataset or Dashboard continuation bindings where available.

No datasource or KB is selected from prompt text. Ordinary chat, file-analysis
questions without these leading labels, hypothetical SQL and discussion of
label syntax remain available without selecting sources. Existing bound
requests still cross their normal access checks; a label is not permission.
This addresses the observed mismatch, not every possible missing-context intent
or multi-turn binding restoration.

Four Python checks and three context-preflight UI utility tests pass. The seven
E2E-03 tests also pass in the candidate UI workspace. TypeScript checking passes;
no LLM invocation or runtime deployment was performed. Browser acceptance and
the original Q1/multi-turn test remain pending deployment, including E2E-01.

## E2E-06: preserve provider usage and expose incomplete totals

Read-only runtime reconciliation found 15 unique constraint errors on
`observability_span.span_id`. The SELECT-then-INSERT writer races when create/end
notifications overlap; a failed batch could roll back other telemetry rows.
SQLite persistence now uses atomic ON CONFLICT updates. A late create cannot
erase a completed span. Agent streaming retains the last nonempty provider usage
object when later chunks omit usage; cumulative usage snapshots are not summed.

Conversation usage keeps full totals null when a recorded call lacks usage, and
adds known subtotals plus counts of fully reported/missing calls. Partial fields
from different calls never count as a complete call. The UI labels subtotals as
incomplete evidence and shows a retry notice for API failures. Reported zero is
distinct from unavailable data. No tokenizer, pricing assumptions or synthetic
usage backfill was introduced.

The existing Qwen3.8 conversation has 13 recorded Agent call spans, 12 with full
usage: known input 149,197, output 4,101, total 153,298 tokens. One call is missing
usage; this is not a certified total or provider billing statement. The Qwen3.6
conversation has no recorded Agent call span, consistent with E2E-01 failing
before analysis, but missing telemetry cannot prove zero billed tokens. Lost
historical rows cannot be reconstructed; exhaustive retry, embedding and other
model-path coverage is not certified. A stream log with usage=None alone does
not establish that all provider calls had missing usage.

Six tests pass using temporary SQLite, concurrent writers, duplicate batches,
delayed creates, fake streams, missing/zero usage and conversation scoping.
Existing runtime aggregates were read with the candidate provider without live
store writes. No paid model call or runtime deployment was performed. New-run
UI/provider acceptance remains pending.

Candidate-web TypeScript checking (`tsc --noEmit --incremental false`) also passes.

## Context stability: native protocol, compaction and visible budget state

Investigation confirmed the manager is wired before native model calls and
runtime status events exist. The compact composer indicator only appeared after
a context.status event; reload/model changes cleared it. It now always shows an
explicit awaiting-measurement state until this request produces a measurement,
then a readable estimated percentage with Vietnamese labels, window, output
reserve and metadata source in the tooltip. Starting a new request clears the
previous request's ratio. No fabricated zero or stale historical ratio is shown;
persisted context snapshots are not introduced. Context estimates remain distinct
from provider-reported token usage.

More importantly, AgentMessage conversion discarded native tool_calls and
tool_call_id on the path through context budgeting. These fields and the tool
name now survive conversions/copies. Parallel tool calls/results form one atomic
compaction group, including out-of-order results; incomplete groups are not split.
Legacy Observation-based groups remain supported. Native observation age uses
actual groups, rather than the old textual Observation count. Micro-compaction
copies shortened messages so working-request changes do not mutate memory objects.
Dropping/summarizing old native groups keeps the latest user instruction, system
messages and complete recent tool groups. Summaries include tool-call identity
and arguments rather than empty assistant tool-call messages.

Native provider context overflow now invokes emergency compaction before retry.
Only a strictly smaller request is retried; unchanged overflow is propagated to
existing failure handling. This does not reduce available tools, alter model
selection or lower the configured context window. Existing thresholds and
reservation policy remain unchanged. Durable conversation storage is unchanged;
there is no automatic reconstruction of previously malformed tool history.

Nine native regression tests and eleven legacy compaction tests pass against
candidate modules in the runtime dependency environment, using fake summaries
and a fake provider overflow. Four ContextUsageBar component tests and full
candidate-web TypeScript checking pass. No LLM request, active source hot patch,
production rebuild or deployment was performed. Multi-turn browser acceptance
and real high-context recovery remain pending deployment.

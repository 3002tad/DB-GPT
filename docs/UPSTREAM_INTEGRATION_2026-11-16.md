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

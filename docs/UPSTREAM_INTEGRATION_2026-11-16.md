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
- Existing prompt-budget unittest suite: 2 passed, 2 failed, 1 error. The tests
  still expect CODEGRAPH/image prompt placeholders and the old fixed tool-pack
  identifiers. Review whether each context was intentionally superseded before
  updating the tests; do not simply remove assertions to obtain a pass.
- Local checkout has no web node_modules or complete Python dependency environment;
  full TypeScript, backend/import tests and UI build remain pending.

## Required before deployment acceptance

1. Resolve prompt-budget context/test compatibility and verify native tool names
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

# DB-GPT module and policy audit — 2026-11-07

Current code: `9f7fb3e2`; deployed backend image: `cec29533-kb` (the subsequent
commit changes documentation only). Scope is DEC-148: trusted Admin/Analyst,
preserve native DB-GPT analysis and workflows, Admin configuration protection,
read-only analytical datasource. A dedicated execution runtime is out of scope.

The integration is **partially open**. Several modules are visible and their
list pages work, while their child operations are denied even to Admin. The
HTTP policy is an explicit route/method allowlist: `super_admin` does not
automatically admit endpoints missing from that list.

## Evidence and limits

- Compared 269 static HTTP client declarations under `web/client/api` against
  `pipeline_authorization.py`: 100 admit both roles, 22 admit only Admin,
  135 deny both, and 12 use paths outside the middleware's `/api/` boundary.
  One additional client call builds its URL dynamically. These counts include
  legacy, optional and currently unused API clients; **135 denied declarations
  is not a count of 135 broken features or a completeness percentage**.
- Reviewed direct fetch/axios paths in the chat, skill, connector and scheduled
  task components/hooks separately. They are not included in the 269 count.
- Ran 40 read-only HTTP checks against the deployed VPS: 19 for each role and
  two unauthenticated requests. No mutation, external connector invocation,
  embedding or analysis-model call was executed.
- Existing-object list endpoints returned valid responses. Several subresource
  probes deliberately used a missing ID: their 403 confirms policy rejection
  before object lookup, not that an existing object would pass downstream
  ownership or data-source validation after the policy is changed.
- The source inventory is a static declaration scan with placeholder IDs;
  it is not a parser proof, a complete backend-route registry or browser
  acceptance. Non-`/api` paths need routing/auth inspection; the scanner does
  not establish they are reachable or unprotected in deployment.

Full records: [client declarations](FUNNELMETRY_MODULE_POLICY_CLIENT_INVENTORY_2026-11-07.json)
and [VPS read checks](FUNNELMETRY_MODULE_POLICY_RUNTIME_2026-11-07.json).

## Module matrix

| Module | Working policy boundary | Remaining mismatch or limit |
| --- | --- | --- |
| ReAct/Knowledge Agent | Both roles admit `/chat/react-agent` and `/chat/knowledge-agent`, with live Pipeline identity and conversation ownership on those handlers. | User replies/rejections to Agent questions are denied. Report/evidence HTTP APIs are also absent. This does not remove tools from the Agent pack, but breaks interactive/browser paths that use these APIs. |
| Applications | List/create/edit/publish and configuration lookups admit both roles. | Ordinary application chat uses `/chat/completions`, which is denied. App-admin lookup/update are also denied to Admin despite the UI supporting that action. Creation/list acceptance does not establish an app can run. |
| AWEL | Flow CRUD, nodes/refresh, debug, import/export and variable reads admit both roles. VPS flow/template lists return 200. | File-upload/metadata APIs used by file nodes are denied. `getFlowTemplateById` declares a denied route, but no matching backend route was found in the inspected flow endpoints; classify that as a legacy client mismatch, not a proven missing permission. Public/dynamic trigger execution needs separate route review. |
| Skills | List/detail admit both roles; VPS list returns 200. Agent tool-side skill usage is distinct from HTTP management. | Upload ZIP and import from GitHub are denied to both roles although buttons exist. Download of an Agent-created skill package is also absent from the policy. |
| Knowledge Base | Basic shared-space list/create, TEXT/DOCUMENT ingestion, named-document mutations, query/recall, statistics and read tools admit both roles. Recent `arguments` and `ls-json` fix is active. | Argument save, Wiki, KB external-source bindings, Git sync/status, graph build/visualization and membership administration remain denied. The ingestion handler additionally rejects non-TEXT `document/add` and non-DOCUMENT upload in integration mode, so URL and other source cards require handler changes as well as HTTP policy. |
| Dashboard | List/read/create/update/preview/refresh/copy/archive/restore/export, folder operations and schedule routes admit both roles. Handlers also enforce dashboard permissions/source grants. | Template source/features/preview/generate/adapt, assistant-task, target resolution, edit history, operations, annotations and covers are denied. The UI calls them. Sharing/publication/collaboration are also closed; those are documented intentional boundaries, but the UI does not consistently distinguish them. |
| Scheduled tasks | Both roles admit list/create/update/delete/toggle and execution-history routes. VPS list returns 200. Owner checks exist in task handlers. | No missing HTTP path was found among the eight functions in `use-scheduled-task.ts`. A cron execution was not run; scheduled owners are not revalidated through a live login each time. Dashboard schedule UI can still encounter a blocked companion Dashboard API. |
| Datasource/SQL | Analyst can list the configured analytical datasource and run SQL/chart; datasource management is Admin-only. PostgreSQL grants remain the authority for writes. | Older editor round/history and submit APIs are denied although `db-editor.tsx` still calls submit. They must be reconciled with the current analytical policy rather than opening a legacy SQL route without its datasource check. |
| Connectors/model providers | Configuration screens are Admin-only in UI. Policy admits reviewed management APIs for Admin and credential-free active connector picker/model names for Analyst. VPS provider/type reads are 200 for Admin and 403 for Analyst. | This role split is consistent. Backend tool invocation is not equivalent to exposing connector configuration. Native connector execution/confirmation was not exercised in this audit. |
| Observability/evaluation | Owned-conversation trace/usage reads are admitted. Analyst UI hides global observability and model evaluation. | Admin can open those pages, but capabilities, global model usage, health, agents, sessions, metrics and benchmark APIs are denied. VPS confirms 403 for Admin capabilities/model usage. |
| Files, reports and examples | Session-file registry routes admit both roles; generated legacy `/agent/files/download` matches the generic file route and then applies its own directory restrictions. | Standalone report/run/evidence/content/render-observation APIs are denied. Example prepare/use, legacy resource-file reads and skill-package download are denied. `/images` is deliberately denied because its static mount lacks an owner check. |

## Highest-priority conflicts

1. **Agent questions cannot be answered:** `pages/index.tsx` and
   `hooks/use-react-agent-chat.ts` POST to
   `/api/v1/chat/question/{request_id}/reply` and `/reject`; neither is admitted.
   Existing handlers authenticate but forward the ID directly to a shared
   question manager. When enabling them, bind the request to its conversation
   and verified actor as part of the existing identity boundary.
2. **Application execution is blocked:** `components/app/app-card.tsx` opens
   `chat_agent`; `hooks/use-chat.ts` selects `/api/v1/chat/completions` for
   non-ReAct scenes. The policy currently admits only ReAct/Knowledge Agent
   POST routes. Review the selected application's datasource/actor propagation
   before enabling its execution path.
3. **Dashboard features are only partly enabled:** the assistant calls
   `/dashboards/{id}/assistant-task`; the editor loads `/annotations`; the
   lifecycle panel loads `/versions`; cards load `/cover`; template setup
   calls `/dashboard-catalog/{id}/features` and `/source`. All are rejected
   by the HTTP policy before their normal service permission checks.
4. **KB details were fixed, but management remains partial:** the settings
   modal reads `arguments` successfully and submits `argument/save`, which is
   still denied. Wiki and Sources tabs also call denied read APIs. Reconcile
   write handlers and source types with the trusted shared-workspace scope.
5. **Skill management is read-only in practice:** list/detail are open, ZIP
   upload and GitHub import are closed for Admin too. The UI exposes both.
6. **Admin Observability is unusable beyond conversation usage/traces:** the
   Admin page's initial capabilities/global-usage calls are denied. It is
   reasonable to keep global data Admin-only; it is currently closed to Admin.

These are route/feature inconsistencies. Do not resolve them by removing all
authentication, making all roles Admin, or admitting every `/api` prefix.
Preserve the two roles, native Agent tools, datasource grants and the existing
per-object permission checks. No separate runtime or tool-by-tool certification
is required by this audit.

## Scope of follow-up

First align the interactive Agent/Application paths, Dashboard's used private
features, KB management, Skill management and Admin observability. Add a
module-to-endpoint regression matrix so each visible workflow's dependencies
are checked together. For a deliberately disabled operation, hide/disable its
control with an explanation; a visible enabled action should not discover a
permanent policy restriction only after returning 403.

Keep public sharing, privileged provider/connector configuration and optional
legacy routes separately identified. After policy changes, test real role,
datasource and object behavior: an HTTP allow decision alone does not prove
execution, ownership or scheduler correctness. The existing authorization
inventory's descriptions of closed Dashboard schedules and earlier KB reads
are stale relative to current source; prefer this dated audit for the current
route comparison.

The initial audit above was read-only. The two JSON files linked by this
document retain that baseline; they are not results from the corrected policy.

## Remediation

`pipeline_module_policy.py` now groups the native dependencies for Agent and
Applications, private Dashboards/Reports, Knowledge, Skills and AWEL files.
Both workspace roles can use these paths. Global Observability, Evaluation,
membership administration and provider/connector configuration remain Admin
operations. Existing scheduled-task access remains enabled for Analyst.

Native Application chat is enabled with verified actor/conversation ownership
and checks on explicit database resources. Pending questions carry the actor
before the first turn is persisted. Feedback writes bind the authenticated
actor; stopping a native Application topic requires its owned conversation.
SQL/chart history and submissions check conversation ownership; analytical
connections retain their existing datasource grants and PostgreSQL read-only
role. The SQL history API also accepts the JSON POST used by the native client.

Knowledge settings, Wiki, Git and source-binding operations are admitted to
the trusted shared workspace. URL documents accept HTTP(S) URLs without
embedded credentials; upload/sync still validate file bucket and space.
This change does not add a tool sandbox, tool allowlist or model-call gate.

Eight targeted unit tests cover the module route matrix, role/method/path
negative cases, pending-question ownership, Application datasource binding,
SQL-history ownership, feedback identity and Knowledge URL/space validation.
They pass in the DB-GPT runtime image without network or paid model calls.

Public sharing/collaboration remains separate from private analysis. The old
client's unused/absent APIs (including template-by-ID, legacy Agent Hub and
legacy user creation) are not made valid by opening a URL prefix. This audit
does not certify complete end-to-end behavior of every optional module.

## VPS verification after correction

Code commit `684ed0ba` is deployed as `funnelmetry-db-gpt:684ed0ba-policy`.
[The post-fix checks](FUNNELMETRY_MODULE_POLICY_VERIFICATION_2026-11-07.json)
record 52 expected outcomes across both roles and unauthenticated requests.
Usable module reads, including KB arguments/files, Wiki, Git status, source
types/bindings, applications, AWEL, skills and schedules, return 200. Global
Observability and provider/connector configuration return 200 for Admin and
403 for Analyst. Missing/foreign conversation resources return 404; unknown
datasources are denied before model invocation. Unauthenticated reads return
401. These are API/handler checks, not a browser execution of every workflow.

The opened Sources tab exposed a separate MySQL schema omission: the three
Knowledge Source tables were missing. Apply
[`20261107_knowledge_sources_mysql.sql`](../scripts/migrations/20261107_knowledge_sources_mysql.sql)
to the DB-GPT internal database on existing MySQL deployments. It creates
only the three absent tables and indexes, with `IF NOT EXISTS`; it does not
alter existing tables or KB documents. On this VPS it was applied twice
successfully, and the source-list API now returns 200 for both roles.
MySQL startup deliberately does not run SQLite's automatic schema upgrade,
so this explicit migration is also required when reproducing this deployment.
No paid analysis-model calls were made.

## Follow-up: chat resource picker

A second source-to-client check found a missed active dependency: the Chat
resource selector calls `POST /api/v1/chat/mode/params/list`, while the native
Application form can call `/api/v1/resource/params/list`. These routes were
still denied despite the Chat/Agent routes being open. Both are now admitted
for the two roles. Their database entries are filtered through the existing
Pipeline analytical datasource policy for the verified actor; Knowledge and
tool entries retain their native behavior. The supported scene list is also
admitted. The corrected route matrix includes these cases, and the unit test
checks that an unrelated database is omitted from the picker.

Dashboard public publication, live share and membership controls remain
visible in the upstream UI while the integration's HTTP boundary denies those
operations. Opening the version history drawer also asks for publications,
which may display an error even though private version history is available.
The private Dashboard APIs are functioning; public sharing is a separate
product decision and is not covered by the private-workspace verification.
Legacy Agent Hub and mobile endpoints in the client inventory also remain
outside the tested embedded flow. Do not interpret the 52 checks as proof that
these optional screens have been exercised.

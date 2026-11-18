# Conversation context and token meters

The main Agent composer displays two separate measurements. Neither changes
the prompt, conversation memory, compaction, tools or model quota.

Resource restoration, cross-turn evidence and interruption handling are
described in [Conversation continuity](FUNNELMETRY_CONVERSATION_CONTINUITY.md).

## Context snapshot

The backend captures valid `context.status` measurements and allowlists numeric
budget/usage, model, budget source, reservation, compaction layer and server
measurement time. Each turn keeps its latest measurement per model in optional
`context_snapshots` inside the existing version-2 ReAct history payload. This
payload is already persisted in `chat_history_message.message_detail`; no
additional column or table is needed. Snapshots contain no prompts or chat text.

The existing progress checkpoint is flushed before forwarding a context status
event. Running, interrupted, failed and completed history paths all include the
snapshots. Persistence failure follows the existing non-blocking checkpoint
behavior and is logged; storage cannot be guaranteed during a database failure.

Opening a conversation or switching back to a previously measured model restores
the newest matching snapshot across stored turns with a **previous measurement**
label. Starting another
turn keeps that label until the next measurement arrives. It is not a prediction
of the next prompt. Unknown models/conversations show awaiting measurement.
Legacy history without snapshots remains valid and shows awaiting measurement.
Invalid snapshot fields are ignored. A newer live measurement wins over a
delayed older history response.

The existing authenticated/owner-scoped history API supplies these snapshots
on any browser/device; there is no new snapshot-write API. localStorage context
keys from the earlier implementation are no longer read or written, and are
not imported as authoritative server measurements. Snapshots only project UI
state and are not added to the model's dialogue text. A missing snapshot does
not imply missing conversation history or broken memory.

## Accumulated provider tokens

The composer reads the existing owned-conversation observability `/usage` API,
summing provider aggregates across models. It replaces its displayed total on
refresh; it does not add repeated poll responses or estimate usage from context.
It fetches on conversation open, execution transitions and browser focus, polls
every ten seconds while running, and refreshes after completion for trace flush.
Late responses from another conversation are ignored.

Usage reads are background telemetry and do not invoke the global request-error
notification interceptor. A first-turn conversation may not yet have a history
row, so the owned usage endpoint can legitimately return 404 while the Agent
request is already starting. The badge stays incomplete and retries on its
existing execution/focus schedule. Other usage read failures also remain local
to the badge; they do not report that chat execution failed. Backend ownership
checks and 401/403/404 responses are unchanged.

No usage data, missing provider counters or failed API reads display
**Incomplete**, not zero. Known partial totals retain that label. A genuine
complete provider-reported zero can display zero.

The existing provider aggregate selects canonical
`Agent.llm_client.no_streaming_call` spans; parent/tool/wrapper span counters are
not added. This does not certify usage coverage for every native App or external
execution path. A path without canonical usage remains unreported; this change
does not invent counters or implement native-App instrumentation. The composer
meter is for the main Agent session and is separate from the trace panel.

No database migration, new token ledger, prompt restriction or LLM call is
required. After deployment, validate a real turn, reload, model/conversation
switch and follow-up against the provider aggregate before claiming live E2E.

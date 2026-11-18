# Native App chat model selection

Model choice in the native `/chat` page is scoped to the conversation. Its
precedence is:

1. An in-flight UI selection while the URL update is pending.
2. The explicit `model` URL parameter.
3. The latest model recorded in that conversation's loaded chat history.
4. The App's model default.
5. The global model default.

Changing the model shallow-replaces the current URL. It keeps the conversation
ID, scene, App/source parameters and hash, does not add a browser-history entry,
and does not create a new conversation. Reload and browser navigation therefore
read the current route choice. Refreshing App configuration does not overwrite
an explicit choice. Switching conversations discards an optimistic selection
belonging to the previous conversation; late history responses from other
conversation IDs are ignored.

The selected model remains the value passed to the existing native chat
transport. The request and newly displayed messages use that selection. Older
messages retain their original `model_name`; no historical records are rewritten.
This does not change server-side model availability, provider configuration,
generation, thinking, native tool capability or token accounting.

Before sending, the selection is saved in the URL, not as a new backend history
round. Opening a bare conversation link without `model` recovers its latest
persisted model once history has loaded. An explicit URL model takes precedence
over history, allowing a deliberate model switch. If URL replacement fails, the
in-memory selection remains usable, but reload may lose that unsaved choice;
router failure does not interrupt the active reply.

## Verification

`web/hooks/use-conversation-model.test.tsx` covers URL choice, optimistic updates,
parameter/hash preservation, reload/navigation, history/default fallback, scope
changes and rejected navigation.

`web/tests/pages/chat/model-selection.test.tsx` renders the native page with fixture
API/transport boundaries. It checks the selected model in the actual page's
request, new versus historical messages, App refresh and stale history races.
It does not invoke a paid LLM or certify deployed provider usage. Native App
usage counters remain a separate concern; unknown provider usage is not zero.

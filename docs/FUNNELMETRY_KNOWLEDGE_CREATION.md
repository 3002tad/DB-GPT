# Knowledge Base creation

The unified Knowledge Base form submits Text content directly. It creates the
space, adds a `TEXT` document using the space name as its initial document name,
then calls the existing batch synchronization API with the selected chunk
strategy, size and overlap. Raw text is preserved, including Unicode and line
breaks. The retained URL form follows the same path with `doc_type=URL`; the URL
source card remains hidden as before.

After the server accepts synchronization, the form closes and opens the space
detail page. Acceptance starts asynchronous indexing; it does not certify that
indexing or retrieval has finished. The detail page remains the source of its
actual document status.

There is no handoff from inline Text/URL creation to the legacy document-type
and upload steps. File upload, Git synchronization and connector binding keep
their existing source-specific paths. Existing knowledge spaces/documents are
not migrated or rewritten.

## Partial failure

Within an open form, once space creation succeeds its inputs are locked. Cancel
and submit remain available. A retry reuses that space; after document creation
returns its ID, retries reuse the document and only resubmit synchronization.
Transport errors and `success=false` responses do not close the form or navigate
to detail. Concurrent submit attempts are ignored while the request is pending.

This is in-form recovery, not a durable idempotency protocol. Reloading/closing
the form loses its progress references. If a response is lost after a server
commit, inspect the existing space/document in the detail page before retrying;
the existing backend uniqueness checks remain in force.

## Verification

`web/components/knowledge/space-form.test.tsx` exercises the real Ant Design
form with API boundary fixtures: direct Text creation, exact content/chunk
parameters (including zero overlap), document failure, synchronization transport
failure and synchronization business failure. The latter cases verify that
known successful operations are not repeated. It does not perform paid embedding
or certify live retrieval. Run with the repository Vitest dashboard config and
run TypeScript before deployment.

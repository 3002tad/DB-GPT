# Funnelmetry conversation workspace persistence

Python and shell share `/app/pilot/tmp/<conversation_id>`. Python variables do
not persist between calls; files in that directory do. The SQL capture store
under `/app/pilot/data/report-artifacts` and published images under
`/app/pilot/message/img` are separate from these working files.

The VPS baseline deployed on 2026-11-24 mounts external named volume
`ai-agent_agent-workspaces` at `/app/pilot/tmp`, alongside the existing data and
message mounts. A marker checksum survived webserver recreation. The old
container's workspace backup contained zero files; no missing historical files
were claimed as restored. Persisting a capture does not make Python variables
persistent or every historical raw file path available.

The overlay `funnelmetry-workspace-persistence.yml` adds a named volume at the
existing path. It changes neither tool permissions nor execution isolation and
does not move files or recreate services by itself.

For a new installation or another migration, apply during a controlled deployment:

1. Pause new tool executions and wait for existing Python/shell work to finish.
2. Record the running container/image and back up `/app/pilot/tmp` while that
   container still exists. Retain the original container until the copy has
   been checked; do not remove it first.
3. Create the Compose project's `agent-workspaces` volume. Copy the backed-up
   directory contents into its root, preserving subdirectories and permissions.
   Use a networkless temporary helper with only that volume mounted. Do not
   merge the old workspace into an already populated volume without reviewing
   conflicting paths. Compare relative paths, file sizes and SHA-256 checksums.
4. Add this overlay to the existing Compose file list, with the same project
   name (`ai-agent`). Confirm the effective `webserver` mounts include
   `/app/pilot/data`, `/app/pilot/message` and `/app/pilot/tmp` before recreating
   only `webserver`.
5. Verify an existing CSV download, an existing image and a two-call Python
   file handoff. Check that the target volume is mounted, then recreate once
   more and verify the same file checksum. No LLM call is needed for this test.

If working files were already lost during an earlier recreation, the overlay
cannot recover them. Recover a file from a durable capture/backup only when it
actually exists; do not mark a missing file as restored from its old path alone.
This overlay does not implement retention/GC, recover Python variables or certify
that every historical artifact is still available.

## Captured CSV reuse (source update; pending deployment)

The Python tool now returns a bounded `saved_result` preview of `REPORT_RESULT`.
`session_evidence(artifact_id=..., read_values=True)` can retrieve the saved
result, including labels and dates, without another calculation/source query.
An explicit truncation flag distinguishes a preview from a complete table.

In the child Python process, `pd.read_csv` recognizes prior CSV exports captured
in the same owner's conversation. It reads a byte snapshot and checks SHA-256
before linking the file artifact to the new Python/chart artifact. Unread,
changed, unregistered and other-conversation files are not assigned that old
lineage. Native file access remains available; readers other than `pd.read_csv`
are not automatically instrumented by this CSV hook. This is provenance support,
not execution isolation or certification of a dataset's business meaning.

Malformed Python/nested JSON payloads return a source-line/argument repair hint
before an approval card. Ordinary CSV/JSON exports through the injected
`output_path` helper can run without a manual confirmation; other filesystem,
network, subprocess and database-write rules remain in effect. Inspecting files
or schemas alone does not require fabricating `REPORT_RESULT`.

Verification: 200 targeted backend regressions passed; 3 optional Docker cases
were skipped. Tests execute SQL-capture → typed Python → CSV → chart handoff,
including changed/unread/foreign files, compressed/keyword CSV reads, malformed
code before approval, saved-result retrieval and existing approval rules. Tests
run in a networkless temporary container; they do not measure model token savings.

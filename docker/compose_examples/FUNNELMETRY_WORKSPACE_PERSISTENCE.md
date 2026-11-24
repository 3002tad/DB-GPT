# Funnelmetry conversation workspace persistence

Python and shell share `/app/pilot/tmp/<conversation_id>`. Python variables do
not persist between calls; files in that directory do. The SQL capture store
under `/app/pilot/data/report-artifacts` and published images under
`/app/pilot/message/img` are separate from these working files.

On the inspected VPS, `data` and `message` are mounted but `tmp` is not. A
container restart keeps its writable layer; replacing/recreating that container
can remove working CSV/JSON/scripts and break old file-card paths. Persisting a
capture does not make every mutable workspace path durable.

The overlay `funnelmetry-workspace-persistence.yml` adds a named volume at the
existing path. It changes neither tool permissions nor execution isolation and
does not move files or recreate services by itself.

Apply during the next controlled deployment:

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

# Funnelmetry MySQL metadata migrations

Apply these migrations to the DB-GPT **internal MySQL metadata database** in
number order after the upstream schema upgrade. They do not target the Pipeline
analytical PostgreSQL database. Back up the metadata database first and ensure
the selected database is the intended DB-GPT instance.

`001_gpts_messages_trace_id.sql` adds the nullable `varchar(64)` trace ID and
its index required by `GptsMessagesEntity`. It is additive and can be retried;
existing messages retain NULL trace IDs. Select the metadata database when
executing the script, for example:

```sh
mysql --defaults-extra-file=/path/to/private-client.cnf dbgpt \
  < assets/schema/upgrade/funnelmetry/001_gpts_messages_trace_id.sql
```

The current `assets/schema/dbgpt.sql` includes the column for a new installation.
The historical v0.8.3 snapshot remains unchanged; apply migration 001 after an
upstream upgrade when initializing or upgrading from that snapshot. Docker
entrypoint SQL scripts execute only when the MySQL volume is empty; an existing
volume needs the migration applied explicitly.

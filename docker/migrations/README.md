# DB-GPT MySQL metadata migrations

DB-GPT does not automatically initialize or upgrade MySQL metadata schemas.
Apply versioned migrations to the intended DB-GPT metadata database after the
base schema has been initialized and before starting the corresponding version.
Back up the metadata database and verify the target database before applying.

`20261102_model_provider_config_mysql.sql` adds the provider configuration
table used by the model-provider API. It is idempotent for an absent or already
compatible table; it does not migrate an incompatible existing table.

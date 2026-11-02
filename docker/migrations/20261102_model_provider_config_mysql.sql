-- DB-GPT does not automatically create or upgrade MySQL metadata tables.
-- Add the table required by ModelProviderConfigEntity without altering existing data.
CREATE TABLE IF NOT EXISTS dbgpt_serve_model_provider_config (
  id INTEGER NOT NULL AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(255) NOT NULL,
  label VARCHAR(255) NULL,
  api_key TEXT NULL,
  api_base VARCHAR(512) NULL,
  enabled_models TEXT NULL,
  gmt_created DATETIME NULL,
  gmt_modified DATETIME NULL,
  CONSTRAINT uk_provider_config_provider UNIQUE (provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

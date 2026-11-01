-- Funnelmetry migration 001: bring legacy MySQL GPT messages in line with ORM.
-- Select the DB-GPT metadata database before executing. Safe to run repeatedly.
-- This is additive: existing message rows are preserved with trace_id = NULL.
SET @fm_has_trace_id = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'gpts_messages' AND column_name = 'trace_id'
);
SET @fm_ddl = IF(@fm_has_trace_id = 0,
  'ALTER TABLE `gpts_messages` ADD COLUMN `trace_id` varchar(64) DEFAULT NULL COMMENT ''Trace id linking this message to observability spans''',
  'DO 0');
PREPARE fm_stmt FROM @fm_ddl;
EXECUTE fm_stmt;
DEALLOCATE PREPARE fm_stmt;

SET @fm_has_trace_index = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'gpts_messages'
    AND index_name = 'ix_gpts_messages_trace_id'
);
SET @fm_ddl = IF(@fm_has_trace_index = 0,
  'ALTER TABLE `gpts_messages` ADD INDEX `ix_gpts_messages_trace_id` (`trace_id`)',
  'DO 0');
PREPARE fm_stmt FROM @fm_ddl;
EXECUTE fm_stmt;
DEALLOCATE PREPARE fm_stmt;

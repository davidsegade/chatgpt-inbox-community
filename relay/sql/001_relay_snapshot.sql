BEGIN;
CREATE SCHEMA IF NOT EXISTS chatgpt_inbox;
REVOKE ALL ON SCHEMA chatgpt_inbox FROM PUBLIC;
CREATE TABLE IF NOT EXISTS chatgpt_inbox.relay_snapshot (id smallint PRIMARY KEY CHECK(id=1),state jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON chatgpt_inbox.relay_snapshot FROM PUBLIC;
COMMIT;
-- Grant USAGE on schema, SELECT/INSERT/UPDATE on table ONLY to a dedicated DB role.

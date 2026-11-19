-- Full-text search: entities.search is kept current from title and search_text, using the
-- workspace's text-search configuration. Changing the configuration needs a reindex.
CREATE FUNCTION audit_search_config() RETURNS regconfig
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT search_config FROM workspace WHERE id = 1), 'english')::regconfig
$$;
--> statement-breakpoint
CREATE FUNCTION entities_search_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cfg regconfig := audit_search_config();
BEGIN
  NEW.search := setweight(to_tsvector(cfg, coalesce(NEW.title, '')), 'A')
    || setweight(to_tsvector(cfg, coalesce(NEW.search_text, '')), 'B');
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER entities_search
  BEFORE INSERT OR UPDATE OF title, search_text ON entities
  FOR EACH ROW EXECUTE FUNCTION entities_search_update();
--> statement-breakpoint
-- Audit trail hash chain: hash = sha256(prev_hash || canonical row). The same function verifies
-- the chain (`audit trail verify`).
CREATE FUNCTION trail_event_hash(t trail_events) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws(
    '|',
    coalesce(t.prev_hash, ''),
    t.seq::text,
    t.id::text,
    to_char(t.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    t.actor_type,
    coalesce(t.actor_id::text, ''),
    coalesce(t.on_behalf_of::text, ''),
    t.action,
    coalesce(t.entity_id::text, ''),
    coalesce(t.entity_type, ''),
    coalesce(t.project_id::text, ''),
    coalesce(t.diff::text, ''),
    t.meta::text
  ), 'UTF8')), 'hex')
$$;
--> statement-breakpoint
-- Serialises writers with a transaction-scoped advisory lock, so seq order equals chain order.
CREATE FUNCTION trail_events_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_seq bigint;
  last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit:trail_events'));
  SELECT seq, hash INTO last_seq, last_hash FROM trail_events ORDER BY seq DESC LIMIT 1;
  NEW.seq := coalesce(last_seq, 0) + 1;
  NEW.prev_hash := last_hash;
  NEW.hash := trail_event_hash(NEW);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trail_events_chain
  BEFORE INSERT ON trail_events
  FOR EACH ROW EXECUTE FUNCTION trail_events_chain();
--> statement-breakpoint
-- Append-only: updates are always rejected; deletes only for the retention role.
CREATE FUNCTION trail_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'audit_retention' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'trail_events is append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER trail_events_append_only
  BEFORE UPDATE OR DELETE ON trail_events
  FOR EACH ROW EXECUTE FUNCTION trail_events_append_only();
--> statement-breakpoint
CREATE TRIGGER trail_events_no_truncate
  BEFORE TRUNCATE ON trail_events
  FOR EACH STATEMENT EXECUTE FUNCTION trail_events_append_only();
--> statement-breakpoint
-- Database roles. The server logs in with DATABASE_URL (the migrator), then runs requests as
-- audit_app and retention purges as audit_retention.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_app') THEN
    CREATE ROLE audit_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_retention') THEN
    CREATE ROLE audit_retention NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT audit_app, audit_retention TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO audit_app, audit_retention;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO audit_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO audit_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO audit_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO audit_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON trail_events FROM audit_app;
--> statement-breakpoint
GRANT SELECT, DELETE ON trail_events TO audit_retention;

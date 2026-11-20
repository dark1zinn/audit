-- HMAC for the audit trail. pgcrypto provides hmac(); it is a trusted extension.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE "trail_key" (
	"id" integer PRIMARY KEY,
	"key_ciphertext" text,
	"key_nonce" text,
	"legacy_through" bigint NOT NULL,
	CONSTRAINT "trail_key_singleton_check" CHECK ("id" = 1)
);
--> statement-breakpoint
-- Entries up to the current head predate the key: they keep the unkeyed SHA-256 chain. Every later
-- entry is chained with HMAC under the sealed trail key (generated on first write).
INSERT INTO trail_key (id, legacy_through) SELECT 1, coalesce(max(seq), 0) FROM trail_events;
--> statement-breakpoint
-- The canonical text of a row, excluding its own hash. Both chains hash this text.
CREATE OR REPLACE FUNCTION trail_event_canonical(t trail_events) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws(
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
  )
$$;
--> statement-breakpoint
-- Legacy chain (entries up to trail_key.legacy_through): sha256 of the canonical text.
CREATE OR REPLACE FUNCTION trail_event_hash(t trail_events) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(trail_event_canonical(t), 'UTF8')), 'hex')
$$;
--> statement-breakpoint
-- Keyed chain: HMAC-SHA256 of the canonical text under the trail key. NULL key gives NULL.
CREATE FUNCTION trail_event_mac(t trail_events, key text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(hmac(convert_to(trail_event_canonical(t), 'UTF8'), convert_to(key, 'UTF8'), 'sha256'), 'hex')
$$;
--> statement-breakpoint
-- Serialises writers with a transaction-scoped advisory lock, so seq order equals chain order.
-- The trail key arrives as a transaction-local setting from the writer; without it the insert fails.
CREATE OR REPLACE FUNCTION trail_events_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_seq bigint;
  last_hash text;
  key text := current_setting('audit.trail_key', true);
BEGIN
  IF coalesce(key, '') = '' THEN
    RAISE EXCEPTION 'trail key is not set for this transaction' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('audit:trail_events'));
  SELECT seq, hash INTO last_seq, last_hash FROM trail_events ORDER BY seq DESC LIMIT 1;
  NEW.seq := coalesce(last_seq, 0) + 1;
  NEW.prev_hash := last_hash;
  NEW.hash := trail_event_mac(NEW, key);
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- Append-only: updates are always rejected; deletes only inside trail_purge().
CREATE OR REPLACE FUNCTION trail_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('audit.trail_purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'trail_events is append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
-- Retention: the only path that deletes trail rows. Runs with the owner's rights, so the app login
-- needs no DELETE privilege on trail_events.
CREATE FUNCTION trail_purge(retention_days integer) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  purged bigint;
BEGIN
  IF retention_days IS NULL OR retention_days < 1 THEN
    RAISE EXCEPTION 'trail retention must be at least one day' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('audit.trail_purge', 'on', true);
  DELETE FROM trail_events WHERE at < now() - make_interval(days => retention_days);
  GET DIAGNOSTICS purged = ROW_COUNT;
  PERFORM set_config('audit.trail_purge', 'off', true);
  RETURN purged;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION trail_purge(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION trail_purge(integer) TO audit_app;
--> statement-breakpoint
-- The retention role no longer deletes anything: the function replaces it. The role itself stays
-- because roles are cluster-wide and other databases may still hold grants on it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_retention') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM audit_retention;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM audit_retention;
    REVOKE USAGE ON SCHEMA public FROM audit_retention;
  END IF;
END
$$;
--> statement-breakpoint
-- The sealed key is read and rotated by the app but never deleted.
GRANT SELECT, INSERT, UPDATE ON trail_key TO audit_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON trail_key FROM audit_app;

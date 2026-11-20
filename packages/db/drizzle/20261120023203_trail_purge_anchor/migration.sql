-- The first entry kept by the latest purge. Purging removes the head of the chain, so the surviving
-- chain has to be pinned to where it now starts; otherwise deleting a prefix would go unnoticed.
CREATE TABLE trail_anchor (
	kept_seq bigint PRIMARY KEY,
	kept_prev_hash text,
	purged bigint NOT NULL,
	purged_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
REVOKE ALL ON trail_anchor FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON trail_anchor TO audit_app;
--> statement-breakpoint
-- Retention: the only path that deletes trail rows. The floor matches the app's minimum (30 days).
-- It records the new chain start in trail_anchor, replacing the previous anchor.
CREATE OR REPLACE FUNCTION trail_purge(retention_days integer) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  removed bigint;
  kept_seq_value bigint;
  kept_prev_hash_value text;
BEGIN
  IF retention_days IS NULL OR retention_days < 30 THEN
    RAISE EXCEPTION 'trail retention must be at least 30 days' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('audit.trail_purge', 'on', true);
  DELETE FROM trail_events WHERE at < now() - make_interval(days => retention_days);
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM set_config('audit.trail_purge', 'off', true);
  IF removed > 0 THEN
    DELETE FROM trail_anchor;
    SELECT seq, prev_hash INTO kept_seq_value, kept_prev_hash_value FROM trail_events ORDER BY seq LIMIT 1;
    IF kept_seq_value IS NOT NULL THEN
      INSERT INTO trail_anchor (kept_seq, kept_prev_hash, purged) VALUES (kept_seq_value, kept_prev_hash_value, removed);
    END IF;
  END IF;
  RETURN removed;
END
$$;

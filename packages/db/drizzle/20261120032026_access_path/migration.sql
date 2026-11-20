-- `entities.access_path` is the entity, then its ancestors up to the first restricted or container
-- node: the chain `visibleTo` and `roleOnEntity` check grants along. Triggers keep it current on
-- every insert and on every change to `parent_id`, `restricted` or `type`, re-pathing the whole
-- subtree in the same statement. The backfill computes it for existing rows.
ALTER TABLE "entities" ADD COLUMN "access_path" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
CREATE INDEX "entities_access_path_gin" ON "entities" USING gin ("access_path");--> statement-breakpoint
CREATE FUNCTION "entities_access_path_refresh"(root_id uuid) RETURNS void LANGUAGE sql AS $$
  WITH RECURSIVE tree AS (
    SELECT r.id,
      CASE WHEN r.restricted OR r.type IN ('project', 'board', 'channel', 'calendar', 'space') OR r.parent_id IS NULL
        THEN ARRAY[r.id]
        ELSE ARRAY[r.id] || coalesce((SELECT p.access_path FROM entities p WHERE p.id = r.parent_id), '{}')
      END AS path
    FROM entities r WHERE r.id = root_id
    UNION ALL
    SELECT c.id,
      CASE WHEN c.restricted OR c.type IN ('project', 'board', 'channel', 'calendar', 'space')
        THEN ARRAY[c.id]
        ELSE ARRAY[c.id] || t.path
      END
    FROM tree t JOIN entities c ON c.parent_id = t.id
  )
  UPDATE entities e SET access_path = tree.path FROM tree WHERE e.id = tree.id;
$$;--> statement-breakpoint
CREATE FUNCTION "entities_access_path_rebuild"() RETURNS void LANGUAGE sql AS $$
  SELECT entities_access_path_refresh(e.id) FROM entities e WHERE e.parent_id IS NULL;
$$;--> statement-breakpoint
CREATE FUNCTION "entities_access_path_on_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.restricted OR NEW.type IN ('project', 'board', 'channel', 'calendar', 'space') OR NEW.parent_id IS NULL THEN
    NEW.access_path := ARRAY[NEW.id];
  ELSE
    NEW.access_path := ARRAY[NEW.id] || coalesce((SELECT p.access_path FROM entities p WHERE p.id = NEW.parent_id), '{}');
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "entities_access_path_insert" BEFORE INSERT ON "entities" FOR EACH ROW EXECUTE FUNCTION "entities_access_path_on_insert"();--> statement-breakpoint
CREATE FUNCTION "entities_access_path_on_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM entities_access_path_refresh(NEW.id);
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "entities_access_path_change" AFTER UPDATE OF "parent_id", "restricted", "type" ON "entities" FOR EACH ROW
  WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id OR OLD.restricted IS DISTINCT FROM NEW.restricted OR OLD.type IS DISTINCT FROM NEW.type)
  EXECUTE FUNCTION "entities_access_path_on_change"();--> statement-breakpoint
SELECT entities_access_path_rebuild();

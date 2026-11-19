-- The workspace space container: fixed id, referenced by WORKSPACE_SPACE_ID in @audit/domain.
INSERT INTO "entities" ("id", "type", "title", "search_text", "restricted", "created_at", "updated_at", "version")
VALUES ('018f0000-0000-7000-8000-000000000001', 'space', 'Workspace', 'Workspace', false, now(), now(), 1)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Owners and admins manage the space, members edit its docs; guests get no default access.
INSERT INTO "access_entries" ("resource_id", "principal_type", "principal_id", "principal_role", "role")
VALUES
  ('018f0000-0000-7000-8000-000000000001', 'role', NULL, 'owner', 'manager'),
  ('018f0000-0000-7000-8000-000000000001', 'role', NULL, 'admin', 'manager'),
  ('018f0000-0000-7000-8000-000000000001', 'role', NULL, 'member', 'editor');--> statement-breakpoint
INSERT INTO "container_access" ("container_id", "user_id", "role")
SELECT '018f0000-0000-7000-8000-000000000001', m."user_id",
  CASE WHEN m."role" = 'member' THEN 'editor' ELSE 'manager' END
FROM "workspace_members" m
WHERE m."role" IN ('owner', 'admin', 'member')
ON CONFLICT ("user_id", "container_id") DO NOTHING;

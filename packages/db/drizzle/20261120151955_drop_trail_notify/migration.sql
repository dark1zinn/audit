-- NOTIFY takes a database-wide lock at commit (to order the notification queue), so a NOTIFY on
-- every trail insert serialised all command commits again. The chainer is woken in-process instead.
DROP TRIGGER IF EXISTS trail_events_notify ON trail_events;--> statement-breakpoint
DROP FUNCTION IF EXISTS trail_events_notify();

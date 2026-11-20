-- Verification-link sign-ups are gone: their requests are dropped, and the pending ones keep a 14-day
-- expiry so the admin list only shows live requests.
DELETE FROM "signup_requests" WHERE "token_hash" IS NOT NULL;--> statement-breakpoint
UPDATE "signup_requests" SET "expires_at" = "created_at" + interval '14 days' WHERE "expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "signup_requests" DROP CONSTRAINT "signup_requests_token_hash_key";--> statement-breakpoint
ALTER TABLE "signup_requests" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "signup_requests" DROP COLUMN "locale";--> statement-breakpoint
ALTER TABLE "signup_requests" DROP COLUMN "timezone";--> statement-breakpoint
ALTER TABLE "signup_requests" DROP COLUMN "token_hash";--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "signup_requests" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "signup_requests" ALTER COLUMN "expires_at" SET NOT NULL;

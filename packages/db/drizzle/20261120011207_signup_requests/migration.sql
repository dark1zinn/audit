CREATE TABLE "signup_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"email" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"locale" text,
	"timezone" text NOT NULL,
	"token_hash" text UNIQUE,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Extensions used by the schema: pgvector for embeddings, pg_trgm for fuzzy titles.
-- One statement per chunk: the Effect migrator prepares each chunk as a single statement.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;

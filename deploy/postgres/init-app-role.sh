#!/bin/sh
# Runs once, when the Postgres volume is first created. Creates the login the server uses for
# requests (DATABASE_URL). The migrator login (POSTGRES_USER) owns the schema and runs migrations.
# The migration creates audit_app as NOLOGIN only when it is missing, so this role stays a login.
set -eu
psql -v ON_ERROR_STOP=1 -v app_pw="$APP_DB_PASSWORD" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
CREATE ROLE audit_app LOGIN PASSWORD :'app_pw';
EOSQL

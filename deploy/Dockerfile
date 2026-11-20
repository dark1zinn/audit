# syntax=docker/dockerfile:1
# Build context is the repository root:  docker build -f deploy/Dockerfile .

# ---- build: install, bundle the web app, compile one Bun binary --------------------------------
FROM oven/bun:1.4.4 AS build
WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build:web
RUN bun build --compile --minify apps/server/src/cli.ts --outfile /out/audit

# ---- runtime: the binary, migrations, web assets, and PostgreSQL 18 client tools ---------------
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && apt-get purge -y gnupg \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s /usr/lib/postgresql/18/bin/* /usr/local/bin/

RUN useradd --system --uid 10001 --home-dir /home/audit --create-home audit \
 && install -d -o audit -g audit /data /data/files

WORKDIR /app
COPY --from=build /out/audit /app/audit
COPY --from=build /src/packages/db/drizzle /app/migrations
COPY --from=build /src/apps/web/dist /app/web/dist

ENV NODE_ENV=production \
    LOG_LEVEL=info \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist \
    MIGRATIONS_DIR=/app/migrations \
    HOME=/home/audit

USER 10001
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/readyz || exit 1

# SIGTERM stops accepting connections, flushes collaborative documents and job workers, then exits.
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/audit"]
CMD ["serve"]

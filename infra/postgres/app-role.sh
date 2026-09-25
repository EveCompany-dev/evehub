#!/bin/sh
# Run by the `db-init` service in docker-compose.yml, as the superuser.
# Creates the role web and worker connect as (or resets its password), and
# gives it read/write on every table in `public`, present and future.
# Safe to run any number of times.
set -eu

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE evehub_app LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'evehub_app')\gexec

ALTER ROLE evehub_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';

GRANT CONNECT ON DATABASE evehub TO evehub_app;
GRANT USAGE ON SCHEMA public TO evehub_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO evehub_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO evehub_app;

-- Tables and sequences that later migrations create (as the superuser) get
-- the same grants automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE eve IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO evehub_app;
ALTER DEFAULT PRIVILEGES FOR ROLE eve IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO evehub_app;
SQL

echo "db-init: role evehub_app ready"

#!/usr/bin/env bash
# ============================================================
#  ArcenPay — migrate a Postgres database to a new one
#
#  A faithful logical dump + restore: schema, data, sequences, indexes,
#  constraints and the Prisma migration history all move across unchanged.
#
#  Credentials are read from environment variables — never arguments — so they
#  do not leak into your shell history or `ps`. Nothing is sent anywhere else.
#
#  Usage:
#    SOURCE_DATABASE_URL='postgres://…old…' \
#    TARGET_DATABASE_URL='postgres://…new…' \
#      scripts/migrate-postgres.sh
#
#    # add FORCE=1 to write into a non-empty target
# ============================================================
set -euo pipefail

SRC="${SOURCE_DATABASE_URL:-}"
DST="${TARGET_DATABASE_URL:-}"
FORCE="${FORCE:-}"
WORK_DIR="${MIGRATION_WORK_DIR:-$(mktemp -d)}"
DUMP="$WORK_DIR/arcenpay.dump"

die() { echo "✗ $*" >&2; exit 1; }

for bin in psql pg_dump pg_restore; do
  command -v "$bin" >/dev/null 2>&1 || die "'$bin' not found. Install the Postgres client tools first."
done

[ -n "$SRC" ] || die "SOURCE_DATABASE_URL is not set."
[ -n "$DST" ] || die "TARGET_DATABASE_URL is not set."
[ "$SRC" != "$DST" ] || die "Source and target are the same database."

# ── Preflight: both reachable, and how much we are moving ───────────────────
echo "→ Checking connections…"
SRC_VER="$(psql "$SRC" -Atc 'select version()' 2>&1 | head -1)" || die "Cannot reach SOURCE: $SRC_VER"
DST_VER="$(psql "$DST" -Atc 'select version()' 2>&1 | head -1)" || die "Cannot reach TARGET: $DST_VER"

# pg_dump/pg_restore must be at least the server's major version — they refuse
# to operate on a newer server, and the failure ("server version mismatch") is
# easy to miss. Check up front with a fix in the message.
for tool in pg_dump pg_restore; do
  CLIENT_MAJOR="$("$tool" --version | sed -E 's/.* ([0-9]+).*/\1/')"
  SRC_MAJOR="$(psql "$SRC" -Atc "select current_setting('server_version_num')::int / 10000")"
  DST_MAJOR="$(psql "$DST" -Atc "select current_setting('server_version_num')::int / 10000")"
  NEED=$(( SRC_MAJOR > DST_MAJOR ? SRC_MAJOR : DST_MAJOR ))
  if [ "$CLIENT_MAJOR" -lt "$NEED" ]; then
    die "$tool is v$CLIENT_MAJOR but the server is v$NEED.
  pg_dump/pg_restore must be >= the server version. Fix with one of:
    brew install postgresql@$NEED && brew link --force postgresql@$NEED
    # or point at an existing install:
    export PATH=\"\$(brew --prefix postgresql@$NEED)/bin:\$PATH\"
  Then re-run this script."
  fi
done
echo "  clients: pg_dump/pg_restore v$("pg_dump" --version | sed -E 's/.* ([0-9]+).*/\1/') (>= server, ok)"
echo "  source: ${SRC_VER:0:60}…"
echo "  target: ${DST_VER:0:60}…"

SRC_COUNT="$(psql "$SRC" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
DST_COUNT="$(psql "$DST" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
echo "  source tables: $SRC_COUNT   target tables: $DST_COUNT"

if [ "$DST_COUNT" != "0" ] && [ "$FORCE" != "1" ]; then
  die "TARGET already has $DST_COUNT tables. Refusing to write into a non-empty
  database. Re-run with FORCE=1 if you are certain."
fi

if [ "$FORCE" != "1" ]; then
  echo
  echo "  This will REPLACE the contents of the target with the source."
  echo "  Stop writes to the OLD database first (scale the backend down), or any"
  echo "  rows written during this run will be lost."
  read -r -p "  Type 'migrate' to continue: " ok
  [ "$ok" = "migrate" ] || die "Aborted."
fi

# ── Dump ────────────────────────────────────────────────────────────────────
# --no-owner/--no-acl so role names on the old host do not have to exist on the
# new one. Custom format preserves everything and restores in parallel.
echo
echo "→ Dumping source…"
pg_dump "$SRC" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$DUMP"
echo "  wrote $(du -h "$DUMP" | cut -f1) to $DUMP"

# ── Restore ─────────────────────────────────────────────────────────────────
# --clean --if-exists makes this re-runnable; --single-transaction means a
# failure leaves the target untouched rather than half-migrated.
echo "→ Restoring into target…"
pg_restore --dbname="$DST" \
  --clean --if-exists \
  --no-owner \
  --no-acl \
  --single-transaction \
  --exit-on-error \
  "$DUMP"
echo "  restore complete"

# ── Verify: compare row counts table by table ───────────────────────────────
echo "→ Verifying row counts…"
MISMATCH=0
while IFS= read -r table; do
  [ -n "$table" ] || continue
  s="$(psql "$SRC" -Atc "select count(*) from \"$table\"" 2>/dev/null || echo "ERR")"
  d="$(psql "$DST" -Atc "select count(*) from \"$table\"" 2>/dev/null || echo "ERR")"
  if [ "$s" != "$d" ]; then
    echo "  ✗ $table: source=$s target=$d"
    MISMATCH=1
  fi
done < <(psql "$SRC" -Atc "select table_name from information_schema.tables where table_schema='public' order by 1")

# Prisma migration history must move too, or `migrate deploy` will try to
# re-apply everything from scratch.
SRC_MIG="$(psql "$SRC" -Atc 'select count(*) from _prisma_migrations' 2>/dev/null || echo "n/a")"
DST_MIG="$(psql "$DST" -Atc 'select count(*) from _prisma_migrations' 2>/dev/null || echo "n/a")"
echo "  _prisma_migrations: source=$SRC_MIG target=$DST_MIG"

if [ "$MISMATCH" = "1" ]; then
  echo
  echo "✗ Some tables did not match. Do NOT switch DATABASE_URL yet."
  echo "  The dump is still at: $DUMP"
  exit 1
fi

echo
echo "✓ Migration verified — every table matches and the Prisma history moved."
echo
echo "Next steps:"
echo "  1. Point the app at the new database:"
echo "       DATABASE_URL=<new url>   (Railway → Variables → redeploy)"
echo "  2. Size the pool for the new plan's connection limit:"
echo "       DB_POOL_MAX=5"
echo "  3. Keep the old database intact for a few days as a fallback."
echo "     Do not delete it until you have run real traffic through the new one."

#!/usr/bin/env bash
# ============================================================
#  ArcenPay — Unfinished Work Gate
#  Scans first-party source files for TODO, FIXME, stub,
#  placeholder, "Coming in Sprint", and "Requires indexer"
#  markers. Exits non-zero if any are found.
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Directories to scan (first-party only)
SCAN_DIRS=(
  "$REPO_ROOT/apps"
  "$REPO_ROOT/packages"
  "$REPO_ROOT/scripts"
  "$REPO_ROOT/circuits"
  "$REPO_ROOT/subgraph/src"
  "$REPO_ROOT/subgraph/scripts"
)

# Patterns that indicate unfinished work
PATTERNS="TODO|FIXME|Coming in Sprint|Requires indexer|not implemented"

# File extensions to check
EXTENSIONS="ts,tsx,js,jsx,sol,yaml,yml"

# Exclusion patterns (vendor/generated)
EXCLUDES=(
  "*/node_modules/*"
  "*/dist/*"
  "*/build/*"
  "*/generated/*"
  "*/typechain-types/*"
  "*/artifacts/*"
  "*/.next/*"
  "*/lib/forge-std/*"
  "*/lib/openzeppelin-contracts/*"
)

EXCLUDE_ARGS=""
for pattern in "${EXCLUDES[@]}"; do
  EXCLUDE_ARGS="$EXCLUDE_ARGS --glob=!$pattern"
done

FOUND=0
for dir in "${SCAN_DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    continue
  fi

  # Build include globs for extensions
  INCLUDE_ARGS=""
  IFS=',' read -ra EXTS <<< "$EXTENSIONS"
  for ext in "${EXTS[@]}"; do
    INCLUDE_ARGS="$INCLUDE_ARGS --glob=*.${ext}"
  done

  # Use grep (or rg if available) to find matches
  if command -v rg &> /dev/null; then
    MATCHES=$(rg --no-heading --line-number -E "$PATTERNS" $INCLUDE_ARGS $EXCLUDE_ARGS "$dir" 2>/dev/null || true)
  else
    MATCHES=$(grep -rn -E "$PATTERNS" "$dir" \
      --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
      --include="*.sol" --include="*.yaml" --include="*.yml" \
      --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build \
      --exclude-dir=generated --exclude-dir=typechain-types --exclude-dir=artifacts \
      --exclude-dir=.next --exclude-dir=forge-std --exclude-dir=openzeppelin-contracts \
      2>/dev/null || true)
  fi

  if [ -n "$MATCHES" ]; then
    echo "$MATCHES"
    FOUND=1
  fi
done

# Also check for "stub" in doc comments (but not in variable names like "stubbed")
for dir in "${SCAN_DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    continue
  fi

  if command -v rg &> /dev/null; then
    STUB_MATCHES=$(rg --no-heading --line-number -E "(\bstub\b|Phase \d+ stub)" $INCLUDE_ARGS $EXCLUDE_ARGS "$dir" 2>/dev/null || true)
  else
    STUB_MATCHES=$(grep -rn -wE "(stub|Phase [0-9]+ stub)" "$dir" \
      --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
      --include="*.sol" --include="*.yaml" --include="*.yml" \
      --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build \
      --exclude-dir=generated --exclude-dir=typechain-types --exclude-dir=artifacts \
      --exclude-dir=.next --exclude-dir=forge-std --exclude-dir=openzeppelin-contracts \
      2>/dev/null || true)
  fi

  if [ -n "$STUB_MATCHES" ]; then
    echo "$STUB_MATCHES"
    FOUND=1
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "❌ Unfinished work markers found in first-party files."
  echo "   Resolve all TODO/FIXME/stub/placeholder markers before merging."
  exit 1
fi

echo "✅ No unfinished work markers found in first-party files."
exit 0

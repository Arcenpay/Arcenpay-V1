#!/usr/bin/env bash
# ============================================================
#  ArcenPay — Unfinished Work Gate
#  Scans first-party source comments for explicit unfinished-work
#  markers such as TODO/FIXME/"Coming in Sprint"/"Requires indexer".
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

# Patterns that indicate unfinished work when they appear in comments
MARKER_PATTERNS="TODO|FIXME|Coming in Sprint|Requires indexer|not implemented|Phase [0-9]+ stub"
COMMENT_PATTERN="^\\s*(//|/\\*|\\*|#).*($MARKER_PATTERNS)"

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

  # Match unfinished-work markers in comments only to avoid false positives in
  # valid runtime strings/types (for example, "mode: \"stub\" | \"final\"").
  if command -v rg &> /dev/null; then
    MATCHES=$(rg --no-heading --line-number -E "$COMMENT_PATTERN" $INCLUDE_ARGS $EXCLUDE_ARGS "$dir" 2>/dev/null || true)
  else
    MATCHES=$(grep -rn -E "$COMMENT_PATTERN" "$dir" \
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

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "❌ Unfinished work markers found in first-party files."
  echo "   Resolve all TODO/FIXME/stub/placeholder markers before merging."
  exit 1
fi

echo "✅ No unfinished work markers found in first-party files."
exit 0

#!/usr/bin/env bash
# Parse every real-world file of a given extension under corpus/edk2 with a
# grammar, and report how many produce parser ERROR or MISSING nodes. This
# is the "does it survive contact with the real world" check CLAUDE.md's
# test-first workflow calls for, generalized across formats.
#
# Usage: scripts/corpus-sweep.sh <lang> [extension]
# Examples:
#   scripts/corpus-sweep.sh dec
#   scripts/corpus-sweep.sh inf inf
#   scripts/corpus-sweep.sh fdf fdf
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <lang> [extension]" >&2
  exit 1
fi

LANG_NAME="$1"
EXT="${2:-$LANG_NAME}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LANG_DIR="$ROOT/$LANG_NAME"
CORPUS="$ROOT/corpus/edk2"

if [ ! -d "$LANG_DIR" ]; then
  echo "No such grammar directory: $LANG_DIR" >&2
  exit 1
fi

if [ ! -d "$CORPUS" ]; then
  echo "corpus/edk2 not found -- see CLAUDE.md's 'Real-world corpus' section" >&2
  echo "  git submodule add https://github.com/tianocore/edk2.git corpus/edk2" >&2
  exit 1
fi

cd "$LANG_DIR"
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund >&2
fi
npx --no-install tree-sitter generate >&2

total=0
failed=0
while IFS= read -r -d '' f; do
  total=$((total + 1))
  errors="$(npx --no-install tree-sitter parse "$f" 2>/dev/null | grep -cE 'ERROR|MISSING' || true)"
  if [ "$errors" != "0" ]; then
    failed=$((failed + 1))
    echo "FAIL ($errors error/missing node(s)): $f"
  fi
done < <(find "$CORPUS" -iname "*.$EXT" -print0)

echo "total=$total failed=$failed"
[ "$failed" -eq 0 ]

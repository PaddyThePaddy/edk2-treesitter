#!/usr/bin/env bash
# Build a grammar's parser, wire it plus its queries into an isolated
# Neovim runtime (so it can't collide with your real Neovim config or
# nvim-treesitter installation), and report any ERROR/MISSING nodes plus
# the resolved highlight captures for a real file. This is the repeatable
# form of the "actually open it in Neovim" validation step CLAUDE.md
# requires before a grammar/query change counts as done.
#
# Usage: scripts/nvim-highlight-check.sh <lang> <file> [max-lines]
# Example:
#   scripts/nvim-highlight-check.sh dec corpus/edk2/MdePkg/MdePkg.dec
#   scripts/nvim-highlight-check.sh dec corpus/edk2/MdePkg/MdePkg.dec 50
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <lang> <file> [max-lines]" >&2
  exit 1
fi

LANG_NAME="$1"
INPUT_FILE="$2"
MAX_LINES="${3:-200}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LANG_DIR="$ROOT/$LANG_NAME"

if [ ! -d "$LANG_DIR" ]; then
  echo "No such grammar directory: $LANG_DIR" >&2
  exit 1
fi
if [ ! -f "$LANG_DIR/queries/highlights.scm" ]; then
  echo "No queries/highlights.scm in $LANG_DIR yet" >&2
  exit 1
fi
if ! command -v nvim >/dev/null 2>&1; then
  echo "nvim not found on PATH" >&2
  exit 1
fi

# Resolve INPUT_FILE to an absolute path before we cd anywhere.
case "$INPUT_FILE" in
  /*) FILE="$INPUT_FILE" ;;
  *) FILE="$(cd "$(dirname "$INPUT_FILE")" && pwd)/$(basename "$INPUT_FILE")" ;;
esac
if [ ! -f "$FILE" ]; then
  echo "No such file: $FILE" >&2
  exit 1
fi

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

mkdir -p "$SCRATCH/parser" "$SCRATCH/queries/$LANG_NAME"

(
  cd "$LANG_DIR"
  if [ ! -d node_modules ]; then
    npm install --no-audit --no-fund >&2
  fi
  npx --no-install tree-sitter build --output "$SCRATCH/parser/$LANG_NAME.so" >&2
)

cp "$LANG_DIR"/queries/*.scm "$SCRATCH/queries/$LANG_NAME/"

NVIM_TS_CHECK_LANG="$LANG_NAME" \
NVIM_TS_CHECK_FILE="$FILE" \
NVIM_TS_CHECK_MAX_LINES="$MAX_LINES" \
NVIM_TS_CHECK_RTP="$SCRATCH" \
nvim --headless \
  -u "$ROOT/scripts/nvim-highlight-check-init.lua" \
  -c "luafile $ROOT/scripts/nvim-highlight-check.lua" \
  -c "qa!"

# CLAUDE.md

Guidance for an AI agent (or human) working in this repository.

## Mission

Build correct, maintainable Tree-sitter grammars — plus the Neovim query
files (`highlights.scm` and friends) that ride on top of them — for six EDK II
meta-data/source formats: `.dec`, `.dsc`, `.fdf`, `.inf`, `.uni`, `.vfr`.

The formats are specified in `references/` (git submodules of the
`tianocore-docs` spec repos), but **the spec is the starting point, not the
ground truth**. EDK II's own build tooling (`edk2/BaseTools`) and decades of
real package/platform source are more permissive, more inconsistent, and
sometimes more restrictive than the prose in the spec. A grammar that only
satisfies the BNF in the spec but chokes on real `edk2`/`edk2-platforms`
files is not done.

**Rule: tests first, per format, then the grammar.** For each format, in
order:

1. Collect a representative sample of real-world files for that format
   (see "Real-world corpus" below).
2. Write `test/corpus/*.txt` test cases (tree-sitter's native corpus format)
   derived from those real files — trimmed to a reasonable size but kept
   *verbatim* in syntax, not rewritten into idealized examples. Write these
   before, or in tight lockstep with, the grammar — not after the grammar
   already parses everything you expected it to.
3. Iterate `grammar.js` until `tree-sitter test` is green for that format,
   then run `scripts/corpus-sweep.sh <lang>` to confirm zero `ERROR` nodes
   across every real file of that format under `corpus/edk2`, not just the
   ones excerpted into the corpus tests.
4. Only then write/refine `queries/highlights.scm`, and validate it by
   actually opening real files in Neovim — `scripts/nvim-highlight-check.sh
   <lang> <file>` does this headlessly (built parser + queries wired into a
   scratch runtime, resolved highlight captures printed per line, non-zero
   exit on ERROR/MISSING nodes), so use it instead of hand-rolling a
   throwaway Lua script per format. A query file that merely "looks
   plausible" against the grammar's node-types list is not validated.
5. Move to the next format.

Do not jump ahead to writing queries for a format whose grammar doesn't yet
pass its corpus tests, and do not invent corpus fixtures that aren't at least
derived from real files — both defeat the point of the test-first approach.

## Suggested format order

Roughly least-to-most complex, and roughly in dependency order (later
formats reuse lessons — comment styles, macro/`$(...)` handling, GUID/hex
literal rules — from earlier ones):

1. **`.dec`** — simplest: INI-style, no preprocessor directives at all.
2. **`.inf`** — same INI-style shape as `.dec`, plus arch/module-type
   section qualifiers and a `[Depex]` mini-expression-language; still no
   preprocessor directives.
3. **`.dsc`** — INI-style plus the shared `!if`/`!ifdef`/`!include` directive
   set and its own expression grammar, plus the nested `<LibraryClasses>`/
   `<Pcds*>`/`<BuildOptions>` blocks inside `[Components]`.
4. **`.fdf`** — same directive/expression grammar as `.dsc`, but the section
   bodies (`[FD]`/`[FV]`/`[Rule]`/`[Capsule]`) are their own nested
   mini-languages (regions, `FILE`/`SECTION` blocks).
5. **`.uni`** — small, self-contained string-table format; mostly orthogonal
   to the others (own comment style, own escape sequences).
6. **`.vfr`** — the odd one out: a genuine C-preprocessor-fed, C-like
   language with its own statement and expression grammar. Save for last;
   it's the largest surface area and benefits from grammar-authoring
   experience on the simpler formats first.

This order is a default, not a constraint — re-sequence if a format turns
out to unblock another, but keep working one format to green before starting
the next.

## Real-world corpus

Add [`edk2`](https://github.com/tianocore/edk2) itself as a git submodule
(e.g. under `corpus/edk2`) to harvest real `.dec`/`.dsc`/`.fdf`/`.inf`/`.uni`
files — `MdePkg`, `MdeModulePkg`, and `OvmfPkg`/`EmulatorPkg` are good,
buildable, heavily-reviewed sources. For `.vfr` (relatively rare — used
mostly by driver/setup modules), also consider
[`edk2-platforms`](https://github.com/tianocore/edk2-platforms), which has a
wider variety of real setup-form modules. Pull specific files into
`<format>/test/corpus/` fixtures rather than pointing tests at the live
submodule checkout, so tests don't silently change when the submodule is
bumped.

```sh
git submodule add https://github.com/tianocore/edk2.git corpus/edk2
```

Only add `edk2-platforms` if `.vfr` (or other) coverage in plain `edk2`
proves too thin — it's a much larger clone.

## Format-specific gotchas (learned from the specs — verify against real files)

- **`.dec` and `.inf` explicitly forbid `!include`/`!if`/`!ifdef`/`!error`
  preprocessor directives.** Only `.dsc` and `.fdf` support them, sharing one
  expression grammar (see `references/edk2-MetaDataExpressionSyntaxSpecification`).
  Don't build directive support into the `.dec`/`.inf` grammars on the
  assumption "the others have it, surely these do too."
- Comment style is **not uniform**: `.dec`/`.dsc`/`.fdf`/`.inf` use `#`
  line comments only (no block comments, no `;`); `.uni` and `.vfr` use C-style
  `//` line comments, and `.vfr` additionally has `/* */` block comments
  (real `.vfr` files also run through a full C preprocessor — `#ifdef`/
  `#ifndef`/`#else`/`#endif` show up in practice even though the formal VFR
  BNF in the spec only documents `#define`/`#include`/`#pragma pack`).
- `#` inside a double-quoted string is a literal character, not a comment
  start, in every `#`-comment format above — don't let the lexer treat quotes
  and comments as independent rules.
- GUIDs appear in two interchangeable literal forms almost everywhere:
  registry format (`8-4-4-4-12` hex) and C-array format
  (`{0xHHHHHHHH,0xHHHH,0xHHHH,{0xHH,...×8}}`). Both need to parse to a `guid`
  node type consistently across formats.
- Macro expansion (`DEFINE X = ...` / `$(X)`) exists in `.dec`, `.dsc`,
  `.fdf`, `.inf` but with different scoping rules per format (see each
  agent-research summary / the spec's own macro-scoping section) — don't
  assume one grammar's macro rule transfers unchanged to another.
- `.dsc`'s `[Components]` section and `.fdf`'s `[FV]`/`[Rule]` sections are
  the structurally hardest parts of this whole project — nested nested
  brace blocks (`{ <LibraryClasses> ... <PcdsFixedAtBuild> ... }` /
  `FILE type guid { SECTION ... }`) with order-dependent sub-tags. Budget
  extra corpus coverage here.
- `.uni` has no block comments — don't add a `/* */` rule to that grammar
  just because neighboring formats have something similar.
- `.vfr` expression grammar (`suppressif`/`grayoutif`/`disableif`/`value=`)
  is its own beast — infix operators plus many named functions
  (`ideqval`, `questionref`, `stringref`, `cond`, `map`, ...). Don't conflate
  it with the `.dsc`/`.fdf` `!if` expression grammar; they're unrelated
  despite superficial operator overlap (`AND`/`OR`/`NOT`).

## Working conventions

- One Tree-sitter grammar package per format, under `<format>/` at the repo
  root (see README's "Repository layout"). Keep them independently
  buildable/testable; factor out shared JS helpers (comment/GUID/hex-literal
  rule fragments) into a small shared module only if duplication actually
  gets painful — don't pre-build an abstraction before the second or third
  grammar shows the actual shape of the duplication.
- Prefer `tree-sitter test` (corpus files) as the source of truth over ad hoc
  manual `tree-sitter parse` runs; commit corpus fixtures alongside the
  grammar change that makes them pass.
- When a query file is added or changed, confirm it in an actual Neovim
  buffer against a real file (`scripts/nvim-highlight-check.sh <lang>
  <file>`) before calling the work done — a query that only "looks right"
  against the grammar's node-types list is not verified.
- Don't add features (e.g. VFR's full IFR opcode semantics, or PCD
  value-type checking) beyond what's needed for correct parsing/highlighting.
  This project produces a concrete syntax tree and highlight queries, not a
  reimplementation of EDK II's build tooling or the VFR compiler.

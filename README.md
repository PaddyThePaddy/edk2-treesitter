# edk2-treesitter

Tree-sitter grammars and Neovim syntax-highlighting queries for the file
formats used by [EDK II](https://github.com/tianocore/edk2) (TianoCore),
the reference implementation of UEFI firmware:

**This repo is written by [CLAUDE.ai](https://claude.ai)**

| Extension | Format | Purpose |
|---|---|---|
| `.dec` | Package Declaration | declares GUIDs/PPIs/protocols/PCDs/library classes owned by a package |
| `.dsc` | Platform Description | defines what gets built for a platform (components, PCD values, libraries, build options) |
| `.fdf` | Flash Description | describes the layout of the flash image (FD/FV/Capsule/Rule/OptionRom sections) |
| `.inf` | Module Information | describes a single buildable module (sources, dependencies, PCDs) |
| `.uni` | Unicode string / localization | `STR_ID` → per-language string tables consumed by HII |
| `.vfr` | Visual Forms Representation | C-like source compiled into IFR opcodes for UEFI setup forms |

None of these are covered by upstream `nvim-treesitter`, so today they get no
syntax highlighting in Neovim (or at best a generic INI/C fallback). This
project provides one Tree-sitter grammar per format plus `highlights.scm`
(and other query files as needed) so Neovim can parse and highlight them
properly.

## Status

Early stage. `references/` (see below) is populated; the grammars themselves
are being built one format at a time, test-corpus-first — see
[CLAUDE.md](CLAUDE.md) for the working plan and current focus. Do not expect
a working parser for every format yet; check each `<format>/` directory for
its own state.

## Repository layout

```
edk2-treesitter/
├── references/          # git submodules: upstream tianocore-docs spec repos (read-only)
├── corpus/              # git submodule: real-world edk2 source tree, used as test fixtures
├── dec/                 # tree-sitter-edk2-dec
├── dsc/                 # tree-sitter-edk2-dsc
├── fdf/                 # tree-sitter-edk2-fdf
├── inf/                 # tree-sitter-edk2-inf
├── uni/                 # tree-sitter-edk2-uni
├── vfr/                 # tree-sitter-edk2-vfr
└── <format>/
    ├── grammar.js       # the Tree-sitter grammar definition
    ├── package.json     # tree-sitter-cli dev dependency + grammar metadata
    ├── src/             # generated parser.c / parser output (checked in, like other TS grammars)
    ├── queries/
    │   ├── highlights.scm
    │   ├── locals.scm       # only where scoping actually matters (macros, etc.)
    │   └── injections.scm   # only where relevant (e.g. embedded C typedefs in .vfr)
    └── test/corpus/*.txt    # tree-sitter's native corpus test format
```

Each `<format>/` directory is a self-contained Tree-sitter grammar package
and can be built/tested independently.

`references/` holds the normative specs, pulled in as git submodules from
`tianocore-docs`:

- `edk2-DecSpecification`, `edk2-DscSpecification`, `edk2-FdfSpecification`,
  `edk2-InfSpecification`, `edk2-UniSpecification`, `edk2-VfrSpecification`
- `edk2-MetaDataExpressionSyntaxSpecification` — the shared `!if`/`!elseif`
  expression grammar used by `.dsc` and `.fdf` (and referenced, but not
  usable, from `.dec`/`.inf`, which forbid preprocessor directives entirely)
- `edk2-BuildSpecification` — overall build-process context tying the other
  formats together

## Build requirements

- [Node.js](https://nodejs.org/) (npm) — grammars are authored in the
  Tree-sitter JS DSL (`grammar.js`)
- [`tree-sitter` CLI](https://github.com/tree-sitter/tree-sitter/tree/master/cli)
  — install per-project via `npm install` (it's a `devDependency` in each
  `<format>/package.json`) or globally with `npm install -g tree-sitter-cli`
- A C compiler — the CLI shells out to it to compile the generated
  `parser.c` into a native shared library:
  - Linux/macOS: `gcc` or `clang` (produces `.so` / `.dylib`)
  - Windows: either MSVC Build Tools (`cl.exe` — run from a "Developer
    PowerShell for VS" so it's on `PATH`) or a MinGW-w64/clang toolchain
    (produces `.dll`)
- Neovim ≥ 0.9 (0.10+ recommended) to actually consume the built parsers

Check your toolchain:

```sh
node --version
npx tree-sitter --version   # or: tree-sitter --version, if installed globally
cc --version                # Windows: cl, or gcc/clang if using MinGW
```

> **Windows note:** the commands throughout this README use bash syntax
> (`mkdir -p`, `cp`, `~`-relative paths). They work as-is under Git Bash or
> WSL. In native PowerShell/cmd, translate `~/.local/share/nvim/...` to
> Neovim's actual data directory (`:echo stdpath('data')`, typically
> `%LOCALAPPDATA%\nvim-data`), use `New-Item -ItemType Directory -Force` /
> `Copy-Item` instead of `mkdir -p`/`cp`, and build with a `.dll` output
> extension instead of `.so`. See the Windows callout under "Configuring
> Neovim" below.

## Building a grammar

From inside a format directory (e.g. `dec/`):

```sh
cd dec
npm install                 # pulls in tree-sitter-cli locally
npx tree-sitter generate     # grammar.js -> src/parser.c (+ node-types.json, etc.)
npx tree-sitter test         # runs test/corpus/*.txt against the generated parser
npx tree-sitter build --output ~/.local/share/nvim/site/parser/dec.so
```

`tree-sitter build` produces a native shared library. Point `--output` wherever
Neovim will look for it (see below) — or omit `--output` to just build
`./<name>.so` locally for testing with `tree-sitter parse`/`tree-sitter
highlight`.

To build every grammar at once, run the same three commands in each of
`dec/ dsc/ fdf/ inf/ uni/ vfr/` (a `scripts/build-all.sh` helper may be added
once the grammars stabilize).

To sanity-check a grammar against a real file without Neovim:

```sh
npx tree-sitter parse path/to/SomePackage.dec
npx tree-sitter highlight path/to/SomePackage.dec   # exercises queries/highlights.scm
```

## Helper scripts

Two scripts under `scripts/` automate the checks above across every real
fixture, and reproduce the "actually validate in Neovim" step without
touching your real Neovim config. Both take a grammar directory name
(`dec`, `dsc`, `fdf`, `inf`, `uni`, `vfr`) as their first argument.

```sh
# Parse every real *.dec (or *.<ext>) file under corpus/edk2 and report
# how many produce parser ERROR nodes. Exits non-zero if any do.
scripts/corpus-sweep.sh dec
scripts/corpus-sweep.sh inf inf   # pass an explicit extension if it differs from the dir name

# Build the parser, wire it plus queries/*.scm into an isolated Neovim
# runtime (via a scratch `runtimepath`, not your real config), open a real
# file, and report ERROR/MISSING nodes plus the resolved highlight capture
# for every non-blank line. Exits non-zero if the parse has problems.
scripts/nvim-highlight-check.sh dec corpus/edk2/MdePkg/MdePkg.dec
scripts/nvim-highlight-check.sh dec corpus/edk2/MdePkg/MdePkg.dec 50   # optional: cap lines shown
```

`nvim-highlight-check.sh` needs `nvim` on `PATH`; both need `node`/`npm`
(they run `npm install` in the grammar directory on first use if
`node_modules` isn't already there).

## Configuring Neovim to use these parsers

These formats are not in Neovim's or nvim-treesitter's built-in parser list,
so they're consumed as "local/custom" parsers. Two ways to wire them up:

### Option A — built-in `vim.treesitter`, no plugin required

1. Register the filetypes (Neovim doesn't know `.dec`/`.dsc`/`.fdf`/`.uni`/
   `.vfr` by default; `.inf` may collide with Windows INI-style `.inf` files,
   so scope it if needed):

   ```lua
   vim.filetype.add({
     extension = {
       dec = "dec",
       dsc = "dsc",
       fdf = "fdf",
       inf = "inf",
       uni = "uni",
       vfr = "vfr",
     },
   })
   ```

2. Build each parser with `--output` pointing straight into Neovim's parser
   directory:

   ```sh
   npx tree-sitter build --output ~/.local/share/nvim/site/parser/dec.so
   ```

   (`stdpath('data') .. '/site/parser/'` — adjust for your `runtimepath` if
   you keep parsers elsewhere, e.g. under a plugin manager's data dir.)

3. Copy each grammar's `queries/` directory into a runtime path Neovim
   scans, under `queries/<lang>/`:

   ```sh
   mkdir -p ~/.local/share/nvim/site/queries/dec
   cp dec/queries/*.scm ~/.local/share/nvim/site/queries/dec/
   ```

4. Start highlighting on these filetypes, e.g. via an autocmd:

   ```lua
   vim.api.nvim_create_autocmd("FileType", {
     pattern = { "dec", "dsc", "fdf", "inf", "uni", "vfr" },
     callback = function() vim.treesitter.start() end,
   })
   ```

### Option B — via `nvim-treesitter` (main branch, Neovim 0.10+)

The rewritten `nvim-treesitter` (post-2024 `main` branch) documents an
["Adding custom languages"](https://github.com/nvim-treesitter/nvim-treesitter#adding-custom-languages)
mechanism for parsers outside its own registry. The registration **must**
happen inside a `User TSUpdate` autocommand, not as a bare top-level
assignment — `:TSInstall`/`:TSUpdate` only see custom entries that exist in
`nvim-treesitter`'s internal parser table *at the moment they run*, and that
table isn't necessarily populated yet when your config file is first
sourced. Skipping the autocommand is the single most common cause of
`[nvim-treesitter] warning: skipping unsupported language: dec`.

**Local checkout** (e.g. you've cloned this repo yourself):

```lua
vim.api.nvim_create_autocmd("User", {
  pattern = "TSUpdate",
  callback = function()
    require("nvim-treesitter.parsers").dec = {
      install_info = {
        path = "/path/to/edk2-treesitter/dec", -- local checkout path
        queries = "queries", -- symlinks dec/queries/*.scm in, no manual copy needed
      },
    }
  end,
})
```

**Directly from GitHub** (no local clone needed, once this repo is pushed):

```lua
vim.api.nvim_create_autocmd("User", {
  pattern = "TSUpdate",
  callback = function()
    require("nvim-treesitter.parsers").dec = {
      install_info = {
        url = "https://github.com/<owner>/edk2-treesitter",
        location = "dec", -- this is a monorepo: the grammar lives in a subdirectory
        revision = "<commit-sha-or-tag>", -- omit to float to the default branch's HEAD
        queries = "dec/queries", -- NOT "queries" -- see note below
      },
    }
  end,
})
```

This downloads a GitHub source tarball and compiles it with your local C
compiler — no Node.js/`tree-sitter-cli` needed on the consuming end, since
`src/parser.c` is committed. Pin `revision` to a tag or commit for
reproducibility; omitting it re-resolves to the tip of the default branch
(`main`) on every `:TSUpdate`, which can silently change under you.

> **Monorepo gotcha:** for a `path`-based local install, `path` already
> points straight at the `dec/` subdirectory, so `queries = "queries"` is
> correct. For a `url`-based remote install, `nvim-treesitter` downloads the
> *whole* repo and only applies `location` when finding `src/parser.c` to
> compile — it does **not** apply `location` when resolving `queries`. So
> `queries` must repeat the subdirectory prefix (`"dec/queries"`, not
> `"queries"`) or the install silently succeeds with a working parser and no
> highlighting at all, with nothing obviously wrong in the messages.

Repeat the `require(...).{lang} = {...}` assignment inside the same
callback for each format you want (`dsc`, `fdf`, `inf`, `uni`, `vfr`,
adjusting `location`/`queries` accordingly), then run `:TSInstall dec`
(once per format). Since the parser name already matches the filetype for
every one of these formats, you don't need
`vim.treesitter.language.register()` — only add that if you ever install a
parser under a different name than its filetype (and don't rename a
format's language key at all — `tree-sitter generate` bakes the grammar's
`name` from `grammar.js` into the compiled parser as a C symbol, e.g.
`tree_sitter_dec`, so registering it under any other key, like `edk2dec`,
leaves the install step reporting success while highlighting silently fails
later at load time).

`:checkhealth nvim-treesitter` (if installed) or
`:lua print(vim.inspect(vim.treesitter.language.get_lang('dec')))` plus
`:InspectTree` are the fastest way to confirm a parser and its queries are
actually being picked up.

### Windows

Both options above work on Windows, but note three differences from the
Linux/macOS commands as written:

1. **File extension** — Neovim loads parsers as `.dll` on Windows, not
   `.so`. Build with e.g. `npx tree-sitter build --output
   path\to\parser\dec.dll` (or, under Option B, let `nvim-treesitter`'s own
   installer pick the right extension — it already handles this).
2. **Paths** — `stdpath('data')` is not `~/.local/share/nvim` on Windows;
   run `:echo stdpath('data')` in Neovim to get the real path (typically
   `%LOCALAPPDATA%\nvim-data`), and build the `parser\` / `queries\<lang>\`
   directories under that instead.
3. **Shell syntax** — `mkdir -p`, `cp`, and `~`-paths are bash-isms. They
   work unmodified in Git Bash or WSL. In native PowerShell, use
   `New-Item -ItemType Directory -Force -Path <dir>` and `Copy-Item` instead,
   and use `$env:LOCALAPPDATA` in place of `~`.

Option B (`nvim-treesitter`) is the lower-friction path on Windows, since
its installer already abstracts over the compiler and output-extension
differences — you mainly still need a working `cl.exe`/MinGW/clang on
`PATH` for it to invoke.

## Testing

Each grammar's correctness is judged against `test/corpus/*.txt`, populated
from real-world `.dec`/`.dsc`/`.fdf`/`.inf`/`.uni`/`.vfr` files (see
`corpus/`, an `edk2` submodule) rather than hand-invented snippets. Run
`npx tree-sitter test` inside a format directory, then
`scripts/corpus-sweep.sh <lang>` and `scripts/nvim-highlight-check.sh <lang>
<file>` (see "Helper scripts" above), before considering any grammar or
query change done. See [CLAUDE.md](CLAUDE.md) for the test-first workflow
this project follows.

## License

MIT (see [LICENSE](LICENSE)) for the grammars, queries, and scripts authored
in this repo. The upstream spec documents under `references/` and the
`edk2` source under `corpus/` retain their own TianoCore copyright/license
(see each submodule's `LICENSE.txt`) and are not covered by this repo's MIT
license.

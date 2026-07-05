/**
 * Tree-sitter grammar for EDK II Unicode string / localization (.uni) files.
 *
 * Reference: references/edk2-UniSpecification (tianocore-docs).
 *
 * Unlike .dec/.dsc/.fdf/.inf, .uni is *not* an INI-style format -- there are
 * no `[Section]` headers and no `key = value` statements. A .uni file is
 * just a flat sequence of `#`-led directives:
 *
 *  - `#string StrId #language lang-code "text" ["text"]*` -- one or more
 *    `#language` blocks per string, each with one-or-more consecutive
 *    quoted-string lines that concatenate (real multi-line HELP/PROMPT
 *    strings are common, e.g. MdeModulePkg.uni's PcdLoadModuleAtFixAddress
 *    HELP text).
 *  - `#langdef lang-code "Display Name"`.
 *  - `#include "Other.uni"`.
 *  - `#font font-id` / `#fontdef font-id "Font Name" size "styles"`
 *    (per spec; no real corpus example, kept minimal).
 *  - `/=<char>` remaps the default `#` control character (rare; seen as
 *    `/=#` and `/=#` with a leading space in real files).
 *
 * Comments are `//` to end of line only -- there is no block-comment form.
 * The common file-header convention (each line starting with `//`, with a
 * Doxygen-style `@file` marker and a closing line of asterisks) is just
 * repeated `//` line comments, not an actual block comment; verified
 * against real files where every line of that block starts with `//`.
 *
 * String content keeps escape sequences (`\n`, `\r`, `\"`, etc.) as their
 * own `escape_sequence` nodes, unlike the other grammars' opaque `string`
 * token -- .uni's strings are the actual translated payload the format
 * exists for, not incidental values, so highlighting escapes distinctly
 * is worth the extra grammar complexity here specifically.
 */

module.exports = grammar({
  name: "uni",

  extras: ($) => [/\s/, $.comment],

  rules: {
    source_file: ($) =>
      repeat(
        choice(
          $.string_directive,
          $.langdef_directive,
          $.include_directive,
          $.font_directive,
          $.fontdef_directive,
          $.ctrlchar_directive,
        ),
      ),

    string_directive: ($) =>
      seq("#string", field("name", $.identifier), repeat1($.language_entry)),

    language_entry: ($) =>
      seq("#language", field("code", $.language_code), repeat1($.string)),

    langdef_directive: ($) =>
      seq("#langdef", field("code", $.language_code), field("description", $.string)),

    include_directive: ($) => seq("#include", field("path", $.string)),

    font_directive: ($) => seq("#font", field("id", $.identifier)),

    fontdef_directive: ($) =>
      seq(
        "#fontdef",
        field("id", $.identifier),
        field("name", $.string),
        field("size", $.number),
        field("styles", $.string),
      ),

    // Remaps the default `#` control character, e.g. `/=#`. Rare (only
    // meaningful once, near the top of a file) but real.
    ctrlchar_directive: ($) => seq("/=", field("char", alias(token.immediate(/\S/), $.control_char))),

    // `<Letter> [{Letter}{Digit}{_ or -}]*` per spec.
    identifier: (_$) => /[A-Za-z][A-Za-z0-9_-]*/,

    // RFC4646-ish: `xx[-xxxx][-xx...]`, e.g. en-US, fr-FR, zh-Hans-CN. The
    // first segment allows a single letter (not just 2-8) for BCP47
    // private-use tags, e.g. real usage `x-UEFI-ns` (NetworkPkg/IScsiDxe).
    language_code: (_$) => /[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*/,

    number: (_$) => /[0-9]+/,

    // A single greedy token, not `'"' repeat(content) '"'`. Real
    // Shell-command help strings routinely contain literal, unescaped
    // internal quotes to show example output, e.g.
    // `"ConOutAttribInfo,"%d","%d","%d"\r\n"` (one whole string literal,
    // per the actual spec-intended reading). Tree-sitter's token regexes
    // have no lookahead, so there's no way to express "a `"` only closes
    // the string if immediately followed by end-of-line" structurally --
    // tried modeling the closing quote as ambiguous with "more content"
    // and letting GLR pick via `conflicts`, but that produced *wrong*
    // results even for a plain `"hello"` at end-of-file (it preferred
    // "more content", then needed a MISSING quote inserted to recover,
    // instead of preferring the interpretation that already parses
    // cleanly with nothing missing). A single `/"[^\r\n]*"/` token relies
    // on ordinary greedy-then-backtrack regex matching instead: greedily
    // consume to the end of the physical line, then backtrack character
    // by character until the trailing `"` in the pattern is satisfied,
    // which lands on the *last* quote on the line -- exactly the
    // boundary real files intend, with no lookahead required. The
    // trade-off: escape sequences (`\n`, `\r`, etc.) are no longer their
    // own sub-nodes, since a single token can't have children -- see
    // queries/highlights.scm for how escapes are still picked out via a
    // `#match?`-based fallback on the whole string instead.
    // The spec's documented escapes -- `\xHHHH\` (Unicode code point),
    // `\nbr`/`\narrow`/`\wide`, font-control escapes (`\f!id!`, `\fh!n!`,
    // `\fb`/`\fi`/`\fu`/`\fd`/`\fe`/`\fs`), and simple one-char escapes
    // (`\n`, `\r`, `\t`, `\"`, `\\`, `\/`, `\'`) -- don't get their own
    // grammar node (see `string`'s comment for why), but are still
    // highlighted via a `#match?` fallback in queries/highlights.scm. No
    // real corpus file uses anything beyond `\n`/`\r`.
    string: (_$) => token(/"[^\r\n]*"/),

    comment: (_$) => token(/\/\/[^\n]*/),
  },
});

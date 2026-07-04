/**
 * Tree-sitter grammar for EDK II Package Declaration (.dec) files.
 *
 * Reference: references/edk2-DecSpecification (tianocore-docs).
 * .dec files are INI-style: `[Section]` headers, `#`-comments, and a small
 * number of recurring line shapes inside every section (`name = value`,
 * `name|value|value...`, or a bare value on its own). Unlike .dsc/.fdf/.inf,
 * .dec explicitly forbids !include/!if/!ifdef preprocessor directives, so
 * none are modeled here.
 */

module.exports = grammar({
  name: "dec",

  extras: ($) => [/\s/, $.comment],

  // A trailing `{ <HeaderFiles> ... }` struct_block and a *following*
  // statement whose own name happens to be an `array` literal both start
  // with `{`; let GLR explore both and disambiguate from what follows.
  conflicts: ($) => [[$.statement]],

  rules: {
    source_file: ($) => repeat($.section),

    section: ($) => seq($.section_header, repeat($._item)),

    section_header: ($) => seq("[", $.tag, repeat(seq(",", $.tag)), "]"),

    tag: ($) => seq($.tag_segment, repeat(seq(".", $.tag_segment))),

    tag_segment: ($) => choice($.identifier, $.string),

    _item: ($) => choice($.define_statement, $.statement),

    define_statement: ($) =>
      seq(
        "DEFINE",
        field("name", $.identifier),
        "=",
        field("value", $.field),
      ),

    // A `PcdStruct` entry (a structured/dynamic PCD declaration) may be
    // followed by a `{ <HeaderFiles> ... <Packages> ... }` block naming the
    // header and .dec files that define its struct type (DEC spec 3.10).
    statement: ($) =>
      seq(
        field("name", $.field),
        optional(
          choice(
            seq("=", field("value", $.field)),
            seq(
              repeat1(seq("|", field("value", $.field))),
              optional($.struct_block),
            ),
          ),
        ),
      ),

    struct_block: ($) => seq("{", repeat($.struct_tag_section), "}"),

    struct_tag_section: ($) => seq($.struct_tag, repeat($.statement)),

    struct_tag: ($) => seq("<", $.identifier, ">"),

    field: ($) => choice($.array, $.string, $.macro_invocation, $.bare_word),

    array: ($) => seq("{", optional(seq($.field, repeat(seq(",", $.field)))), "}"),

    macro_invocation: ($) => seq("$(", field("name", $.identifier), ")"),

    identifier: (_$) => /[A-Za-z_][A-Za-z0-9_]*/,

    // Broad catch-all for paths, dotted PCD names, versions, registry-format
    // GUIDs, VOID*, TRUE/FALSE, hex/decimal numbers, etc. Deliberately a
    // single token type: an earlier attempt at a separate `number` token
    // (`0x...`/`[0-9]+`) broke on inputs like a registry-format GUID
    // (`36E48BD7-7D92-...`), because tree-sitter's lexer prefers a shorter
    // higher-precedence token over a longer lower-precedence one, not just
    // on length ties as the docs' happy path suggests — `number` would grab
    // just the leading digits and leave the rest as a second, bogus token.
    // Numeric/boolean/GUID-shaped meaning is recovered in queries via
    // `#match?` predicates instead of splitting the lexer.
    bare_word: (_$) => token(/[^\s#|=,\[\]{}$"]+/),

    string: (_$) => token(/L?"[^"\n]*"/),

    comment: (_$) => token(/#[^\n]*/),
  },
});

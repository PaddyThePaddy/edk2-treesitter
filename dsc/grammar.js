/**
 * Tree-sitter grammar for EDK II Platform Description (.dsc) files.
 *
 * Reference: references/edk2-DscSpecification and
 * references/edk2-MetaDataExpressionSyntaxSpecification (tianocore-docs).
 *
 * .dsc shares the INI-style shell and shared literal/value grammar built
 * for .inf (see that grammar's module doc for `compound_word`/`value`/
 * `pipe_field` background -- all reused here verbatim). Three things .dsc
 * needs beyond .inf:
 *
 *  - Conditional directives: `!include`, `!if`/`!elseif`/`!else`/`!endif`,
 *    `!ifdef`/`!ifndef`, `!error`. Real .dsc files let a `!if`/`!endif`
 *    pair span across section boundaries (wrapping whole `[Section]`
 *    blocks, not just statements within one), which doesn't fit a simple
 *    recursive-descent *nested* if/else/endif tree without an external
 *    scanner tracking arbitrary cross-section balance. Modeled instead as
 *    flat, independent directive nodes (siblings, not a nested pair) --
 *    enough to parse and highlight correctly, at the cost of not
 *    expressing "these statements are inside this !if" structurally. This
 *    mirrors how several real-world tree-sitter grammars treat
 *    preprocessor-like conditionals that don't nest cleanly.
 *  - An expression grammar for `!if`/`!elseif` conditions (ternary,
 *    OR/XOR/AND, bitwise, comparison, shift, add/sub, mul/div/mod, unary
 *    !/NOT/~), per the Metadata Expression Syntax spec.
 *  - `[Components]` entries: a bare INF path optionally followed by a
 *    `{ <LibraryClasses>/<PcdsFixedAtBuild>/<BuildOptions>/... }`
 *    override block. Reuses the same `struct_block`/`struct_tag_section`/
 *    `struct_tag` shape the .dec grammar uses for structured-PCD
 *    `<HeaderFiles>`/`<Packages>` blocks.
 */

module.exports = grammar({
  name: "dsc",

  extras: ($) => [/\s/, $.comment],

  // A bare Components entry (`Module.inf`) followed by `{` is ambiguous
  // with "this statement ends here, and `{` starts a new statement whose
  // own name happens to be an array literal" -- same shape as .dec's
  // PcdStruct `{ <HeaderFiles> ... }` block. There it's a false ambiguity:
  // GLR explores both and the array-literal reading always dead-ends
  // (`<LibraryClasses>` etc. isn't valid array-element syntax), leaving
  // only the block reading. Same reasoning applies here.
  conflicts: ($) => [[$.statement], [$.section], [$.struct_tag_section], [$.value]],

  rules: {
    source_file: ($) => repeat(choice($.section, $._directive)),

    section: ($) => seq($.section_header, repeat($._item)),

    // `optional(",")` tolerates a stray trailing comma before `]` --
    // real files have this typo, e.g.
    // `[LibraryClasses.common.UEFI_DRIVER, LibraryClasses.common.DXE_RUNTIME_DRIVER,]`
    // (SecurityPkg/SecurityPkg.dsc), and EDK2's own tooling accepts it.
    section_header: ($) => seq("[", $.tag, repeat(seq(",", $.tag)), optional(","), "]"),

    tag: ($) => seq($.tag_segment, repeat(seq(".", $.tag_segment))),

    tag_segment: ($) => choice($.identifier, $.string, $.macro_invocation),

    _item: ($) => choice($.define_statement, $._directive, $.statement),

    define_statement: ($) =>
      seq(
        "DEFINE",
        field("name", $.identifier),
        "=",
        field("value", $.value),
      ),

    // `Module.inf { <Tag> ... }` ([Components]); the block also shows up
    // (rarely) after a plain assignment/pipe-list statement in principle,
    // so it's attached generically rather than gated to one shape.
    statement: ($) =>
      seq(
        field("name", $.field),
        optional(
          choice(
            seq(field("operator", choice("==", "=")), field("value", $.value)),
            repeat1(seq("|", field("value", $.pipe_field))),
          ),
        ),
        optional($.struct_block),
      ),

    struct_block: ($) => seq("{", repeat(choice($.struct_tag_section, $._directive)), "}"),

    struct_tag_section: ($) => seq($.struct_tag, repeat($._item)),

    struct_tag: ($) => seq("<", $.identifier, ">"),

    // --- Conditional directives ----------------------------------------

    _directive: ($) =>
      choice(
        $.include_directive,
        $.if_directive,
        $.elseif_directive,
        $.else_directive,
        $.endif_directive,
        $.ifdef_directive,
        $.ifndef_directive,
        $.error_directive,
      ),

    include_directive: ($) => seq("!include", field("path", $.field)),

    if_directive: ($) => seq("!if", field("condition", $._expression)),

    elseif_directive: ($) => seq("!elseif", field("condition", $._expression)),

    else_directive: (_$) => "!else",

    endif_directive: (_$) => "!endif",

    ifdef_directive: ($) => seq("!ifdef", field("name", $.field)),

    ifndef_directive: ($) => seq("!ifndef", field("name", $.field)),

    error_directive: ($) => seq("!error", field("message", $.value)),

    // --- Expression grammar (edk2-MetaDataExpressionSyntaxSpecification)

    _expression: ($) =>
      choice(
        $.field,
        $.parenthesized_expression,
        $.unary_expression,
        $.binary_expression,
        $.ternary_expression,
      ),

    parenthesized_expression: ($) => seq("(", $._expression, ")"),

    unary_expression: ($) =>
      prec(11, seq(field("operator", choice("!", "NOT", "not", "~")), field("operand", $._expression))),

    binary_expression: ($) =>
      choice(
        prec.left(10, seq(field("left", $._expression), field("operator", choice("*", "/", "%")), field("right", $._expression))),
        prec.left(9, seq(field("left", $._expression), field("operator", choice("+", "-")), field("right", $._expression))),
        prec.left(8, seq(field("left", $._expression), field("operator", choice("<<", ">>")), field("right", $._expression))),
        prec.left(7, seq(field("left", $._expression), field("operator", choice("==", "!=", "EQ", "NE", "IN", "<=", ">=", "<", ">", "LE", "GE", "LT", "GT")), field("right", $._expression))),
        prec.left(6, seq(field("left", $._expression), field("operator", "&"), field("right", $._expression))),
        prec.left(5, seq(field("left", $._expression), field("operator", "^"), field("right", $._expression))),
        prec.left(4, seq(field("left", $._expression), field("operator", "|"), field("right", $._expression))),
        prec.left(3, seq(field("left", $._expression), field("operator", choice("AND", "and", "&&")), field("right", $._expression))),
        prec.left(2, seq(field("left", $._expression), field("operator", choice("XOR", "xor")), field("right", $._expression))),
        prec.left(1, seq(field("left", $._expression), field("operator", choice("OR", "or", "||")), field("right", $._expression))),
      ),

    ternary_expression: ($) =>
      prec.right(0, seq(field("condition", $._expression), "?", field("consequence", $._expression), ":", field("alternative", $._expression))),

    // --- shared literal/value grammar (see .inf grammar.js for the full
    // rationale behind this shape, especially the zero-width-token tricks
    // for `pipe_field` and `value`'s empty case) -----------------------

    field: ($) => choice($.array, $.string, $.compound_word, $.value_macro_call),

    // PCD value-constructor macros, e.g. `{GUID("$(SOME_GUID)")}` or
    // `{DEVICE_PATH("MAC(000000000000,0x1)")}` (edk2-DecSpecification
    // documents GUID()/CODE()/UINT8()/DEVICE_PATH()/LABEL()/OFFSET_OF()).
    // Structurally distinct from `array` (a braced comma-list) even though
    // both start with `{`; GLR sorts them out because parsing the call
    // name as a plain array element dead-ends at the following `(`, which
    // isn't valid there.
    value_macro_call: ($) =>
      seq("{", field("name", $.identifier), "(", optional(field("argument", $.field)), ")", "}"),

    compound_word: ($) =>
      seq(
        choice($.macro_invocation, $.bare_word),
        repeat(choice($._macro_invocation_immediate, $._bare_word_immediate)),
      ),

    // Same lesson as `value` (see below): the empty case has to be its own
    // standalone, last-priority alternative, not a nullable regex baked
    // into the same seq as the "real content" branch. An earlier version
    // used a single `_bare_word_or_empty` token with a `*` quantifier
    // (matching `pipe_field`'s array/string/value_macro_call alternatives
    // too), and tree-sitter silently preferred the empty read even when
    // e.g. a `value_macro_call` followed -- `Pcd|{GUID("...")}` parsed as
    // an empty pipe-field followed by a second, bogus statement whose name
    // was the value-macro-call, no error raised.
    pipe_field: ($) =>
      choice(
        $.array,
        $.string,
        $.value_macro_call,
        seq(
          choice($.macro_invocation, alias($._bare_word_comma_ok, $.bare_word)),
          repeat(choice($._macro_invocation_immediate, $._bare_word_immediate)),
        ),
        alias($._empty_pipe_field, $.bare_word),
      ),

    // Unlike `bare_word`, this allows a literal `,` -- PcdsDynamicHii/
    // PcdsDynamicExHii entries end with a comma-separated attribute list
    // in their own pipe-field, e.g. `...|FALSE|NV,BS`. Safe to special-case
    // here (rather than in `bare_word` generally) because `array`'s
    // elements are parsed via `field`/`bare_word`, not `pipe_field`, so
    // this doesn't reopen the ambiguity with `,` as the array separator.
    _bare_word_comma_ok: (_$) => token(/[^\s#|=()\[\]{}$"]+/),

    _empty_pipe_field: (_$) => token(prec(-1, /(?:)/)),

    array: ($) => seq("{", optional(seq($.field, repeat(seq(",", $.field)))), "}"),

    macro_invocation: ($) => seq("$(", field("name", $.identifier), ")"),

    _macro_invocation_immediate: ($) => alias($._immediate_macro_invocation_body, $.macro_invocation),

    _immediate_macro_invocation_body: ($) =>
      seq(token.immediate("$("), field("name", $.identifier), ")"),

    identifier: (_$) => /[A-Za-z_][A-Za-z0-9_]*/,

    bare_word: (_$) => token(/[^\s#|=,()\[\]{}$"]+/),

    _bare_word_immediate: ($) =>
      alias(token.immediate(/[^\s#|=,()\[\]{}$"]+/), $.bare_word),

    // A quoted string may appear as its own space-separated fragment
    // mid-value (not just immediately glued to the rest, unlike macros),
    // e.g. a [BuildOptions] flag string ending in
    // `... X11IncludeHack "-DEFIAPI=__attribute__((ms_abi))"`.
    value: ($) =>
      choice(
        $.array,
        $.string,
        seq(
          choice($.macro_invocation, $.raw_text),
          repeat(choice($._macro_invocation_immediate, $._raw_text_immediate, $.string)),
        ),
        alias($._empty_value, $.raw_text),
      ),

    raw_text: (_$) => token(/[^\s\n#{}"$][^\n#{}"$]*/),

    _empty_value: (_$) => token(prec(-1, /(?:)/)),

    _raw_text_immediate: ($) =>
      alias(token.immediate(/[^\n#{}"$]+/), $.raw_text),

    string: (_$) => token(/L?"[^"\n]*"/),

    comment: (_$) => token(/#[^\n]*/),
  },
});

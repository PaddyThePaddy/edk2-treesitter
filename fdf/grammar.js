/**
 * Tree-sitter grammar for EDK II Flash Description (.fdf) files.
 *
 * Reference: references/edk2-FdfSpecification and
 * references/edk2-MetaDataExpressionSyntaxSpecification (tianocore-docs).
 *
 * .fdf shares the INI-style shell, conditional directives, expression
 * grammar, and shared literal/value grammar built for .dsc (see that
 * grammar's module doc for the `compound_word`/`value`/`pipe_field`
 * background, including the empty-value/CRLF/`Family:`-alignment lessons
 * baked into `bare_word`/`raw_text` -- all reused here verbatim). .fdf does
 * *not* need .dsc's `[Components]` override-block machinery
 * (`struct_block`/`value_macro_call`), but it needs its own set of
 * multi-token constructs that don't fit the generic name/value/pipe-list
 * shape:
 *
 *  - `SET PcdName = Expression` -- reuses the `!if` expression grammar
 *    (real .fdf files do arithmetic on PCDs/macros here, e.g.
 *    `SET gA.PcdBase = $(MEMFD_BASE_ADDRESS) + gB.PcdWorkAreaBase - gC.PcdHeader`).
 *  - `INF [Key=Value ...] Path/To/Module.inf` ([FV] module list entries).
 *  - `APRIORI PEI|DXE { INF ... }` (dispatch-order block).
 *  - `FILE Type = Guid [Key=Value ...] { ... }` and, inside it,
 *    `SECTION Type = Value` (leaf) or `SECTION Type Guid [Key=Value ...]
 *    { ... }` (encapsulation, e.g. GUIDED/COMPRESS -- recurses).
 *  - `[Rule.*]` bodies: space-separated lines of bare words and
 *    `Key = Value` pairs, optionally ending in a bare `|.extension`, e.g.
 *    `PE32 PE32 Align=Auto $(INF_OUTPUT)/$(MODULE_NAME).efi` or
 *    `RAW BIN Align = 16 |.bin`. Modeled generically as `rule_line` rather
 *    than one rule per FFS/section-type keyword, since the shape is
 *    identical regardless of which keyword leads the line.
 *
 * Plain `Key = Value` lines elsewhere ([Defines], [FD] BaseAddress/Size/
 * region entries like `FV = FVMAIN_COMPACT`, [FV] volume attributes, a
 * bare `DATA = { ... }` array) and pipe-list region shortcuts
 * (`Offset|Size`, `PcdOffset|PcdSize`) all fall out of the generic
 * `statement` rule already, with no format-specific grammar needed.
 */

module.exports = grammar({
  name: "fdf",

  extras: ($) => [/\s/, $.comment],

  conflicts: ($) => [
    [$.section],
    [$.value],
    [$.file_statement],
    [$.file_block, $.array],
    [$.rule_line, $.array],
    [$.rule_line],
  ],

  rules: {
    // `!include`d .fdf fragment files are common and don't necessarily
    // start with a `[Section]` header of their own (e.g. a file that's
    // just `!if PCD == TRUE` / `INF Some/Module.inf` / `!endif`, spliced
    // into whatever section `!include`s it) -- so every `_item` shape is
    // valid at the top level too, not just inside a section.
    source_file: ($) => repeat(choice($.section, $._item)),

    section: ($) => seq($.section_header, repeat($._item)),

    // `optional(",")` tolerates a stray trailing comma before `]`, as seen
    // in real .dsc files; kept for the same reason here.
    section_header: ($) => seq("[", $.tag, repeat(seq(",", $.tag)), optional(","), "]"),

    tag: ($) => seq($.tag_segment, repeat(seq(".", $.tag_segment))),

    tag_segment: ($) => choice($.identifier, $.string, $.macro_invocation),

    _item: ($) =>
      choice(
        $.define_statement,
        $._directive,
        $.set_statement,
        $.apriori_block,
        $.file_statement,
        $.section_statement,
        $.inf_statement,
        $.statement,
      ),

    define_statement: ($) =>
      seq(
        "DEFINE",
        field("name", $.identifier),
        "=",
        field("value", $.value),
      ),

    // `SET PcdName = Expression` -- the value is a real expression (the
    // same grammar `!if`/`!elseif` use), not free text: real .fdf files do
    // arithmetic here, e.g.
    // `SET gUefiCpuPkgTokenSpaceGuid.PcdSevEsWorkAreaSize = gA.PcdSize - gB.PcdHeader`.
    set_statement: ($) =>
      seq("SET", field("name", $.field), "=", field("value", $._expression)),

    // [FV] module-list entry: `INF [Key=Value ...] Path/To/Module.inf`.
    // Options seen in real files include `FILE_GUID = $(MACRO)` (override
    // the module's own FILE_GUID) as well as the spec's RuleOverride/USE/
    // VERSION/UI.
    inf_statement: ($) =>
      seq("INF", repeat($.key_value_pair), field("path", $.field)),

    // `APRIORI PEI { INF ... }` / `APRIORI DXE { INF ... }`.
    apriori_block: ($) =>
      seq("APRIORI", field("phase", $.identifier), "{", repeat(choice($.inf_statement, $._directive)), "}"),

    // `FILE Type = Guid [Key=Value ...] { ... }`, used both directly in
    // [FV] sections and as the sole top-level construct in [Rule.*]
    // sections (there, Guid is almost always `$(NAMED_GUID)`).
    file_statement: ($) =>
      seq(
        "FILE",
        field("type", $.field),
        "=",
        field("guid", $.field),
        repeat(choice($.key_value_pair, $.field)),
        optional($.file_block),
      ),

    // Shared body shape for a FILE's `{ ... }` block: [FV]-context FILE
    // blocks contain SECTION statements; [Rule]-context FILE blocks
    // contain bare `rule_line`s (e.g. `PE32 PE32 $(INF_OUTPUT)/...`).
    // Accepted generically rather than gated by context, consistent with
    // how the rest of this grammar stays permissive about *which* section
    // a construct appears under.
    file_block: ($) => seq("{", repeat(choice($.section_statement, $.rule_line, $.inf_statement, $._directive)), "}"),

    // Leaf form (`SECTION PE32 = path`) vs encapsulation form
    // (`SECTION GUIDED guid PROCESSING_REQUIRED = TRUE { ... }`, or
    // `SECTION COMPRESS { ... }` with no guid at all) -- both start with
    // `SECTION type`, disambiguated by whether `=` or `{`/more
    // options/guid follows.
    section_statement: ($) =>
      choice(
        seq("SECTION", field("type", $.field), "=", field("value", $.value)),
        seq("SECTION", field("type", $.field), repeat(choice($.key_value_pair, $.field)), $.file_block),
      ),

    // A [Rule.*] body line: one or more space-separated bare
    // words/Key=Value pairs (section-type keyword, FFS-type keyword,
    // Align=Auto, Optional, BUILD_NUM=$(BUILD_NUMBER), a path, ...),
    // optionally ending in a bare `|.extension` shorthand (e.g. `|.bin`)
    // when the rule has no explicit source file. Modeled generically
    // rather than as one rule per leading keyword since the shape doesn't
    // depend on which keyword leads.
    //
    // Known imprecision: since there's no per-physical-line boundary
    // (newlines are ordinary skippable `extras`, same as every other rule
    // in this grammar), two consecutive real-content rule lines with
    // nothing but whitespace between them (the common case -- most Rule
    // bodies are just line after line of `PE32 ...`/`UI ...`/`VERSION
    // ...`) parse as *one* `rule_line` spanning both, rather than two
    // sibling `rule_line`s. This doesn't lose or misidentify any content
    // -- every field/key_value_pair underneath is still individually
    // correct -- so it doesn't affect highlighting, only the tree's
    // grouping fidelity. A directive (`!if`, etc.) *does* correctly break
    // the chain, since its literal keyword token wins over generic
    // `bare_word` continuation.
    // The trailing `optional(choice(...))` covers two mutually-exclusive
    // endings: a leaf line's `|.extension` shorthand, or -- in [Rule.*]
    // bodies specifically -- an *implicit* encapsulation section with the
    // leading `SECTION` keyword omitted, e.g. `COMPRESS PI_STD { GUIDED {
    // PE32 ... } }` (equivalent to `SECTION COMPRESS PI_STD { SECTION
    // GUIDED { ... } }`, just without the keyword, and only legal here).
    rule_line: ($) =>
      seq(
        repeat1(choice($.key_value_pair, $.field)),
        optional(choice(seq("|", field("value", $.field)), $.file_block)),
      ),

    // The key is `$.field` (not `$.identifier`) on purpose: `identifier`
    // is a *separate* token type that overlaps almost entirely with
    // `bare_word` (both match plain words like `PE32`), and offering both
    // as competing token types at the same position -- one for
    // `key_value_pair`'s key, one for a plain rule-line `field` -- is a
    // genuine lexer-level tie that tree-sitter resolved *before* looking
    // ahead for the `=` that would actually disambiguate them, producing
    // hard parse errors on ordinary lines like
    // `PE32 PE32 $(INF_OUTPUT)/$(MODULE_NAME).efi`. Reusing the same
    // `field` production for both turns it into a normal shared-prefix,
    // one-token-lookahead decision instead (reduce to a plain field vs.
    // shift into `= value`), which tree-sitter resolves correctly.
    key_value_pair: ($) => seq(field("key", $.field), "=", field("value", $.field)),

    statement: ($) =>
      seq(
        field("name", $.field),
        optional(
          choice(
            seq(field("operator", choice("==", "=")), field("value", $.value)),
            repeat1(seq("|", field("value", $.pipe_field))),
          ),
        ),
      ),

    // --- Conditional directives (identical to .dsc) --------------------

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

    // --- Expression grammar (identical to .dsc) ------------------------

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

    // --- shared literal/value grammar (identical to .dsc; see that
    // grammar's comments for the empty-value/CRLF/immediate-token
    // rationale) ---------------------------------------------------------

    field: ($) => choice($.array, $.string, $.compound_word),

    compound_word: ($) =>
      seq(
        choice($.macro_invocation, $.bare_word),
        repeat(choice($._macro_invocation_immediate, $._bare_word_immediate)),
      ),

    pipe_field: ($) =>
      choice(
        $.array,
        $.string,
        seq(
          choice($.macro_invocation, alias($._bare_word_comma_ok, $.bare_word)),
          repeat(choice($._macro_invocation_immediate, $._bare_word_immediate)),
        ),
        alias($._empty_pipe_field, $.bare_word),
      ),

    _bare_word_comma_ok: (_$) => token(/[^\s#|=()\[\]{}$"]+/),

    _empty_pipe_field: (_$) => token(prec(-1, /(?:)/)),

    // Real `DATA = { ... }` blocks (a hex byte array) can have `!if`/
    // `!endif` interspersed among the comma-separated elements to
    // conditionally include some bytes, e.g.
    // `0x00, 0x00, !if $(X) == 2 <bytes> !endif 0x00, ...`. `repeat(choice(...))`
    // (rather than strict `field (',' field)*`) accepts a directive
    // anywhere in the list without needing its own adjacent comma, unlike
    // .dec/.inf/.dsc's plain `array` (which don't need this -- interspersed
    // directives inside an array are an .fdf-only real pattern).
    array: ($) => seq("{", repeat(choice($.field, $._directive, ",")), "}"),

    macro_invocation: ($) => seq("$(", field("name", $.identifier), ")"),

    _macro_invocation_immediate: ($) => alias($._immediate_macro_invocation_body, $.macro_invocation),

    _immediate_macro_invocation_body: ($) =>
      seq(token.immediate("$("), field("name", $.identifier), ")"),

    identifier: (_$) => /[A-Za-z_][A-Za-z0-9_]*/,

    // `(:[ \t]*...)` tolerates whitespace after a `Family:` prefix used
    // purely for visual column-alignment, e.g. `GCC:   *_*_IA32_PP_FLAGS`.
    bare_word: (_$) => token(/[^\s#:|=,()\[\]{}$"]+(:[ \t]*[^\s#|=,()\[\]{}$"]+)?/),

    _bare_word_immediate: ($) =>
      alias(token.immediate(/[^\s#|=,()\[\]{}$"]+/), $.bare_word),

    value: ($) =>
      choice(
        seq(
          optional($._immediate_hspace),
          choice($._array_immediate, $._string_immediate, $._macro_invocation_immediate, $._raw_text_immediate),
          repeat(choice($._macro_invocation_immediate, $._raw_text_immediate, $.string)),
        ),
        alias($._empty_value, $.raw_text),
      ),

    _immediate_hspace: (_$) => token.immediate(/[ \t]+/),

    _array_immediate: ($) => alias($._immediate_array_body, $.array),

    _immediate_array_body: ($) =>
      seq(token.immediate("{"), repeat(choice($.field, $._directive, ",")), "}"),

    _string_immediate: ($) => alias(token.immediate(/L?"[^"\n]*"/), $.string),

    raw_text: (_$) => token(/[^\s\n#{}"$][^\n\r#{}"$]*/),

    _empty_value: (_$) => token(prec(-1, /(?:)/)),

    _raw_text_immediate: ($) =>
      alias(token.immediate(/[^\r\n#{}"$]+/), $.raw_text),

    string: (_$) => token(/L?"[^"\n]*"/),

    comment: (_$) => token(/#[^\n]*/),
  },
});

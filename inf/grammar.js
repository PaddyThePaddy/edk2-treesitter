/**
 * Tree-sitter grammar for EDK II Module Information (.inf) files.
 *
 * Reference: references/edk2-InfSpecification (tianocore-docs).
 * .inf files share the same INI-style shell as .dec: `[Section]` headers,
 * `#`-comments, and the same recurring line shapes (`name = value`,
 * `name|value|value...`, or a bare value). Like .dec, .inf forbids
 * !include/!if/!ifdef preprocessor directives.
 *
 * Two things real .inf files need beyond the .dec grammar:
 *  - Macro references embedded mid-token with no separating whitespace,
 *    e.g. `$(FDT_LIB_PATH)/fdt.c` as a single [Sources] entry. See
 *    `compound_word`.
 *  - [BuildOptions] values are free-form, space-separated flag strings that
 *    may themselves contain embedded macros, e.g.
 *    `-U_WIN32 -U_WIN64 $(OPENSSL_FLAGS) $(OPENSSL_FLAGS_NOASM)`. Unlike
 *    `compound_word`, whitespace *inside* the value is significant (part of
 *    the flags), but the value still must not run past end-of-line/comment
 *    -- seeing `\n`/`#` there would otherwise make this ambiguous with the
 *    next statement. See `value`/`raw_text`.
 *  - [Depex] section bodies are a small infix boolean-expression language
 *    (AND/OR/NOT, parens, BEFORE/AFTER/PUSH/SOR), not the generic
 *    name/value shape. See `depex_expression`.
 */

module.exports = grammar({
  name: "inf",

  extras: ($) => [/\s/, $.comment],

  rules: {
    source_file: ($) => repeat($.section),

    section: ($) => seq($.section_header, repeat($._item)),

    section_header: ($) => seq("[", $.tag, repeat(seq(",", $.tag)), "]"),

    tag: ($) => seq($.tag_segment, repeat(seq(".", $.tag_segment))),

    tag_segment: ($) => choice($.identifier, $.string),

    _item: ($) => choice($.define_statement, $.depex_expression, $.statement),

    define_statement: ($) =>
      seq(
        "DEFINE",
        field("name", $.identifier),
        "=",
        field("value", $.value),
      ),

    statement: ($) =>
      seq(
        field("name", $.field),
        optional(
          choice(
            seq("=", field("value", $.value)),
            repeat1(seq("|", field("value", $.pipe_field))),
          ),
        ),
      ),

    // --- [Depex] expression grammar -----------------------------------
    // Modeled as its own top-level item (rather than the generic
    // statement shape) because it's an infix boolean expression, not a
    // name/value/pipe-list line. Every alternative here contains at least
    // one Depex-only keyword/paren, so it can never be confused with a
    // plain bare statement (e.g. a lone GUID name in [Guids], or a lone
    // GUID/TRUE/FALSE that *is* a complete, trivial depex) -- those still
    // just parse as `statement`.
    depex_expression: ($) =>
      seq(optional("SOR"), choice($.depex_and, $.depex_or, $.depex_not, $.depex_before, $.depex_after, $.depex_push)),

    _depex_expr: ($) => choice($.field, $.depex_and, $.depex_or, $.depex_not, $.depex_paren),

    depex_and: ($) => prec.left(2, seq($._depex_expr, "AND", $._depex_expr)),

    depex_or: ($) => prec.left(1, seq($._depex_expr, "OR", $._depex_expr)),

    depex_not: ($) => prec(3, seq("NOT", $._depex_expr)),

    depex_before: ($) => seq("BEFORE", field("name", $.field)),

    depex_after: ($) => seq("AFTER", field("name", $.field)),

    depex_push: ($) => seq("PUSH", field("name", $.field)),

    depex_paren: ($) => seq("(", $._depex_expr, ")"),

    // --- shared literal/value grammar ---------------------------------

    // A single, whitespace-free token: identifiers, paths, dotted PCD
    // names, registry-format GUIDs, VOID*, TRUE/FALSE, numbers, etc. Used
    // for statement names, pipe-list values, and array elements -- never
    // for assignment values, which use `value` instead (see module doc).
    field: ($) => choice($.array, $.string, $.compound_word),

    // `name` optionally immediately followed by more fragments with zero
    // intervening whitespace, e.g. `$(FDT_LIB_PATH)/fdt.c`.
    compound_word: ($) =>
      seq(
        choice($.macro_invocation, $.bare_word),
        repeat(choice($._macro_invocation_immediate, $._bare_word_immediate)),
      ),

    // Same as `field`, but may be empty. Real [Sources]/[Binaries]
    // pipe-list entries sometimes skip optional trailing slots while still
    // setting a later one, e.g. `foo.nasm ||||PcdFoo` (Family/TagName/
    // ToolCode empty, FeatureFlag set). This is deliberately a token that
    // can itself match zero characters (maximal munch still prefers real
    // content when it's there -- same trick tree-sitter-csv's grammar uses
    // for empty CSV fields), NOT a grammar-level `optional(field)`. The
    // latter was tried first and is a trap: tree-sitter resolves the
    // resulting shift/reduce ambiguity against "reduce, and let the next
    // bare_word start a whole new statement" *silently*, with no conflict
    // warning, by always preferring to reduce -- so it dropped real values
    // too, not just genuinely-empty ones (`RAW|GCC` parsed as two bare
    // statements instead of one two-field statement).
    pipe_field: ($) =>
      choice(
        $.array,
        $.string,
        seq(
          choice($.macro_invocation, alias($._bare_word_or_empty, $.bare_word)),
          repeat(choice($._macro_invocation_immediate, $._bare_word_immediate)),
        ),
      ),

    _bare_word_or_empty: (_$) => token(/[^\s#|=,()\[\]{}$"]*/),

    array: ($) => seq("{", optional(seq($.field, repeat(seq(",", $.field)))), "}"),

    macro_invocation: ($) => seq("$(", field("name", $.identifier), ")"),

    // `alias()` needs a single rule reference to rename -- it can't wrap a
    // multi-element `seq(...)` as one node, so the immediate variant goes
    // through this hidden intermediate rule rather than aliasing the seq
    // directly (which silently aliased each element separately instead).
    _macro_invocation_immediate: ($) => alias($._immediate_macro_invocation_body, $.macro_invocation),

    _immediate_macro_invocation_body: ($) =>
      seq(token.immediate("$("), field("name", $.identifier), ")"),

    identifier: (_$) => /[A-Za-z_][A-Za-z0-9_]*/,

    // `(:[ \t]*...)` tolerates whitespace after a `Family:` prefix used
    // purely for visual column-alignment in real [BuildOptions] sections,
    // e.g. `GCC:   *_*_IA32_PP_FLAGS` (extra spaces so it lines up with
    // `CLANGPDB:*_*_IA32_CC_FLAGS`). Without this, `:` isn't excluded from
    // the base charset, but a *greedy* match swallows straight through it
    // with nothing left to let the whitespace-tolerant continuation apply,
    // so the base charset excludes `:` and the continuation re-adds it
    // explicitly alongside its own optional leading whitespace.
    bare_word: (_$) => token(/[^\s#:|=,()\[\]{}$"]+(:[ \t]*[^\s#|=,()\[\]{}$"]+)?/),

    _bare_word_immediate: ($) =>
      alias(token.immediate(/[^\s#|=,()\[\]{}$"]+/), $.bare_word),

    // The right-hand side of `name = ...`. May contain embedded spaces
    // (e.g. [BuildOptions] flag strings) and/or macro references, but can
    // never run past end-of-line or a comment, so it's never ambiguous
    // with the next statement. May also be entirely empty -- some real
    // [BuildOptions] entries clear a flag with e.g. `XCODE:*_*_*_CC_FLAGS =`
    // and nothing after `=` (see the last alternative below).
    //
    // The "real content" side is reached through `_immediate_hspace` +
    // immediate-only alternatives on purpose, not through the normal
    // (extras-tolerant) `array`/`string`/`raw_text`/`macro_invocation`.
    // `extras` skips *any* whitespace, including newlines, so a genuinely
    // empty value would otherwise let the parser hop clean over the
    // newline and attach whatever real content comes next -- even text
    // from an unrelated following statement or directive -- instead of
    // correctly falling through to the empty alternative. Marking the
    // entry point immediate means it can only succeed if real content
    // follows on the *same* line (after optional horizontal whitespace).
    value: ($) =>
      choice(
        seq(
          optional($._immediate_hspace),
          choice($._array_immediate, $._string_immediate, $._macro_invocation_immediate, $._raw_text_immediate),
          repeat(choice($._macro_invocation_immediate, $._raw_text_immediate)),
        ),
        // A separate, disjoint zero-width alternative for values that are
        // entirely empty. This has to be its own standalone alternative
        // rather than making `raw_text` itself nullable (like
        // `pipe_field`'s `_bare_word_or_empty` does successfully):
        // `raw_text` sits in front of `repeat(_raw_text_immediate)`, i.e.
        // more of the *same* token type it would need to be nullable *of*,
        // and that combination made tree-sitter silently split ordinary
        // non-empty values into a bogus zero-width `raw_text` plus a
        // second `raw_text` for the real text, rather than one node. Being
        // its own alternative with no repeat attached, reachable only when
        // nothing else in this choice can start at all, sidesteps that.
        alias($._empty_value, $.raw_text),
      ),

    _immediate_hspace: (_$) => token.immediate(/[ \t]+/),

    _array_immediate: ($) => alias($._immediate_array_body, $.array),

    _immediate_array_body: ($) =>
      seq(token.immediate("{"), optional(seq($.field, repeat(seq(",", $.field)))), "}"),

    _string_immediate: ($) => alias(token.immediate(/L?"[^"\n]*"/), $.string),

    // Excludes `\r` as well as `\n` -- CRLF line endings are common in real
    // .inf files, and a lone `\r` isn't otherwise whitespace-excluded here
    // since (unlike the leading character) the continuation class doesn't
    // exclude `\s` wholesale (it has to allow plain spaces mid-value, e.g.
    // [BuildOptions] flag strings). Missing `\r` from the exclusion set
    // let `_raw_text_immediate` swallow a bare CR as if it were real
    // content immediately after `=`, defeating the empty-value check this
    // token exists for in the first place.
    raw_text: (_$) => token(/[^\s\n#{}"$][^\n\r#{}"$]*/),

    // A zero-width token (allowed; only *syntactic* rules can't match
    // empty in tree-sitter, and this is wrapped in `token()`).
    _empty_value: (_$) => token(prec(-1, /(?:)/)),

    _raw_text_immediate: ($) =>
      alias(token.immediate(/[^\r\n#{}"$]+/), $.raw_text),

    string: (_$) => token(/L?"[^"\n]*"/),

    comment: (_$) => token(/#[^\n]*/),
  },
});

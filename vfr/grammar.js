/**
 * Tree-sitter grammar for EDK II Visual Forms Representation (.vfr) files.
 *
 * Reference: references/edk2-VfrSpecification (tianocore-docs).
 *
 * Unlike .dec/.dsc/.fdf/.inf, .vfr is a genuine C-like language (compiled
 * by the VFR compiler, via a real C preprocessor pass, into IFR opcodes)
 * -- not an INI-style meta-data format. Its statements are semicolon-
 * terminated and whitespace-insensitive, closer in shape to a C DSL than
 * to the other five formats.
 *
 * Nearly every VFR construct (`formset`, `form`, `varstore`, `checkbox`,
 * `numeric`, `oneof`, `option`, `subtitle`, `goto`, `label`, `resetbutton`,
 * `date`, `time`, `guidop`, ...) shares one shape: a leading keyword,
 * zero-or-more comma-separated `key = value` fields (some bare, e.g.
 * `Optional`/`INTERACTIVE`-style flags), then either a terminating `;`
 * (leaf) or `;` followed by a body of nested statements and a matching
 * `end<Keyword>;` (block; e.g. `form ... endform;`, `oneof ... endoneof;`).
 * Modeled generically as `statement` rather than one rule per keyword,
 * mirroring how .fdf's `rule_line`/`key_value_pair` handles its own
 * keyword-led, comma/space-separated lines -- real VFR has far too many
 * keywords (and each's exact field set) to enumerate individually for a
 * highlighting-focused grammar. The real exception is `formset` itself:
 * its own fields are comma-terminated with *no* semicolon before the
 * first body item begins (varstore/form/...), only closing at
 * `endformset;` -- see `formset_statement`.
 *
 * `suppressif`/`grayoutif`/`disableif`/`inconsistentif`/`warningif`/
 * `nosubmitif` take a real boolean expression (not comma fields) before
 * their `;`, reusing the same expression grammar built for .dsc/.fdf's
 * `!if` conditions (AND/OR/NOT, comparisons, and VFR-specific things like
 * `ideqval`/`questionref(...)`/`STRING_TOKEN(...)`).
 *
 * Comments are both `//` (line) and C-style block comments -- unlike
 * .dec/.dsc/.fdf/.inf/.uni, .vfr genuinely supports both. Preprocessor
 * directives (`#include`, `#define` with C-style `\`-continued lines,
 * `#ifdef`/`#ifndef`/`#else`/`#endif`, `#pragma pack`) are real (VFR is
 * preprocessed by an actual C preprocessor before compilation), modeled
 * as flat directives like .dsc/.fdf's `!if`-family, for the same
 * cross-construct-scoping reason those aren't nested either.
 */

module.exports = grammar({
  name: "vfr",

  extras: ($) => [/\s/, $.comment, "\\"],

  // `define_directive`'s value is optional, so right after its bare
  // `identifier` name, GLR can't tell locally whether a following
  // `compound_word` continues `_expression` (the value) or starts an
  // unrelated top-level construct -- resolved by letting GLR try both and
  // prune the dead end.
  // `conditional_statement`'s trailing `;` after `endif` is optional
  // (form-level closes with `endif;`, question-level with a bare `endif`
  // whose `;` -- if present -- actually belongs to the *enclosing*
  // statement it's embedded in), so whether a `;` right after `endif`
  // closes the conditional itself or is left for the enclosing construct
  // is genuinely ambiguous locally; GLR resolves it by trying both and
  // keeping whichever leads to a valid parse.
  conflicts: ($) => [
    [$.statement],
    [$.statement, $.field],
    [$.define_directive],
    [$.conditional_statement],
  ],

  rules: {
    source_file: ($) =>
      repeat(choice($.formset_statement, $.typedef_definition, $._directive, $.statement, $.conditional_statement)),

    // --- formset: fields are comma-terminated with no semicolon; the
    // body (varstore/form/... statements) follows directly, closed by
    // `endformset;`. ------------------------------------------------
    formset_statement: ($) =>
      seq(
        "formset",
        // Per spec (2.4), every formset header field is `key = value`
        // (guid/title/help/classguid/class/subclass) -- never a bare
        // field. Critical: if a bare `$.field` alternative were allowed
        // here too, it would greedily consume the *body*'s first
        // statement keyword (e.g. `varstore`) as "just one more header
        // field" before backtracking could kick in, since both are
        // equally valid bare identifiers at that position.
        repeat(seq($.key_value_pair, ",")),
        repeat(choice($.statement, $.conditional_statement)),
        "endformset",
        ";",
      ),

    // A generic struct/union field-list typedef, e.g.
    // `typedef struct { UINT8 mField1; } MyIfrNVData;`. Field types/names
    // are just bare words -- not modeled member-by-member, since the
    // grammar's job here is recognizing the construct for highlighting,
    // not validating C struct syntax.
    typedef_definition: ($) =>
      seq(
        "typedef",
        choice("struct", "union"),
        optional(field("name", $.identifier)),
        "{",
        repeat($.struct_field),
        "}",
        field("alias", $.identifier),
        ";",
      ),

    struct_field: ($) =>
      seq(
        field("type", $.field),
        field("name", $.identifier),
        optional(seq("[", field("array_size", $.field), "]")),
        optional(seq(":", field("bitfield_size", $.field))),
        ";",
      ),

    // --- generic statement --------------------------------------------

    // `keyword`/`end_keyword` are `$.compound_word` (not `$.identifier`) for
    // the same lexer-tie reason as `key_value_pair.key`/`function_call.name`
    // above: right after a `formset` header, both "one more header
    // `key_value_pair`" and "start of the body's first `statement`" are
    // simultaneously viable, and a separate `identifier` token competing
    // with `compound_word` at that exact position forced the lexer to
    // commit to `identifier` (for `statement.keyword`) before the parser
    // could look ahead to see the header repeat had no `=` to offer,
    // producing hard parse errors on ordinary bodies like
    // `varstore VARIABLE_CLEANUP_DATA, varid = ...;`.
    // Header fields and nested body items are modeled as one flat,
    // unordered repeat rather than "header fields, then a `;`, then
    // nested statements" -- real bodies interleave them with no
    // consistent separator (`vfrStatementQuestionOptionList` mixes
    // semicolon-terminated `option ...;` items with comma-terminated
    // `default = ...,`/`value = ...,` items, and constructs like
    // `orderedlist` have no `;` at all between their header fields and
    // the first body item). Terminates on either a bare `;` (leaf, no
    // body) or `end_keyword ";"` (block). Every alternative starting
    // with a bare `compound_word` (`$.statement`, `$.field`,
    // `$.key_value_pair`'s key) competes at the same position -- GLR
    // explores all of them and keeps whichever leads to a clean parse,
    // covered by the `$.statement`/`$.field` conflict declarations.
    statement: ($) =>
      seq(
        field("keyword", $.compound_word),
        repeat(choice($.key_value_pair, $.conditional_statement, $.statement, $.function_call, $.field, ",")),
        choice(";", seq(field("end_keyword", $.compound_word), ";")),
      ),

    // `suppressif`/`disableif`/`grayoutif`/`inconsistentif`/`nosubmitif`/
    // `warningif` take a real boolean expression rather than comma fields
    // (spec 2.9, 2.11.6.1.1-7, 2.11.7.2-4). Two shapes exist in real files:
    // form/formset-level (`disableif expr; body* endif;`, trailing `;` on
    // both the condition and `endif`) and question-level, embedded
    // directly among an enclosing statement's comma fields (e.g. inside
    // `checkbox ... ,`), which take optional leading `prompt = ..., timeout
    // = ...,` fields and close on a bare `endif` with no trailing `;`.
    // Both trailing terminators are modeled as optional to cover both
    // shapes with one rule, consistent with this grammar's
    // highlighting-focused (not full-validation) scope.
    conditional_statement: ($) =>
      seq(
        field(
          "keyword",
          choice("suppressif", "disableif", "grayoutif", "inconsistentif", "nosubmitif", "warningif"),
        ),
        repeat(seq($.key_value_pair, ",")),
        field("condition", $._expression),
        optional(";"),
        repeat(choice($.statement, $.conditional_statement)),
        "endif",
        optional(";"),
      ),

    // The key is `$.field` (not `$.identifier`) on purpose -- see .fdf's
    // `key_value_pair` comment: `identifier` is a *separate* token type
    // that overlaps almost entirely with the plain-word half of
    // `compound_word`, and offering both as competing token types at the
    // same position is a genuine lexer-level tie tree-sitter resolves
    // *before* looking ahead for the `=` that would actually disambiguate
    // them, producing hard parse errors on ordinary lines like
    // `guid = SOME_GUID,`.
    key_value_pair: ($) => seq(field("key", $.field), "=", field("value", $._expression)),

    // --- Preprocessor (a real C preprocessor pass runs before the VFR
    // compiler proper) --------------------------------------------------

    _directive: ($) =>
      choice($.include_directive, $.define_directive, $.ifdef_directive, $.ifndef_directive, $.else_directive, $.endif_directive, $.pragma_directive),

    // Path is either a quoted string (`"NVDataStruc.h"`) or an
    // angle-bracket system path (`<Uefi/UefiMultiPhase.h>`), same as C.
    include_directive: ($) => seq("#include", field("path", choice($.field, $.system_path))),

    system_path: (_$) => token(/<[^<>\r\n]*>/),

    // Value is optional (`#define FOO` alone, a flag define, is valid C
    // and appears in headers .vfr files pull in).
    define_directive: ($) =>
      seq("#define", field("name", $.identifier), optional(field("value", $._expression))),

    ifdef_directive: ($) => seq("#ifdef", field("name", $.identifier)),

    ifndef_directive: ($) => seq("#ifndef", field("name", $.identifier)),

    else_directive: (_$) => "#else",

    endif_directive: (_$) => "#endif",

    pragma_directive: ($) => seq("#pragma", "pack", "(", optional(field("argument", $.field)), ")"),

    // --- Expression grammar (edk2-VfrSpecification 2.12) ---------------
    // Shared shape with .dsc/.fdf's `!if` grammar, plus VFR-specific
    // prefix keywords (`ideqval`/`ideqid`/`ideqvallist` are effectively
    // "emphasized ==" prefixes over an otherwise ordinary comparison) and
    // function-call syntax (`questionref(Id)`, `STRING_TOKEN(Id)`, ...).

    _expression: ($) =>
      choice(
        $.field,
        $.function_call,
        $.parenthesized_expression,
        $.unary_expression,
        $.ideqval_expression,
        $.ideqvallist_expression,
        $.map_expression,
        $.binary_expression,
        $.ternary_expression,
      ),

    parenthesized_expression: ($) => seq("(", $._expression, ")"),

    unary_expression: ($) =>
      prec(11, seq(field("operator", choice("!", "NOT", "not", "~")), field("operand", $._expression))),

    // `ideqval`/`ideqid` are prefix markers over what's otherwise a plain
    // comparison, e.g. `ideqval MyVar.Field == 0x1`.
    ideqval_expression: ($) =>
      prec(11, seq(field("operator", choice("ideqval", "ideqid")), field("operand", $._expression))),

    // `ideqvallist` is its own shape (spec 2.12.11.4.4): unlike
    // `ideqval`/`ideqid`, the right-hand side is a *space-separated list*
    // of numbers, not a single comparison operand, e.g. `ideqvallist
    // MyData.Data1 == 1 3 5 7`. Real files also pass symbolic macro names
    // instead of literal numbers (e.g. `== TPM_DEVICE_NULL
    // TPM_DEVICE_1_2`), so the list allows identifier-shaped words too.
    // `values` is a single token (a space-separated run of words/numbers),
    // not `repeat($.field)` -- the latter, being a separator-less
    // repetition of the same bare-word token used virtually everywhere
    // else in this grammar (`$.field`/`compound_word`), created unbounded
    // ambiguity: since `_expression` (and so `ideqvallist_expression`) is
    // reachable from nearly every position in the grammar, GLR had no
    // local way to decide where the values list ends, and the ambiguity
    // compounded across the rest of the document instead of staying local
    // -- real files with `ideqvallist` saw the *entire* surrounding
    // file's tree collapse into one flat top-level ERROR. A single greedy
    // token sidesteps this the same way `.uni`'s `string` token does; it's
    // safe to be this greedy because every real usage's list is followed
    // directly by `;` (never chained into `AND`/`OR` without one), so the
    // token has an unambiguous place to stop.
    ideqvallist_expression: ($) =>
      prec(11, seq("ideqvallist", field("field", $.field), "==", field("values", $.value_list))),

    value_list: (_$) => {
      const item = /[A-Za-z_][A-Za-z0-9_]*|0[xX][0-9A-Fa-f]+|[0-9]+/;
      return token(seq(item, repeat(seq(/[ \t]+/, item))));
    },

    // `name` is `$.compound_word` (not `$.identifier`) for the same
    // lexer-tie reason as `key_value_pair.key` above -- `field` (which
    // wraps `compound_word`) is also a valid `_expression` alternative, so
    // a separate `identifier` token competing at the same position let
    // tree-sitter commit to "bare field" before it could look ahead for
    // the `(` that actually distinguishes a call, e.g.
    // `STRING_TOKEN(STR_ENTRY_TITLE)` parsed as field `STRING_TOKEN`
    // followed by a stray, unattached `(STR_ENTRY_TITLE)`.
    // Arguments are usually plain expressions, but a few built-ins take
    // `key = value` arguments (e.g. `questionrefval(devicepath =
    // STRING_TOKEN(...), guid = ..., QuestionId)`, per spec 2.12.11.6.3).
    function_call: ($) =>
      seq(
        field("name", $.compound_word),
        "(",
        optional(
          seq(
            field("argument", choice($.key_value_pair, $._expression)),
            repeat(seq(",", field("argument", choice($.key_value_pair, $._expression)))),
          ),
        ),
        ")",
      ),

    binary_expression: ($) =>
      choice(
        prec.left(10, seq(field("left", $._expression), field("operator", choice("*", "/", "%")), field("right", $._expression))),
        prec.left(9, seq(field("left", $._expression), field("operator", choice("+", "-")), field("right", $._expression))),
        prec.left(8, seq(field("left", $._expression), field("operator", choice("<<", ">>")), field("right", $._expression))),
        prec.left(7, seq(field("left", $._expression), field("operator", choice("==", "!=", "EQ", "NE", "<=", ">=", "<", ">", "LE", "GE", "LT", "GT")), field("right", $._expression))),
        prec.left(6, seq(field("left", $._expression), field("operator", "&"), field("right", $._expression))),
        prec.left(5, seq(field("left", $._expression), field("operator", "^"), field("right", $._expression))),
        prec.left(4, seq(field("left", $._expression), field("operator", "|"), field("right", $._expression))),
        prec.left(3, seq(field("left", $._expression), field("operator", choice("AND", "and", "&&")), field("right", $._expression))),
        prec.left(2, seq(field("left", $._expression), field("operator", choice("XOR", "xor")), field("right", $._expression))),
        prec.left(1, seq(field("left", $._expression), field("operator", choice("OR", "or", "||")), field("right", $._expression))),
      ),

    ternary_expression: ($) =>
      prec.right(0, seq(field("condition", $._expression), "?", field("consequence", $._expression), ":", field("alternative", $._expression))),

    // `map` (spec 2.12.11.8) has its own shape unlike a plain function
    // call: a leading expression, then zero or more `key,value;` pairs
    // separated by literal `:`/`,`/`;`, e.g.
    // `map(pushthis:0,10;1,2;3,5;6,8;)`.
    map_expression: ($) =>
      seq(
        "map",
        "(",
        field("condition", $._expression),
        ":",
        repeat(seq(field("key", $._expression), ",", field("value", $._expression), ";")),
        ")",
      ),

    // --- shared literal/value grammar (same design as .dsc/.fdf, minus
    // the empty-value/pipe-list machinery those need for INI-style
    // assignments -- VFR statements are always semicolon-terminated, so
    // there's no analogous "genuinely empty value" case to guard against)

    field: ($) => choice($.array, $.string, $.date, $.time, $.compound_word),

    // The plain-word alternative allows dotted member and bracketed
    // array-index suffixes (in any combination) for qualified varstore
    // references, e.g. `VARIABLE_CLEANUP_DATA.SelectAll`,
    // `MyNameValueVar[0]`, `data.OrderedList[0]` (real usage: `varid =
    // VarStoreName.FieldName` / `VarStoreName[Index]`).
    compound_word: ($) =>
      token(
        /[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*|\[[0-9]+\])*|0[xX][0-9A-Fa-f]+|[0-9]+/,
      ),

    array: ($) => seq("{", optional(seq($.field, repeat(seq(",", $.field)))), "}"),

    // `2004/1/1` (date) and `15:33:33` (time) default-value literals.
    date: (_$) => token(/[0-9]+\/[0-9]+\/[0-9]+/),

    time: (_$) => token(/[0-9]+:[0-9]+:[0-9]+/),

    identifier: (_$) => /[A-Za-z_][A-Za-z0-9_]*/,

    string: (_$) => token(/L?"[^"\n]*"/),

    comment: (_$) => token(choice(/\/\/[^\n]*/, /\/\*[^*]*\*+([^/*][^*]*\*+)*\//)),
  },
});

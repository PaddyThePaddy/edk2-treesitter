; Comments -------------------------------------------------------------

(comment) @comment

; Generic name/value fallback (comes first -- Neovim resolves multiple
; matches on the same node as "last pattern in the file wins", so the more
; specific captures below need to come after this to take priority)

(compound_word) @variable
(identifier) @variable

; Preprocessor directives (a real C preprocessor pass runs over .vfr) -----

"#include" @keyword.directive
"#define" @keyword.directive
"#ifdef" @keyword.directive
"#ifndef" @keyword.directive
"#pragma" @keyword.directive
; `else_directive`/`endif_directive` are rules whose *entire* body is one
; literal string, so tree-sitter folds the literal into the named node
; rather than exposing it as a separately-queryable anonymous token --
; capture the named node directly instead.
(else_directive) @keyword.directive
(endif_directive) @keyword.directive
(define_directive name: (identifier) @constant)
(ifdef_directive name: (identifier) @constant)
(ifndef_directive name: (identifier) @constant)
(pragma_directive "pack" @keyword.directive)
(include_directive path: (system_path) @string)

; Top-level constructs ---------------------------------------------------

"formset" @keyword
"endformset" @keyword
"typedef" @keyword
"struct" @keyword
"union" @keyword
(typedef_definition alias: (identifier) @type)
(struct_field name: (identifier) @property)

; Generic statement (form/varstore/checkbox/numeric/oneof/option/...) ----
; Modeled as one generic rule rather than one per VFR keyword (see
; grammar.js's module doc) -- highlight the keyword/end_keyword fields
; generically as keywords.

(statement keyword: (compound_word) @keyword)
(statement end_keyword: (compound_word) @keyword)

; `statement`'s trailing "endXxx" word is only captured via the
; `end_keyword` field when GLR happens to resolve the (already-documented,
; see grammar.js) header/body ambiguity that way; otherwise it can end up
; as a plain trailing bare field (e.g. `label LABEL_START;`'s neighbor
; `endform;`, whose "endform" gets swallowed into the *enclosing*
; statement's own field list instead). Catch it either way by text shape,
; consistent with how other formats detect well-known words by pattern
; rather than by grammar position (see `.dec`'s registry-GUID/boolean
; rules, for instance).
((compound_word) @keyword
  (#match? @keyword "^end[A-Za-z]+$"))

; Conditionals (suppressif/grayoutif/disableif/inconsistentif/nosubmitif/
; warningif) -------------------------------------------------------------

"suppressif" @keyword.control.conditional
"grayoutif" @keyword.control.conditional
"disableif" @keyword.control.conditional
"inconsistentif" @keyword.control.conditional
"nosubmitif" @keyword.control.conditional
"warningif" @keyword.control.conditional
"endif" @keyword.control.conditional

; Expression grammar (spec 2.12) ------------------------------------------

"ideqval" @keyword.operator
"ideqid" @keyword.operator
"ideqvallist" @keyword.operator
(value_list) @number
(unary_expression operator: _ @operator)
(binary_expression operator: _ @operator)
"?" @operator
":" @operator
"=" @operator
"==" @operator
(function_call name: (compound_word) @function.builtin)
(map_expression "map" @function.builtin)

(key_value_pair key: (field) @property)

; Punctuation --------------------------------------------------------------

"(" @punctuation.bracket
")" @punctuation.bracket
"{" @punctuation.bracket
"}" @punctuation.bracket
"[" @punctuation.bracket
"]" @punctuation.bracket
"," @punctuation.delimiter
";" @punctuation.delimiter

; Literals -----------------------------------------------------------------

(string) @string
(date) @number
(time) @number

; Well-known literal words (most specific -- must come last so they
; override the generic `@variable` fallback above)

((compound_word) @boolean
  (#match? @boolean "^(TRUE|FALSE|True|False|true|false)$"))

((compound_word) @type.builtin
  (#match? @type.builtin "^(BOOLEAN|UINT8|UINT16|UINT32|UINT64|VOID\\*)$"))

((compound_word) @number
  (#match? @number "^(0[xX][0-9A-Fa-f]+|[0-9]+)$"))

((compound_word) @number
  (#match? @number "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"))

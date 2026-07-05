; Comments -----------------------------------------------------------------

(comment) @comment
((comment) @comment.documentation
  (#match? @comment.documentation "^##"))

; Sections -------------------------------------------------------------

(tag_segment (identifier) @keyword)
(tag_segment (string) @string)

"[" @punctuation.bracket
"]" @punctuation.bracket
"," @punctuation.delimiter
"." @punctuation.delimiter

; DEFINE macros --------------------------------------------------------

"DEFINE" @keyword
(define_statement name: (identifier) @constant)
(macro_invocation name: (identifier) @constant)
"$(" @punctuation.special
")" @punctuation.special

; Conditional directives -------------------------------------------------

"!include" @keyword.directive
"!if" @keyword.directive
"!elseif" @keyword.directive
"!ifdef" @keyword.directive
"!ifndef" @keyword.directive
"!error" @keyword.directive
; `else_directive`/`endif_directive` are rules whose *entire* body is one
; literal string, so tree-sitter folds the literal into the named node
; rather than exposing it as a separately-queryable anonymous token --
; capture the named node directly instead.
(else_directive) @keyword.directive
(endif_directive) @keyword.directive

; [Components] override blocks --------------------------------------------

(struct_tag (identifier) @keyword)
"<" @punctuation.bracket
">" @punctuation.bracket
"{" @punctuation.bracket
"}" @punctuation.bracket

; Expression grammar (!if/!elseif conditions) -----------------------------

(value_macro_call name: (identifier) @function.builtin)

(unary_expression operator: _ @operator)
(binary_expression operator: _ @operator)
"?" @operator
":" @operator

; Literals ---------------------------------------------------------------

(string) @string
"|" @punctuation.delimiter
"=" @operator
"==" @operator
(raw_text) @string

; Generic name/value fallback (overridden by the more specific rules below)

(statement name: (field) @property)
(statement value: (pipe_field) @string)
(statement value: (value) @string)
(define_statement value: (value) @string)

; Well-known literal words ------------------------------------------------

((bare_word) @boolean
  (#match? @boolean "^(TRUE|FALSE|True|False|true|false)$"))

((bare_word) @type.builtin
  (#match? @type.builtin "^(BOOLEAN|UINT8|UINT16|UINT32|UINT64|VOID\\*)$"))

((bare_word) @number
  (#match? @number "^(0[xX][0-9A-Fa-f]+|[0-9]+(\\.[0-9]+)*)$"))

((bare_word) @number
  (#match? @number "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"))

; `=`/`==` assignment values ([Defines], [BuildOptions], etc.) go through
; `raw_text`, not `bare_word` (see `value` in grammar.js), so the same
; well-known-word detection needs its own copy targeting that node type.

((raw_text) @boolean
  (#match? @boolean "^(TRUE|FALSE|True|False|true|false)$"))

((raw_text) @type.builtin
  (#match? @type.builtin "^(BOOLEAN|UINT8|UINT16|UINT32|UINT64|VOID\\*)$"))

((raw_text) @number
  (#match? @number "^(0[xX][0-9A-Fa-f]+|[0-9]+(\\.[0-9]+)*)$"))

((raw_text) @number
  (#match? @number "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"))

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

; Structured-PCD <HeaderFiles>/<Packages> blocks ------------------------

(struct_tag (identifier) @keyword)
"<" @punctuation.bracket
">" @punctuation.bracket
"{" @punctuation.bracket
"}" @punctuation.bracket

; Literals ---------------------------------------------------------------

(string) @string
"|" @punctuation.delimiter
"=" @operator

; Generic name/value fallback (overridden by the more specific rules below)

(statement name: (field (bare_word) @property))
(statement value: (field (bare_word) @string))

; Well-known literal words ------------------------------------------------

((bare_word) @boolean
  (#match? @boolean "^(TRUE|FALSE|True|False|true|false)$"))

((bare_word) @type.builtin
  (#match? @type.builtin "^(BOOLEAN|UINT8|UINT16|UINT32|UINT64|VOID\\*)$"))

((bare_word) @number
  (#match? @number "^(0[xX][0-9A-Fa-f]+|[0-9]+(\\.[0-9]+)*)$"))

((bare_word) @number
  (#match? @number "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"))

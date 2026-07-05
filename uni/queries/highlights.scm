; Comments -----------------------------------------------------------------

(comment) @comment

; Directives ---------------------------------------------------------------

"#string" @keyword.directive
"#language" @keyword.directive
"#langdef" @keyword.directive
"#include" @keyword.directive
"#font" @keyword.directive
"#fontdef" @keyword.directive
"/=" @punctuation.special
(control_char) @character

(string_directive name: (identifier) @constant)
(language_entry code: (language_code) @constant.builtin)
(langdef_directive code: (language_code) @constant.builtin)
(langdef_directive description: (string) @string)
(font_directive id: (identifier) @constant)
(fontdef_directive
  id: (identifier) @constant
  name: (string) @string
  size: (number) @number
  styles: (string) @string)

; Literals -------------------------------------------------------------

; `string` is a single atomic token (see grammar.js), so escape sequences
; like `\n`/`\r` inside it aren't separately highlightable sub-nodes --
; the whole literal (including any escapes) is just @string.
(string) @string
(number) @number

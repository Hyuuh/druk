["break" "case" "const" "continue" "do" "else" "enum" "for" "if" "return" "static" "struct" "switch" "while"] @keyword
[(true) (false)] @boolean
(comment) @comment
[(string_literal) (char_literal) (string_content)] @string
(escape_sequence) @escape
(null) @constant.builtin
[(type_identifier) (primitive_type)] @type
(field_identifier) @property
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

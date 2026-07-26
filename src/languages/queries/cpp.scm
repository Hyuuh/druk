["and" "break" "case" "catch" "class" "const" "continue" "delete" "do" "else" "enum" "for" "if" "namespace" "new" "not" "or" "override" "private" "protected" "public" "return" "static" "struct" "switch" "throw" "try" "while"] @keyword
[(true) (false)] @boolean
(comment) @comment
[(string_literal) (raw_string_literal) (char_literal) (string_content)] @string
(escape_sequence) @escape
(null) @constant.builtin
[(type_identifier) (primitive_type)] @type
(field_identifier) @property
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

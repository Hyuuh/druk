["break" "case" "const" "continue" "defer" "else" "for" "func" "go" "if" "import" "interface" "package" "range" "return" "select" "struct" "switch" "type" "var"] @keyword
[(true) (false)] @boolean
(comment) @comment
[(interpreted_string_literal) (raw_string_literal)] @string
(escape_sequence) @escape
[(int_literal) (float_literal) (imaginary_literal)] @number
[(nil) (iota)] @constant.builtin
(type_identifier) @type
(field_identifier) @property
(label_name) @label
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

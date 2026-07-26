["as" "async" "await" "break" "case" "class" "continue" "do" "enum" "for" "func" "if" "import" "in" "init" "is" "let" "override" "private" "public" "return" "self" "static" "struct" "super" "switch" "try" "var" "while" "yield"] @keyword
["true" "false"] @boolean
(comment) @comment
(raw_string_literal) @string
[(integer_literal) (real_literal)] @number
"nil" @constant.builtin
(type_identifier) @type
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

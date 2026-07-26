["as" "break" "catch" "class" "companion" "continue" "data" "do" "else" "enum" "finally" "for" "fun" "if" "import" "in" "init" "interface" "is" "object" "override" "package" "private" "protected" "public" "return" "sealed" "super" "suspend" "this" "throw" "try" "val" "var" "when" "where" "while"] @keyword
["true" "false"] @boolean
(line_comment) @comment
[(string_literal) (character_literal) (string_content)] @string
[(integer_literal) (real_literal)] @number
"null" @constant.builtin
(type_identifier) @type
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

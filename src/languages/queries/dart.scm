["as" "async" "await" "case" "catch" "class" "continue" "do" "else" "enum" "export" "extends" "finally" "for" "if" "implements" "import" "in" "interface" "is" "new" "return" "sealed" "static" "super" "switch" "this" "throw" "try" "type" "var" "when" "while" "with" "yield"] @keyword
[(true) (false)] @boolean
(comment) @comment
(string_literal) @string
(escape_sequence) @escape
(decimal_integer_literal) @number
["null" (null_literal)] @constant.builtin
(type_identifier) @type
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

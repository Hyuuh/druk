["assert" "break" "case" "catch" "class" "continue" "do" "else" "enum" "extends" "finally" "for" "if" "implements" "import" "interface" "module" "new" "package" "private" "protected" "public" "return" "sealed" "static" "switch" "throw" "try" "when" "while" "with" "yield"] @keyword
[(true) (false)] @boolean
[(line_comment) (block_comment)] @comment
[(string_literal) (character_literal)] @string
(escape_sequence) @escape
["float" (decimal_integer_literal)] @number
(null_literal) @constant.builtin
(type_identifier) @type
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

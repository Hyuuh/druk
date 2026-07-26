["and" "as" "break" "case" "catch" "class" "const" "continue" "do" "echo" "else" "enum" "extends" "finally" "fn" "for" "from" "function" "global" "if" "implements" "interface" "match" "namespace" "new" "or" "print" "private" "protected" "public" "require" "return" "self" "static" "switch" "throw" "trait" "try" "use" "while" "yield"] @keyword
["true" "false"] @boolean
(comment) @comment
[(string) (heredoc_body) (string_content)] @string
(escape_sequence) @escape
[(integer) (float)] @number
(null) @constant.builtin
(primitive_type) @type
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

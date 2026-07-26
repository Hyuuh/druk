["and" "as" "async" "await" "break" "case" "catch" "class" "const" "continue" "do" "elif" "else" "enum" "finally" "for" "from" "global" "if" "in" "init" "interface" "is" "let" "module" "namespace" "new" "not" "or" "override" "private" "protected" "public" "ref" "return" "sealed" "select" "static" "struct" "switch" "this" "throw" "try" "type" "unsafe" "var" "when" "where" "while" "with" "yield"] @keyword
["true" "false"] @boolean
(comment) @comment
[(string_literal) (character_literal)] @string
(escape_sequence) @escape
[(integer_literal) (real_literal)] @number
(null_literal) @constant.builtin
(predefined_type) @type
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

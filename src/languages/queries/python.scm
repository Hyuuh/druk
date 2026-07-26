["and" "as" "assert" "async" "await" "break" "case" "class" "continue" "def" "elif" "else" "finally" "for" "from" "global" "if" "import" "in" "is" "lambda" "match" "nonlocal" "not" "or" "pass" "print" "raise" "return" "try" "type" "while" "with" "yield"] @keyword
[(true) (false)] @boolean
(comment) @comment
[(string) (string_content)] @string
(escape_sequence) @escape
[(integer) (float)] @number
(none) @constant.builtin
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

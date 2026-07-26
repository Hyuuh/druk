["and" "begin" "break" "case" "class" "def" "do" "else" "end" "ensure" "for" "if" "in" "module" "not" "or" "rescue" "return" "then" "unless" "until" "when" "while" "yield"] @keyword
[(true) (false)] @boolean
(comment) @comment
[(string) (heredoc_body) (string_content)] @string
(escape_sequence) @escape
[(integer) (float)] @number
(nil) @constant.builtin
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

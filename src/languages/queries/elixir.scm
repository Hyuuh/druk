["and" "catch" "do" "else" "end" "fn" "in" "not" "or" "rescue" "when"] @keyword
["true" "false"] @boolean
(comment) @comment
(string) @string
(escape_sequence) @escape
[(integer) (float)] @number
(nil) @constant.builtin
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

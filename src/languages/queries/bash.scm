["case" "do" "elif" "else" "export" "for" "function" "if" "in" "select" "then" "until" "while"] @keyword
(comment) @comment
[(string) (heredoc_body) (string_content)] @string
(number) @number
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":"] @punctuation.delimiter

; Generic rules first; more specific rules later win (latest capture takes the char).
(string) @string
(escape_sequence) @escape
(number) @number
[(true) (false)] @boolean
(null) @constant.builtin
(comment) @comment
["," ":"] @punctuation.delimiter
["{" "}" "[" "]"] @punctuation.bracket
(ERROR) @error

; Object keys override the generic string rule above.
(pair key: (string) @property)

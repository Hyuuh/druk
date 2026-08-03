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

; Everything outside `<?php … ?>` is one `text` token. Injections go one level
; deep, so the markup is painted but a `<script>` block inside it is not — see
; `resolveInjections` in ../highlight.ts.
(text) @injection.html

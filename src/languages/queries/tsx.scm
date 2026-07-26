["as" "async" "await" "break" "case" "catch" "class" "const" "continue" "delete" "do" "else" "enum" "export" "extends" "finally" "for" "from" "function" "global" "if" "implements" "import" "in" "interface" "is" "let" "module" "namespace" "new" "object" "override" "private" "protected" "public" "require" "return" "static" "switch" "throw" "try" "type" "var" "while" "with" "yield"] @keyword
[(true) (false)] @boolean
(comment) @comment
(string) @string
(escape_sequence) @escape
(number) @number
[(null) (undefined)] @constant.builtin
[(type_identifier) (predefined_type)] @type
(property_identifier) @property
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

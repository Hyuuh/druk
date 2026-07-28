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

; JSX. Without these every tag and attribute renders as plain text, which is most
; of what a component file looks like.
(jsx_opening_element name: (identifier) @tag)
(jsx_closing_element name: (identifier) @tag)
(jsx_self_closing_element name: (identifier) @tag)
(jsx_opening_element name: (member_expression) @tag)
(jsx_closing_element name: (member_expression) @tag)
(jsx_self_closing_element name: (member_expression) @tag)
(jsx_attribute (property_identifier) @attribute)
["<" ">" "</" "/>"] @punctuation.bracket

; Calls, which are as common as tags and were plain too.
(call_expression function: (identifier) @function)
(call_expression function: (member_expression property: (property_identifier) @function))

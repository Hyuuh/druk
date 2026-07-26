["as" "async" "await" "break" "const" "continue" "dyn" "else" "enum" "fn" "for" "if" "impl" "in" "let" "loop" "match" "mod" "move" "pub" "ref" "return" "static" "struct" "trait" "type" "unsafe" "use" "where" "while" "yield"] @keyword
["true" "false"] @boolean
[(line_comment) (block_comment)] @comment
[(string_literal) (raw_string_literal) (char_literal)] @string
(escape_sequence) @escape
[(float_literal) (integer_literal)] @number
[(type_identifier) (primitive_type)] @type
[(field_identifier) (shorthand_field_identifier)] @property
(loop_label) @label
["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

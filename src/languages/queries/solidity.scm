; Identifiers first — equal-specificity captures later in the query win when
; druk paints overlaps, so definitions and calls must come after.
; Node names match tree-sitter-wasms' solidity grammar (event_paramater is theirs).

(identifier) @variable
(yul_identifier) @variable

(pragma_directive) @tag
(solidity_version_comparison_operator _ @tag)

[
  (string)
  (hex_string_literal)
  (unicode_string_literal)
  (yul_string_literal)
] @string

[
  (number_literal)
  (yul_decimal_number)
  (yul_hex_number)
] @number

(boolean_literal) @boolean
[
  (true)
  (false)
] @boolean

(comment) @comment

(type_name) @type
(primitive_type) @type
(user_defined_type (identifier) @type)
(payable_conversion_expression "payable" @type)

(struct_declaration name: (identifier) @type)
(enum_declaration name: (identifier) @type)
(contract_declaration name: (identifier) @type)
(library_declaration name: (identifier) @type)
(interface_declaration name: (identifier) @type)
(event_definition name: (identifier) @type)

(function_definition name: (identifier) @function)
(modifier_definition name: (identifier) @function)
(yul_evm_builtin) @function.builtin

(constructor_definition "constructor" @constructor)
(fallback_receive_definition "receive" @constructor)
(fallback_receive_definition "fallback" @constructor)

(struct_member name: (identifier) @property)
(enum_value) @constant

(emit_statement name: (identifier) @type)
(modifier_invocation (identifier) @function)

(call_expression function: (identifier) @function)
(call_expression function: (member_expression property: (identifier) @function.method))

(call_struct_argument name: (_) @property)
(event_paramater name: (identifier) @variable)
(parameter name: (identifier) @variable)

(yul_function_call function: (yul_identifier) @function)
(yul_function_definition . (yul_identifier) @function (yul_identifier) @variable)

(member_expression property: (identifier) @property)
(struct_field_assignment name: (identifier) @property)

(meta_type_expression "type" @keyword)

[
  "pragma"
  "contract"
  "abstract"
  "interface"
  "library"
  "is"
  "struct"
  "enum"
  "event"
  "using"
  "assembly"
  "emit"
  "public"
  "internal"
  "private"
  "external"
  "pure"
  "view"
  "payable"
  "modifier"
  "memory"
  "storage"
  "calldata"
  "var"
  "constant"
  (virtual)
  (override_specifier)
  (yul_leave)
  "for"
  "while"
  "do"
  "break"
  "continue"
  "if"
  "else"
  "switch"
  "case"
  "default"
  "try"
  "catch"
  "return"
  "returns"
  "function"
  "import"
  "delete"
  "new"
] @keyword

(import_directive "as" @keyword)
(import_directive "from" @keyword)
(event_paramater "indexed" @keyword)

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  "."
  ","
] @punctuation.delimiter

[
  "&&"
  "||"
  ">>"
  "<<"
  "&"
  "^"
  "|"
  "+"
  "-"
  "*"
  "/"
  "%"
  "**"
  "<"
  "<="
  "=="
  "!="
  ">="
  ">"
  "!"
  "~"
  "++"
  "--"
] @operator

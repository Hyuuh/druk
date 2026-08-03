(tag_name) @tag
(doctype) @constant
(attribute_name) @attribute
(quoted_attribute_value) @string
(attribute_value) @string
(comment) @comment
["<" ">" "</" "/>"] @punctuation.bracket
"=" @operator

; Block bodies are one raw_text token to this grammar — see `resolveInjections`
; in ../highlight.ts.
(script_element (raw_text) @injection.typescript)
(style_element (raw_text) @injection.css)

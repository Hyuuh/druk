(comment) @comment
(tag_name) @tag
[(attribute_name) (directive_name)] @attribute
[(directive_argument) (directive_modifier)] @property
[(quoted_attribute_value) (attribute_value)] @string
(interpolation) @embedded
["<" ">" "</" "/>"] @punctuation.bracket
"=" @operator

; The vue grammar stops at the block boundary: everything between <script> and
; </script> is one raw_text token. These hand those spans to another grammar —
; see `resolveInjections` in ../highlight.ts.
(script_element (raw_text) @injection.typescript)
(style_element (raw_text) @injection.css)
(interpolation (raw_text) @injection.typescript)

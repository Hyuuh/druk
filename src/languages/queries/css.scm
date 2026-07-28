; Generic rules first; more specific rules later win (latest capture takes the char).
(comment) @comment

; Values.
(string_value) @string
(color_value) @constant
(integer_value) @number
(float_value) @number
(unit) @type
(important) @keyword
; Bare values (`auto`, `sans-serif`, `flex`). Not @variable.member: several themes
; paint that in the plain text colour, which is what made CSS look unhighlighted.
(plain_value) @variable

; Declarations. Custom properties (`--color-ring`) are (property_name) too, so
; they colour like any other property.
(declaration (property_name) @property)
(call_expression (function_name) @function)

; Selectors.
(tag_name) @tag
(class_name) @constructor
(id_name) @constructor
(attribute_name) @attribute
(namespace_name) @namespace
(nesting_selector) @constructor
(universal_selector) @constructor
(pseudo_class_selector (class_name) @attribute)
(pseudo_element_selector (tag_name) @attribute)

; At-rules — `@media` and friends, plus whatever Tailwind invents this year:
; `@theme`, `@plugin`, `@source` and `@custom-variant` all parse as (at_keyword).
(at_keyword) @keyword.directive
["@media" "@import" "@charset" "@namespace" "@supports" "@keyframes"] @keyword.directive
(keyword_query) @keyword
(feature_name) @property
(keyframes_name) @constructor
; Not "from"/"to": they are keyframe selectors here, not anonymous tokens, and
; naming them makes the whole query fail to compile — which paints nothing at all.
["and" "or" "not" "only"] @keyword

["{" "}" "(" ")" "[" "]"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter

import type { InputRenderable } from '@opentui/core'
import { onMount } from 'solid-js'

import { ui } from '../themes'

export interface TextInputProps {
  value: string
  placeholder?: string
  /** Default true — two inputs on one panel need exactly one of these. */
  focused?: boolean
  /**
   * Open with the whole value selected, so the first keystroke replaces it. For a
   * box that opens carrying something the user did not type this time round — the
   * search remembering its last query — where the alternative is backspacing it
   * out one character at a time.
   */
  selectAllOnMount?: boolean
  onInput: (value: string) => void
}

/**
 * Themed single-line input. Inputs render focused, and OpenTUI uses the
 * `focused*` colors then — setting only `textColor` leaves the text in the
 * renderable's default color, which is invisible on most themes.
 */
export function TextInput(props: TextInputProps) {
  let input: InputRenderable | undefined

  // On mount rather than on a value change: this selects what the box *opened*
  // carrying, and re-running it as the user types would swallow every keystroke.
  // `setSelection` over `selectAll`, which moves the cursor to derive the range
  // and comes back empty on a renderable this freshly built.
  onMount(() => {
    if (props.selectAllOnMount && props.value) input?.setSelection(0, props.value.length)
  })

  return (
    <input
      ref={input}
      focused={props.focused ?? true}
      value={props.value}
      placeholder={props.placeholder}
      backgroundColor={ui.solidBg}
      textColor={ui.text}
      focusedBackgroundColor={ui.solidBg}
      focusedTextColor={ui.text}
      cursorColor={ui.cursor}
      placeholderColor={ui.faint}
      selectionBg={ui.treeSelectedBg}
      selectionFg={ui.text}
      onInput={props.onInput}
    />
  )
}

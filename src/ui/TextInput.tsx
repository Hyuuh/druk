import { ui } from '../themes'

export interface TextInputProps {
  value: string
  placeholder?: string
  onInput: (value: string) => void
}

/**
 * Themed single-line input. Inputs render focused, and OpenTUI uses the
 * `focused*` colors then — setting only `textColor` leaves the text in the
 * renderable's default color, which is invisible on most themes.
 */
export function TextInput(props: TextInputProps) {
  return (
    <input
      focused
      value={props.value}
      placeholder={props.placeholder}
      backgroundColor={ui.bg}
      textColor={ui.text}
      focusedBackgroundColor={ui.bg}
      focusedTextColor={ui.text}
      cursorColor={ui.cursor}
      placeholderColor={ui.faint}
      onInput={props.onInput}
    />
  )
}

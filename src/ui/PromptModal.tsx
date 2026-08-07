import type { KeyEvent, TextareaRenderable } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createSignal, Show } from 'solid-js'

import { ui } from '../themes'
import { modalWidth } from './modal'
import { ModalPanel } from './Overlay'
import { TextInput } from './TextInput'
import { useKeys } from './useKeys'

/** Tall enough for a subject + blank line + a short body without scrolling first. */
const MULTILINE_ROWS = 6

/** OpenTUI's defaults submit on Meta+Enter; Ctrl+Enter is the chord every commit UI names. */
const CTRL_SUBMIT = [
  { name: 'return' as const, ctrl: true, action: 'submit' as const },
  { name: 'kpenter' as const, ctrl: true, action: 'submit' as const },
]

export interface PromptModalProps {
  title: string
  initialValue: string
  /**
   * Multi-line body. Enter inserts a newline; Ctrl+Enter (and Meta+Enter) submit.
   * Single-line prompts keep Enter as confirm.
   */
  multiline?: boolean
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function PromptModal(props: PromptModalProps) {
  const dimensions = useTerminalDimensions()
  const [value, setValue] = createSignal(props.initialValue)
  let area: TextareaRenderable | undefined

  const width = () => modalWidth(dimensions().width, 0.5, 60, 80)

  useKeys((key: KeyEvent) => {
    if (key.name === 'escape') {
      key.preventDefault()
      props.onCancel()
      return
    }
    if (props.multiline) {
      // Enter alone is a newline on the textarea. Ctrl/Meta+Enter confirm — the
      // textarea binds the same chords; this covers the key reaching us first.
      if ((key.name === 'return' || key.name === 'enter') && (key.ctrl || key.meta)) {
        key.preventDefault()
        props.onSubmit(area?.plainText ?? '')
      }
      return
    }
    // Solid applies focus synchronously; without this the submitting key also
    // reaches whatever the modal focuses next.
    if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault()
      props.onSubmit(value())
    }
  })

  const hint = () =>
    props.multiline ? 'Ctrl+Enter to confirm · Esc to cancel' : 'Enter to confirm · Esc to cancel'

  return (
    <ModalPanel width={width()} title={` ${props.title} `}>
      <Show when={props.multiline} fallback={<TextInput value={value()} onInput={setValue} />}>
        <textarea
          ref={el => {
            area = el
          }}
          focused
          height={MULTILINE_ROWS}
          wrapMode="word"
          initialValue={props.initialValue}
          backgroundColor={ui.solidBg}
          textColor={ui.text}
          focusedBackgroundColor={ui.solidBg}
          focusedTextColor={ui.text}
          cursorColor={ui.cursor}
          placeholderColor={ui.faint}
          selectionBg={ui.treeSelectedBg}
          selectionFg={ui.text}
          keyBindings={CTRL_SUBMIT}
          onSubmit={() => props.onSubmit(area?.plainText ?? '')}
        />
      </Show>
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      <text fg={ui.dim} bg={ui.panelBg} content={hint()} />
    </ModalPanel>
  )
}

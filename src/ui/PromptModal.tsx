import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'
import { createSignal } from 'solid-js'

import { ui } from '../themes'
import { Overlay } from './Overlay'
import { TextInput } from './TextInput'

export interface PromptModalProps {
  title: string
  initialValue: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function PromptModal(props: PromptModalProps) {
  const [value, setValue] = createSignal(props.initialValue)

  useKeyboard((key: KeyEvent) => {
    // Solid applies focus synchronously; without this the submitting key also
    // reaches whatever the modal focuses next.
    if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault()
      props.onSubmit(value())
    } else if (key.name === 'escape') {
      key.preventDefault()
      props.onCancel()
    }
  })

  return (
    <Overlay>
      <box
        width={60}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={ui.accent}
        title={` ${props.title} `}
        titleColor={ui.text}
        paddingLeft={1}
        paddingRight={1}
      >
        <TextInput value={value()} onInput={setValue} />
        <text fg={ui.dim} bg={ui.panelBg} content="Enter to confirm · Esc to cancel" />
      </box>
    </Overlay>
  )
}

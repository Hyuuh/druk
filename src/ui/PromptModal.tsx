import type { KeyEvent } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { createSignal } from 'solid-js'

import { ui } from '../themes'
import { modalWidth, PAD } from './modal'
import { Overlay } from './Overlay'
import { TextInput } from './TextInput'

export interface PromptModalProps {
  title: string
  initialValue: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function PromptModal(props: PromptModalProps) {
  const dimensions = useTerminalDimensions()
  const [value, setValue] = createSignal(props.initialValue)

  const width = () => modalWidth(dimensions().width, 0.5, 60, 80)

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
        width={width()}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={ui.accent}
        title={` ${props.title} `}
        titleColor={ui.text}
        paddingLeft={PAD}
        paddingRight={PAD}
      >
        <TextInput value={value()} onInput={setValue} />
        <text fg={ui.panelBg} bg={ui.panelBg} content="" />
        <text fg={ui.dim} bg={ui.panelBg} content="Enter to confirm · Esc to cancel" />
      </box>
    </Overlay>
  )
}

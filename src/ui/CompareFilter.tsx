import type { KeyEvent } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'

import { ui } from '../themes'
import { modalWidth, PAD } from './modal'
import { Overlay } from './Overlay'
import { TextInput } from './TextInput'

export interface CompareFilterProps {
  value: string
  onInput: (value: string) => void
  onClose: (clear: boolean) => void
}

export function CompareFilter(props: CompareFilterProps) {
  const dimensions = useTerminalDimensions()
  const width = () => modalWidth(dimensions().width, 0.55, 40, 80)

  useKeyboard((key: KeyEvent) => {
    if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault()
      props.onClose(false)
    } else if (key.name === 'escape') {
      key.preventDefault()
      props.onClose(true)
    }
  })

  return (
    <Overlay zIndex={160}>
      <box
        width={width()}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={ui.accent}
        title=" Filter comparison "
        titleColor={ui.text}
        paddingLeft={PAD}
        paddingRight={PAD}
      >
        <TextInput
          value={props.value}
          placeholder="Type a path, commit, author or hash…"
          onInput={props.onInput}
        />
        <text fg={ui.dim} bg={ui.panelBg} content="Enter keep · Esc clear" />
      </box>
    </Overlay>
  )
}

import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/react'
import { useState } from 'react'

import { ui } from '../theme'
import { Overlay } from './Overlay'

export interface PromptModalProps {
  title: string
  initialValue: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function PromptModal({ title, initialValue, onSubmit, onCancel }: PromptModalProps) {
  const [value, setValue] = useState(initialValue)

  useKeyboard((key: KeyEvent) => {
    if (key.name === 'return' || key.name === 'enter') onSubmit(value)
    else if (key.name === 'escape') onCancel()
  })

  return (
    <Overlay>
      <box
        width={60}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderColor={ui.accent}
        title={` ${title} `}
        titleColor={ui.text}
        paddingLeft={1}
        paddingRight={1}
      >
        <input
          focused
          value={value}
          backgroundColor={ui.bg}
          textColor={ui.text}
          onInput={setValue}
        />
        <text fg={ui.dim} bg={ui.panelBg} content="Enter to confirm · Esc to cancel" />
      </box>
    </Overlay>
  )
}

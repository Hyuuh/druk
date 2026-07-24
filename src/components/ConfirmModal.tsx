import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/react'

import { ui } from '../theme'
import { Overlay } from './Overlay'

export interface ConfirmModalProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({ message, onConfirm, onCancel }: ConfirmModalProps) {
  useKeyboard((key: KeyEvent) => {
    if (key.name === 'return' || key.name === 'enter') onConfirm()
    else if (key.name === 'escape') onCancel()
  })

  return (
    <Overlay>
      <box
        width={60}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderColor={ui.error}
        title=" Delete "
        titleColor={ui.error}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={ui.text} bg={ui.panelBg} content={message} />
        <text fg={ui.dim} bg={ui.panelBg} content="Enter to delete · Esc to cancel" />
      </box>
    </Overlay>
  )
}

import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'

import { ui } from '../themes'
import { Overlay } from './Overlay'

export interface ConfirmModalProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal(props: ConfirmModalProps) {
  useKeyboard((key: KeyEvent) => {
    if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault()
      props.onConfirm()
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
        borderColor={ui.error}
        title=" Delete "
        titleColor={ui.error}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={ui.text} bg={ui.panelBg} content={props.message} />
        <text fg={ui.dim} bg={ui.panelBg} content="Enter to delete · Esc to cancel" />
      </box>
    </Overlay>
  )
}

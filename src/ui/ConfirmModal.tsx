import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'

import { ui } from '../themes'
import { Overlay } from './Overlay'

export interface ConfirmModalProps {
  message: string
  title: string
  /** Verb for the footer, e.g. "push" renders "Enter to push". */
  verb: string
  /** Red border and title, for anything that throws work away. */
  danger?: boolean
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

  const accent = () => (props.danger ? ui.error : ui.accent)

  return (
    <Overlay>
      <box
        width={60}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={accent()}
        title={` ${props.title} `}
        titleColor={accent()}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={ui.text} bg={ui.panelBg} content={props.message} />
        <text fg={ui.dim} bg={ui.panelBg} content={`Enter to ${props.verb} · Esc to cancel`} />
      </box>
    </Overlay>
  )
}

import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'
import { createSignal, For } from 'solid-js'

import { ui } from '../themes'
import { Overlay } from './Overlay'

export interface Choice {
  id: string
  label: string
}

export interface ChoiceModalProps {
  title: string
  message: string
  choices: Choice[]
  onPick: (id: string) => void
  onCancel: () => void
}

export function ChoiceModal(props: ChoiceModalProps) {
  const [index, setIndex] = createSignal(0)

  useKeyboard((key: KeyEvent) => {
    const k = key.name
    if (k === 'up') {
      key.preventDefault()
      setIndex(i => (i - 1 + props.choices.length) % props.choices.length)
    } else if (k === 'down') {
      key.preventDefault()
      setIndex(i => (i + 1) % props.choices.length)
    } else if (k === 'return' || k === 'enter') {
      key.preventDefault()
      props.onPick(props.choices[index()]!.id)
    } else if (k === 'escape') {
      key.preventDefault()
      props.onCancel()
    }
  })

  return (
    <Overlay zIndex={160}>
      <box
        width={64}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={ui.dirty}
        title={` ${props.title} `}
        titleColor={ui.dirty}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={ui.text} bg={ui.panelBg} content={props.message} />
        <text fg={ui.dim} bg={ui.panelBg} content="" />
        <For each={props.choices}>
          {(choice, i) => (
            <text
              fg={i() === index() ? ui.text : ui.dim}
              bg={i() === index() ? ui.treeSelectedBg : ui.panelBg}
              content={` ${i() === index() ? '›' : ' '} ${choice.label}`}
            />
          )}
        </For>
        <text fg={ui.dim} bg={ui.panelBg} content="" />
        <text fg={ui.dim} bg={ui.panelBg} content="↑↓ choose · Enter confirm · Esc cancel" />
      </box>
    </Overlay>
  )
}

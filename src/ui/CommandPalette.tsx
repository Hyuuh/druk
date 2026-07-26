import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'
import { createMemo, createSignal, For, Show } from 'solid-js'

import type { Command } from '../app/commands'
import { flattenCommands } from '../app/commands'
import { ui } from '../themes'
import { Overlay } from './Overlay'
import { TextInput } from './TextInput'

export interface CommandPaletteProps {
  commands: Command[]
  onClose: () => void
}

interface Row {
  command: Command
  /** Ancestor labels, shown as "Themes > " while filtering. */
  trail: string[]
}

export function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = createSignal('')
  const [trail, setTrail] = createSignal<Command[]>([])
  const [index, setIndex] = createSignal(0)

  // Typing searches every leaf in the tree; otherwise browse the current level.
  const rows = createMemo<Row[]>(() => {
    const q = query().trim().toLowerCase()
    if (!q) {
      const parent = trail().at(-1)
      const level = parent ? (parent.children ?? []) : props.commands
      return level.map(command => ({ command, trail: [] }))
    }
    return flattenCommands(props.commands).filter(({ command, trail: t }) =>
      [...t, command.label].join(' ').toLowerCase().includes(q),
    )
  })

  const selected = () => Math.min(index(), Math.max(0, rows().length - 1))

  const enter = (row: Row) => {
    if (row.command.children) {
      setTrail(t => [...t, row.command])
      setQuery('')
      setIndex(0)
      return
    }
    props.onClose()
    row.command.run?.()
  }

  const back = () => {
    if (trail().length === 0) {
      props.onClose()
      return
    }
    setTrail(t => t.slice(0, -1))
    setIndex(0)
  }

  useKeyboard((key: KeyEvent) => {
    const k = key.name
    if (k === 'up') {
      key.preventDefault()
      setIndex(i => (i - 1 + rows().length) % Math.max(1, rows().length))
    } else if (k === 'down') {
      key.preventDefault()
      setIndex(i => (i + 1) % Math.max(1, rows().length))
    } else if (k === 'return' || k === 'enter' || k === 'right') {
      key.preventDefault()
      const row = rows()[selected()]
      if (row) enter(row)
    } else if (k === 'left' || k === 'escape') {
      key.preventDefault()
      back()
    }
  })

  return (
    <Overlay zIndex={150}>
      <box
        width={58}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={ui.accent}
        title={
          trail().length > 0
            ? ` ${trail()
                .map(c => c.label)
                .join(' › ')} `
            : ' Commands '
        }
        titleColor={ui.text}
        paddingLeft={1}
        paddingRight={1}
      >
        <TextInput
          value={query()}
          placeholder="Type to filter…"
          onInput={v => {
            setQuery(v)
            setIndex(0)
          }}
        />
        <Show
          when={rows().length > 0}
          fallback={<text fg={ui.dim} bg={ui.panelBg} content=" No matching commands" />}
        >
          <For each={rows()}>
            {(row, i) => {
              const active = () => i() === selected()
              const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
              const prefix = row.trail.length > 0 ? `${row.trail.join(' > ')} > ` : ''
              return (
                <box flexDirection="row" backgroundColor={bg()}>
                  <box flexGrow={1}>
                    <text
                      fg={active() ? ui.text : ui.dim}
                      bg={bg()}
                      content={` ${prefix}${row.command.label}${row.command.children ? ' >' : ''}`}
                    />
                  </box>
                  <Show when={row.command.hint}>
                    {(hint: () => string) => (
                      <text fg={ui.faint} bg={bg()} content={`${hint()} `} />
                    )}
                  </Show>
                </box>
              )
            }}
          </For>
        </Show>
        <text
          fg={ui.dim}
          bg={ui.panelBg}
          content={
            trail().length > 0 ? ' Left back · Enter run · Esc close' : ' Enter open · Esc close'
          }
        />
      </box>
    </Overlay>
  )
}

import type { KeyEvent } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'

import type { Command, FlatCommand } from '../app/commands'
import { flattenCommands } from '../app/commands'
import { ui } from '../themes'
import { listRows, modalWidth, PAD } from './modal'
import { Overlay, topInset } from './Overlay'
import { TextInput } from './TextInput'

export interface CommandPaletteProps {
  commands: Command[]
  onClose: () => void
}

export function CommandPalette(props: CommandPaletteProps) {
  const dimensions = useTerminalDimensions()
  const [query, setQuery] = createSignal('')
  const [trail, setTrail] = createSignal<Command[]>([])
  const [index, setIndex] = createSignal(0)
  let lastCancel: (() => void) | undefined

  const width = () => modalWidth(dimensions().width, 0.55, 58, 92)
  /** Border, input, blank line and footer. */
  const visibleRows = () => listRows(dimensions().height - topInset(dimensions().height), 8, 18)

  const rows = createMemo<FlatCommand[]>(() => {
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

  /** Paint a command's preview whenever the selection lands on one. */
  createEffect(() => {
    const row = rows()[selected()]
    if (row?.command.preview) {
      row.command.preview()
      if (row.command.cancel) lastCancel = row.command.cancel
    } else if (lastCancel) {
      lastCancel()
      lastCancel = undefined
    }
  })

  // A filter can match every leaf in the tree; rendering them all pushes the
  // input and the footer off an 80x24 screen, so only a window is drawn.
  const windowed = createMemo(() => {
    const size = visibleRows()
    const start = Math.max(0, Math.min(selected() - size + 1, rows().length - size))
    return { start, rows: rows().slice(start, start + size) }
  })

  const enter = (row: FlatCommand) => {
    if (row.command.children) {
      setTrail(t => [...t, row.command])
      setQuery('')
      setIndex(0)
      return
    }
    if (!row.command.preview && lastCancel) {
      lastCancel()
      lastCancel = undefined
    }
    props.onClose()
    row.command.run?.()
  }

  const back = () => {
    const row = rows()[selected()]
    if (lastCancel) {
      lastCancel()
      lastCancel = undefined
    } else if (row?.command.cancel) {
      row.command.cancel()
    }
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
    <Overlay zIndex={150} align="top">
      <box
        width={width()}
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
        paddingLeft={PAD}
        paddingRight={PAD}
      >
        <TextInput
          value={query()}
          placeholder="Type to filter…"
          onInput={v => {
            setQuery(v)
            setIndex(0)
          }}
        />
        {/* A blank line between the field and the list, so the two read as separate
            things rather than one dense block. */}
        <text fg={ui.panelBg} bg={ui.panelBg} content="" />
        {/* Fixed height, not content height: the panel is centered, so a list that
            shrinks with every keystroke moves the input field the user is typing in. */}
        <box flexDirection="column" height={visibleRows()}>
          <Show
            when={rows().length > 0}
            fallback={<text fg={ui.dim} bg={ui.panelBg} content="No matching commands" />}
          >
            <For each={windowed().rows}>
              {(row, i) => {
                const active = () => windowed().start + i() === selected()
                const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
                const prefix = row.trail.length > 0 ? `${row.trail.join(' › ')} › ` : ''
                return (
                  <box flexDirection="row" backgroundColor={bg()}>
                    {/* A bar on the selected row: the background alone is easy to miss
                        on a low-contrast theme. */}
                    <text
                      fg={ui.accent}
                      bg={bg()}
                      flexShrink={0}
                      content={active() ? '▌ ' : '  '}
                    />
                    <box flexGrow={1}>
                      <text
                        fg={active() ? ui.text : ui.dim}
                        bg={bg()}
                        content={`${prefix}${row.command.label}${row.command.children ? ' ›' : ''}`}
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
        </box>
        <text
          fg={ui.dim}
          bg={ui.panelBg}
          content={
            trail().length > 0 ? '←/Esc back · Enter run' : '↑↓ move · Enter open · Esc close'
          }
        />
      </box>
    </Overlay>
  )
}

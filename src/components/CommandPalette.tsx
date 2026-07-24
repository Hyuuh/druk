import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/react'
import { useState } from 'react'

import { ui } from '../theme'
import { Overlay } from './Overlay'

export interface Command {
  id: string
  label: string
  hint?: string
}

export interface CommandPaletteProps {
  commands: Command[]
  onRun: (id: string) => void
  onClose: () => void
}

export function CommandPalette({ commands, onRun, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  const q = query.trim().toLowerCase()
  const filtered = q ? commands.filter(c => c.label.toLowerCase().includes(q)) : commands
  const selected = Math.min(index, Math.max(0, filtered.length - 1))

  useKeyboard((key: KeyEvent) => {
    const k = key.name
    if (k === 'up') {
      key.preventDefault()
      setIndex(i => (i - 1 + filtered.length) % filtered.length)
    } else if (k === 'down') {
      key.preventDefault()
      setIndex(i => (i + 1) % filtered.length)
    } else if (k === 'return' || k === 'enter') {
      key.preventDefault()
      const cmd = filtered[selected]
      if (cmd) onRun(cmd.id)
    } else if (k === 'escape') {
      key.preventDefault()
      onClose()
    }
  })

  return (
    <Overlay zIndex={150}>
      <box
        width={54}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderColor={ui.accent}
        title=" Commands "
        titleColor={ui.text}
        paddingLeft={1}
        paddingRight={1}
      >
        <input
          focused
          value={query}
          placeholder="Type to filter…"
          backgroundColor={ui.bg}
          textColor={ui.text}
          onInput={v => {
            setQuery(v)
            setIndex(0)
          }}
        />
        {filtered.length === 0 ? (
          <text fg={ui.dim} bg={ui.panelBg} content=" No matching commands" />
        ) : (
          filtered.map((cmd, i) => {
            const bg = i === selected ? ui.treeSelectedBg : ui.panelBg
            return (
              <box key={cmd.id} flexDirection="row" backgroundColor={bg}>
                <box flexGrow={1}>
                  <text fg={i === selected ? ui.text : ui.dim} bg={bg} content={` ${cmd.label}`} />
                </box>
                {cmd.hint ? <text fg={ui.faint} bg={bg} content={`${cmd.hint} `} /> : null}
              </box>
            )
          })
        )}
      </box>
    </Overlay>
  )
}

import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, For } from 'solid-js'

import { ui } from '../themes'
import { keysFor } from './keys'

/**
 * The Ctrl+K peek: every key alive in the current pane, as a strip sitting on
 * the status bar. Opened by a key and closed by the next one, so it reads as
 * "hold to see" without needing key-release events no classic terminal sends.
 */
export function KeyPeek(props: { pane: 'tree' | 'editor' }) {
  const dimensions = useTerminalDimensions()

  const layout = createMemo(() => {
    const entries = keysFor(props.pane)
    const width = dimensions().width
    const cols = Math.max(1, Math.floor(width / 40))
    const rows = Math.ceil(entries.length / cols)
    const colWidth = Math.floor(width / cols)
    const keyWidth = Math.max(...entries.map(entry => entry.key.length))

    // Column-major, so the strip reads top to bottom like the help table.
    const grid = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => entries[col * rows + row]).filter(
        entry => entry !== undefined,
      ),
    )
    return { grid, keyWidth, labelWidth: Math.max(4, colWidth - keyWidth - 3) }
  })

  return (
    <box
      position="absolute"
      left={0}
      top={dimensions().height - 1 - layout().grid.length}
      width="100%"
      flexDirection="column"
      backgroundColor={ui.panelBg}
      zIndex={90}
    >
      <For each={layout().grid}>
        {line => (
          <box height={1} flexDirection="row" backgroundColor={ui.panelBg}>
            <For each={line}>
              {entry => (
                <box flexDirection="row" flexShrink={0} backgroundColor={ui.panelBg}>
                  <text
                    fg={ui.accent}
                    bg={ui.panelBg}
                    content={` ${entry.key.padEnd(layout().keyWidth)} `}
                  />
                  <text
                    fg={ui.dim}
                    bg={ui.panelBg}
                    content={`${entry.label.slice(0, layout().labelWidth).padEnd(layout().labelWidth)} `}
                  />
                </box>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}

import { TextAttributes } from '@opentui/core'
import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { createMemo, For } from 'solid-js'

import { parseDiff } from '../core/diff'
import type { DiffRow } from '../core/diff'
import { ui } from '../themes'
import { Overlay } from './Overlay'

export interface DiffViewProps {
  title: string
  /** Unified diff, exactly as git printed it. Empty means no changes. */
  diff: string
  onClose: () => void
}

const COLORS: Record<DiffRow['kind'], string> = {
  file: ui.text,
  hunk: ui.accent,
  added: ui.gitAdded,
  removed: ui.gitDeleted,
  context: ui.dim,
}

export function DiffView(props: DiffViewProps) {
  const dimensions = useTerminalDimensions()
  let box: ScrollBoxRenderable | undefined

  const rows = createMemo(() => parseDiff(props.diff))

  const height = () => Math.max(6, Math.min(dimensions().height - 6, rows().length + 2))
  const width = () => Math.max(40, dimensions().width - 12)
  /** Border, padding and the scrollbar column the scrollbox reserves. */
  const contentWidth = () => width() - 5

  const scrollBy = (rows: number) => {
    if (!box) return
    box.scrollTop = Math.max(0, box.scrollTop + rows)
  }

  useKeyboard((key: KeyEvent) => {
    key.preventDefault()
    if (key.name === 'escape' || key.name === 'q') props.onClose()
    else if (key.name === 'down' || key.name === 'j') scrollBy(1)
    else if (key.name === 'up' || key.name === 'k') scrollBy(-1)
    else if (key.name === 'pagedown' || key.name === 'space') scrollBy(height() - 3)
    else if (key.name === 'pageup') scrollBy(-(height() - 3))
  })

  return (
    <Overlay zIndex={160}>
      <box
        width={width()}
        height={height()}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={ui.accent}
        title={` ${props.title} `}
        titleColor={ui.text}
        paddingLeft={1}
        paddingRight={1}
      >
        <scrollbox
          ref={el => (box = el)}
          flexGrow={1}
          backgroundColor={ui.panelBg}
          scrollbarOptions={{
            trackOptions: { foregroundColor: ui.scrollbar, backgroundColor: ui.panelBg },
          }}
        >
          <For each={rows()} fallback={<text fg={ui.dim} bg={ui.panelBg} content="No changes" />}>
            {row => (
              <text
                fg={COLORS[row.kind]}
                bg={row.kind === 'file' ? ui.barBg : ui.panelBg}
                attributes={row.kind === 'file' ? TextAttributes.BOLD : undefined}
                content={
                  row.kind === 'file'
                    ? ` ▌ ${row.text} `.padEnd(contentWidth()).slice(0, contentWidth())
                    : row.text.slice(0, contentWidth()) || ' '
                }
              />
            )}
          </For>
        </scrollbox>
        <text fg={ui.dim} bg={ui.panelBg} content="↑↓ scroll · PgUp/PgDn page · Esc close" />
      </box>
    </Overlay>
  )
}

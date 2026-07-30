import { TextAttributes } from '@opentui/core'
import type { MouseEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, For, Show } from 'solid-js'

import { ui } from '../themes'

export interface TabInfo {
  /** What the callbacks name this tab by: a file path, or the diff tab's own id —
   * a diff of an open file is a second tab for the same path. */
  id: string
  name: string
  dirty: boolean
  preview: boolean
}

export interface TabsProps {
  tabs: TabInfo[]
  /** `id` of the tab on screen. */
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  /** Clicking an overflow counter asks for the full list of open tabs. */
  onOverflow: () => void
}

const MAX_LABEL = 18
/** Padding, the dirty/close glyph and the separator around a label. */
const CHROME = 5

const shorten = (name: string) =>
  name.length <= MAX_LABEL ? name : `${name.slice(0, MAX_LABEL - 1)}…`

export function Tabs(props: TabsProps) {
  const dimensions = useTerminalDimensions()

  /**
   * Only the tabs that fit are rendered, scrolled to keep the active one in
   * view. Letting flexbox shrink them instead clips names mid-character.
   */
  const visible = createMemo(() => {
    // The bar spans the terminal: the tree sits below it, not beside it. Taking
    // the sidebar's width off the budget made tabs reflow on every resize.
    const budget = dimensions().width
    const width = (tab: TabInfo) => shorten(tab.name).length + CHROME

    const active = Math.max(
      0,
      props.tabs.findIndex(tab => tab.id === props.activeId),
    )
    let first = active
    let last = active
    let used = props.tabs[active] ? width(props.tabs[active]!) : 0

    // Grow outwards from the active tab until the row is full.
    while (first > 0 || last < props.tabs.length - 1) {
      const before = first > 0 ? width(props.tabs[first - 1]!) : Infinity
      const after = last < props.tabs.length - 1 ? width(props.tabs[last + 1]!) : Infinity
      const next = Math.min(before, after)
      if (used + next > budget) break
      if (after <= before) {
        last++
      } else {
        first--
      }
      used += next
    }
    return {
      tabs: props.tabs.slice(first, last + 1),
      before: first,
      after: props.tabs.length - 1 - last,
    }
  })

  return (
    <box flexDirection="column" flexShrink={0}>
      <box height={1} flexDirection="row" backgroundColor={ui.barBg}>
        <Show
          when={props.tabs.length > 0}
          fallback={<text fg={ui.faint} bg={ui.barBg} content="  no open files" />}
        >
          <Show when={visible().before > 0}>
            <box paddingLeft={1} backgroundColor={ui.barBg} onMouseDown={() => props.onOverflow()}>
              <text fg={ui.dim} bg={ui.barBg} content={`‹${visible().before}`} />
            </box>
          </Show>
          <For each={visible().tabs}>
            {tab => {
              const active = () => tab.id === props.activeId
              const bg = () => (active() ? ui.bg : ui.barBg)
              return (
                <box
                  flexDirection="row"
                  flexShrink={0}
                  backgroundColor={bg()}
                  paddingLeft={1}
                  paddingRight={1}
                  onMouseDown={() => props.onSelect(tab.id)}
                >
                  <text
                    fg={active() ? ui.activeTabFg : ui.inactiveTabFg}
                    bg={bg()}
                    content={shorten(tab.name)}
                    attributes={
                      tab.preview
                        ? TextAttributes.ITALIC
                        : active()
                          ? TextAttributes.BOLD
                          : undefined
                    }
                  />
                  <box
                    paddingLeft={1}
                    onMouseDown={(e: MouseEvent) => {
                      e.stopPropagation()
                      props.onClose(tab.id)
                    }}
                  >
                    <text
                      fg={tab.dirty ? ui.dirty : active() ? ui.dim : ui.barBg}
                      bg={bg()}
                      content={tab.dirty ? '●' : '×'}
                    />
                  </box>
                </box>
              )
            }}
          </For>
          <Show when={visible().after > 0}>
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={ui.barBg}
              onMouseDown={() => props.onOverflow()}
            >
              <text fg={ui.dim} bg={ui.barBg} content={`${visible().after}›`} />
            </box>
          </Show>
        </Show>
        <box flexGrow={1} backgroundColor={ui.barBg} />
      </box>
    </box>
  )
}

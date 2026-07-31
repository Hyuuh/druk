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
  /** Whether the visit history has anywhere to go, each way. */
  canBack: boolean
  canForward: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onBack: () => void
  onForward: () => void
  /** Clicking an overflow counter asks for the full list of open tabs. */
  onOverflow: () => void
}

const MAX_LABEL = 18
/** Padding, the dirty/close glyph and the separator around a label. */
const CHROME = 5
/** Columns the history arrows take off the row: two boxes and their padding. */
const NAV = 5

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
    // the sidebar's width off the budget made tabs reflow on every resize. The
    // arrows are drawn whether or not they are live, so their columns are gone
    // from the budget either way.
    const budget = dimensions().width - NAV
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
        {/* The way back through the tabs the editor has landed on. Always drawn,
            dimmed to `faint` when that way is empty: an arrow that comes and goes
            shifts every tab beside it, and the row would jump on each jump. */}
        <box paddingLeft={1} backgroundColor={ui.barBg} onMouseDown={() => props.onBack()}>
          <text fg={props.canBack ? ui.dim : ui.faint} bg={ui.barBg} content="←" />
        </box>
        <box
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={ui.barBg}
          onMouseDown={() => props.onForward()}
        >
          <text fg={props.canForward ? ui.dim : ui.faint} bg={ui.barBg} content="→" />
        </box>
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
                  paddingRight={1}
                  onMouseDown={() => props.onSelect(tab.id)}
                >
                  {/* The accent edge is what says "this one" at a glance — a bold
                      label and a background a shade apart do not survive a
                      low-contrast theme. It takes the column the padding had, so
                      the strip's geometry is unchanged. A space on the inactive
                      tabs, not the glyph hidden by painting it in the background:
                      with `transparent` on there is no background to hide it in. */}
                  <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▎' : ' '} />
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

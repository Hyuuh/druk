import { TextAttributes } from '@opentui/core'
import { For } from 'solid-js'

import { ui } from '../themes'

export type SidebarView = 'files' | 'git' | 'extensions'

export interface SidebarTabsProps {
  view: SidebarView
  /** The sidebar holds the keyboard: the pressed button fills brighter with it. */
  focused: boolean
  /** Columns the strip has. Narrower than the names need, it falls to initials. */
  width: number
  onSelect: (view: SidebarView) => void
}

const TABS: { id: SidebarView; label: string; short: string }[] = [
  { id: 'files', label: 'Files', short: 'F' },
  { id: 'git', label: 'Git', short: 'G' },
  { id: 'extensions', label: 'Ext', short: 'E' },
]

/** A button costs its label plus a column of padding either side and one of gutter. */
const stripWidth = (labels: string[]) =>
  1 + labels.reduce((sum, label) => sum + label.length + 3, 0)

/**
 * The sidebar's views as a row of buttons: the one on screen is the pressed
 * one, filled the way the status bar fills — `statusBg`/`statusFg` is the only
 * pair in the palette guaranteed to be legible together in every theme, which an
 * accent-on-panel guess is not.
 *
 * The strip's own background is `barBg`, not `panelBg`, and it starts with a
 * one-column gutter of it. Both matter: the sidebar's right edge is found by
 * where `panelBg` stops on a row, so a row that begins in panel colour and
 * changes mid-way would move the divider the resize code and its tests look for.
 */
export function SidebarTabs(props: SidebarTabsProps) {
  // Initials beside a narrow sidebar, as the settings page's hints do it: the
  // strip cannot wrap, and overflowing it paints the buttons over the editor.
  const long = () => stripWidth(TABS.map(tab => tab.label)) <= props.width
  return (
    <box height={1} flexDirection="row" flexShrink={0} backgroundColor={ui.barBg}>
      <box width={1} flexShrink={0} backgroundColor={ui.barBg} />
      <For each={TABS}>
        {tab => {
          const active = () => props.view === tab.id
          // Unfocused keeps the fill but drops to the tree's own selection colour:
          // which view is up is not the same fact as who has the keyboard.
          const bg = () =>
            active() ? (props.focused ? ui.statusBg : ui.treeSelectedBg) : ui.sidebarBg
          const fg = () => (active() ? (props.focused ? ui.statusFg : ui.text) : ui.inactiveTabFg)
          return (
            <>
              <box
                flexDirection="row"
                flexShrink={0}
                backgroundColor={bg()}
                paddingLeft={1}
                paddingRight={1}
                onMouseDown={() => props.onSelect(tab.id)}
              >
                <text
                  fg={fg()}
                  bg={bg()}
                  content={long() ? tab.label : tab.short}
                  attributes={active() ? TextAttributes.BOLD : undefined}
                />
              </box>
              <box width={1} flexShrink={0} backgroundColor={ui.barBg} />
            </>
          )
        }}
      </For>
      <box flexGrow={1} backgroundColor={ui.barBg} />
    </box>
  )
}

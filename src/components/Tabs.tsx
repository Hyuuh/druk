import type { MouseEvent } from '@opentui/core'

import { ui } from '../theme'

export interface TabInfo {
  path: string
  name: string
  dirty: boolean
}

export interface TabsProps {
  tabs: TabInfo[]
  activePath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
}

export function Tabs({ tabs, activePath, onSelect, onClose }: TabsProps) {
  return (
    <box height={1} flexDirection="row" backgroundColor={ui.barBg} flexShrink={0}>
      {tabs.length === 0 ? (
        <text
          fg={ui.dim}
          bg={ui.barBg}
          content="  no open files — pick one from the tree (Enter) "
        />
      ) : (
        tabs.map(tab => {
          const active = tab.path === activePath
          const bg = active ? ui.activeTabBg : ui.inactiveTabBg
          const fg = active ? ui.activeTabFg : ui.inactiveTabFg
          return (
            <box
              key={tab.path}
              flexDirection="row"
              backgroundColor={bg}
              paddingLeft={1}
              paddingRight={1}
              onMouseDown={() => onSelect(tab.path)}
            >
              <text fg={tab.dirty ? ui.dirty : fg} bg={bg} content={tab.dirty ? '● ' : ''} />
              <text fg={fg} bg={bg} content={tab.name} />
              <box
                paddingLeft={1}
                onMouseDown={(e: MouseEvent) => {
                  e.stopPropagation()
                  onClose(tab.path)
                }}
              >
                <text fg={ui.dim} bg={bg} content="✕" />
              </box>
            </box>
          )
        })
      )}
    </box>
  )
}

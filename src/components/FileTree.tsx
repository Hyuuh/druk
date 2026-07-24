import type { TreeNode } from '../fs'
import { ui } from '../theme'

export interface FileTreeProps {
  rootName: string
  nodes: TreeNode[]
  selectedPath: string | null
  expanded: Set<string>
  focused: boolean
  width: number
  onActivate: (node: TreeNode) => void
  onFocus: () => void
}

export function FileTree({
  rootName,
  nodes,
  selectedPath,
  expanded,
  focused,
  width,
  onActivate,
  onFocus,
}: FileTreeProps) {
  return (
    <box
      width={width}
      flexDirection="column"
      backgroundColor={ui.panelBg}
      flexShrink={0}
      onMouseDown={onFocus}
    >
      <box height={1} backgroundColor={ui.panelBg} paddingLeft={1}>
        <text fg={focused ? ui.text : ui.dim} bg={ui.panelBg} content={`EXPLORER — ${rootName}`} />
      </box>
      <scrollbox flexGrow={1} backgroundColor={ui.panelBg}>
        {nodes.map(node => {
          const selected = node.path === selectedPath
          const bg = selected ? (focused ? ui.treeSelectedBg : ui.treeFocusBg) : ui.panelBg
          const arrow = node.isDir ? (expanded.has(node.path) ? '▾' : '▸') : ' '
          const indent = ' '.repeat(node.depth * 2)
          const fg = node.isDir ? ui.folder : ui.text
          return (
            <box
              key={node.path}
              height={1}
              flexDirection="row"
              backgroundColor={bg}
              onMouseDown={() => {
                onFocus()
                onActivate(node)
              }}
            >
              <text fg={ui.dim} bg={bg} content={`${indent}${arrow} `} />
              <text fg={fg} bg={bg} content={node.name} />
            </box>
          )
        })}
      </scrollbox>
    </box>
  )
}

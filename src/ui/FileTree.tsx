import { TextAttributes } from '@opentui/core'
import type { ScrollBoxRenderable } from '@opentui/core'
import { createEffect, For, on, Show } from 'solid-js'

import type { TreeNode } from '../core/fs'
import type { FileStatus } from '../core/git'
import { ui } from '../themes'

export interface FileTreeProps {
  rootName: string
  nodes: TreeNode[]
  selectedPath: string | null
  expanded: Set<string>
  focused: boolean
  width: number
  /** Working-tree status per absolute path. */
  gitStatus: Map<string, FileStatus>
  onActivate: (node: TreeNode) => void
  onPin: (node: TreeNode) => void
  onFocus: () => void
}

const DOUBLE_CLICK_MS = 400

const MARKS: Record<FileStatus, string> = {
  untracked: 'U',
  added: 'A',
  modified: 'M',
  deleted: 'D',
}

const statusColor = (status: FileStatus) =>
  status === 'untracked' || status === 'added'
    ? ui.gitAdded
    : status === 'deleted'
      ? ui.gitDeleted
      : ui.gitModified

export function FileTree(props: FileTreeProps) {
  /** A folder inherits the status of whatever changed inside it. */
  const statusOf = (node: TreeNode): FileStatus | undefined => {
    const own = props.gitStatus.get(node.path)
    if (own || !node.isDir) return own
    const prefix = `${node.path}/`
    for (const [path, status] of props.gitStatus) {
      if (path.startsWith(prefix)) return status === 'untracked' ? 'untracked' : 'modified'
    }
    return undefined
  }

  let box: ScrollBoxRenderable | undefined

  // The selection moves for reasons the tree cannot see — arrow keys, but also a
  // tab switch or a jump from search — and a highlight scrolled out of view reads
  // as no highlight at all. Deliberately keyed on the selection alone: `nodes` is
  // a fresh array on every git refresh, and tracking it would yank a
  // mouse-scrolled tree back to the selected row every few seconds.
  createEffect(
    on([() => props.selectedPath, () => props.focused], ([path]) => {
      if (!box) return
      const row = props.nodes.findIndex(node => node.path === path)
      if (row < 0) return
      const height = box.viewport.height
      if (row < box.scrollTop) box.scrollTop = row
      else if (row >= box.scrollTop + height) box.scrollTop = row - height + 1
    }),
  )

  // OpenTUI has no double-click event, so detect it from consecutive downs.
  let lastClick = { path: '', at: 0 }

  const click = (node: TreeNode) => {
    const now = Date.now()
    const isDouble = lastClick.path === node.path && now - lastClick.at < DOUBLE_CLICK_MS
    lastClick = { path: node.path, at: now }
    props.onFocus()
    // Activating a folder toggles it, so the second click of a double-click would
    // close what the first one opened and the folder would look inert.
    if (isDouble && node.isDir) return
    props.onActivate(node)
    if (isDouble) props.onPin(node)
  }

  return (
    <box
      width={props.width}
      flexDirection="column"
      backgroundColor={ui.panelBg}
      flexShrink={0}
      onMouseDown={() => props.onFocus()}
    >
      <box height={2} flexDirection="column" backgroundColor={ui.panelBg} paddingLeft={2}>
        <text
          fg={props.focused ? ui.text : ui.dim}
          bg={ui.panelBg}
          content={props.rootName}
          attributes={TextAttributes.BOLD}
        />
        <text fg={ui.faint} bg={ui.panelBg} content="explorer" />
      </box>
      <scrollbox
        ref={el => (box = el)}
        flexGrow={1}
        backgroundColor={ui.panelBg}
        scrollbarOptions={{
          trackOptions: { foregroundColor: ui.scrollbar, backgroundColor: ui.panelBg },
        }}
      >
        <For each={props.nodes}>
          {node => {
            const selected = () => node.path === props.selectedPath
            const bg = () =>
              selected() ? (props.focused ? ui.treeSelectedBg : ui.treeFocusBg) : ui.panelBg
            const arrow = () => (node.isDir ? (props.expanded.has(node.path) ? '▾' : '▸') : '·')
            const status = () => statusOf(node)
            return (
              <box
                height={1}
                flexDirection="row"
                backgroundColor={bg()}
                onMouseDown={() => click(node)}
              >
                <text fg={ui.faint} bg={bg()} content={` ${'│ '.repeat(node.depth)}`} />
                <text fg={node.isDir ? ui.dim : ui.faint} bg={bg()} content={`${arrow()} `} />
                <box flexGrow={1} backgroundColor={bg()}>
                  <text
                    fg={status() ? statusColor(status()!) : node.isDir ? ui.folder : ui.text}
                    bg={bg()}
                    content={node.name}
                    attributes={node.isDir ? TextAttributes.BOLD : undefined}
                  />
                </box>
                <Show when={status()}>
                  {(status: () => FileStatus) => (
                    <text fg={statusColor(status())} bg={bg()} content={`${MARKS[status()]} `} />
                  )}
                </Show>
              </box>
            )
          }}
        </For>
      </scrollbox>
    </box>
  )
}

import { dirname } from 'node:path'

import { TextAttributes } from '@opentui/core'
import type { MouseEvent, ScrollBoxRenderable } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js'

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
  /** Taken with `x` and waiting for a destination; drawn as in flight. */
  cutPaths: string[]
  /** Picked out with Shift+↑/↓, and what delete and move act on. */
  markedPaths: string[]
  onActivate: (node: TreeNode) => void
  onPin: (node: TreeNode) => void
  onFocus: () => void
  /** Dropped or pasted: move `from` into the folder `dir`. */
  onMove: (from: string, dir: string) => void
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
  const [scrollTop, setScrollTop] = createSignal(0)
  const dimensions = useTerminalDimensions()

  /**
   * Only a window of rows exists as renderables. `viewportCulling` skips *drawing*
   * off-screen children but still builds them, and the Zig core stops handing out
   * renderables a few thousand in — expanding a directory of 8000 files used to
   * leave the tree blank.
   *
   * Sized from the terminal rather than fixed: the window has to cover the whole
   * viewport, and the tree can never be taller than the screen. A constant 200 left
   * the bottom of the tree empty on a terminal past ~160 rows.
   */
  const OVERSCAN = 40
  const page = () => dimensions().height + 2 * OVERSCAN
  const visible = createMemo(() => {
    const start = Math.max(0, Math.min(scrollTop() - OVERSCAN, props.nodes.length - page()))
    return { start, nodes: props.nodes.slice(start, start + page()) }
  })

  /**
   * Bring `row` into view on the next macrotask rather than now.
   *
   * Revealing a file expands its parents, so the row list grows in the same tick the
   * selection moves. The scrollbox clamps `scrollTop` against a content height that
   * layout has not recomputed yet, so scrolling immediately is silently clamped to 0
   * and the file stays off-screen. One tick later the extent is real.
   */
  let pendingScroll: ReturnType<typeof setTimeout> | null = null
  onCleanup(() => {
    if (pendingScroll) clearTimeout(pendingScroll)
  })

  const revealRow = (row: number) => {
    if (pendingScroll) clearTimeout(pendingScroll)
    pendingScroll = setTimeout(() => {
      pendingScroll = null
      if (!box) return
      const height = box.viewport.height
      if (row < box.scrollTop) box.scrollTop = row
      else if (row >= box.scrollTop + height) box.scrollTop = row - height + 1
      // Read it back: the scrollbox clamps to its own extent, and a window built
      // from a position the box never reached renders the wrong slice.
      setScrollTop(box.scrollTop)
    }, 0)
  }

  /**
   * The selection moves for reasons the tree cannot see — arrow keys, but also a tab
   * switch or a jump from search — and a highlight scrolled out of view reads as no
   * highlight at all.
   *
   * Keyed on the selected row's index, which is exactly what the scroll depends on,
   * and that precision is load-bearing three times over:
   *
   * - `nodes` is a fresh array on every git refresh. Tracking the array would yank a
   *   mouse-scrolled tree back every few seconds; the index is unchanged, so nothing
   *   happens.
   * - `focused` would snap the view back on every Tab or Esc — scroll away from the
   *   selection to read something, move focus, and it jumps although nothing was
   *   chosen. Navigating changes the index, so an arrow key still reveals the cursor.
   * - Opening a file from the picker expands its parents, which moves the row *after*
   *   the selection changed. Keying on the path alone would scroll to the old index
   *   and leave the file off-screen.
   */
  const selectedRow = createMemo(() =>
    props.nodes.findIndex(node => node.path === props.selectedPath),
  )

  createEffect(
    on(selectedRow, row => {
      if (row >= 0) revealRow(row)
    }),
  )

  /**
   * The scrollbox emits no scroll event, so the window is refreshed from the
   * renderable's own mouse hook — the same override EditorPane uses. Every mouse
   * type is checked, not just `scroll`: dragging its own scrollbar moves the view
   * too, and a window left behind renders the wrong slice.
   */
  const followScroll = (el: ScrollBoxRenderable) => {
    const host = el as unknown as { onMouseEvent: (event: MouseEvent) => void }
    const handle = host.onMouseEvent.bind(host)
    host.onMouseEvent = (event: MouseEvent) => {
      handle(event)
      if (el.scrollTop !== scrollTop()) setScrollTop(el.scrollTop)
    }
  }

  // OpenTUI has no double-click event, so detect it from consecutive downs.
  let lastClick = { path: '', at: 0 }

  const click = (node: TreeNode) => {
    props.onFocus()
    const now = Date.now()
    const isDouble = lastClick.path === node.path && now - lastClick.at < DOUBLE_CLICK_MS
    lastClick = { path: node.path, at: now }
    // Activating a folder toggles it, so the second click of a double-click would
    // close what the first one opened and the folder would look inert.
    if (isDouble && node.isDir) return
    props.onActivate(node)
    if (isDouble) props.onPin(node)
  }

  /**
   * Drag and drop. The row that was pressed is only remembered here — it becomes a
   * drag once a drag event actually arrives, so an ordinary click still selects and
   * opens as it always did.
   */
  let pressed: TreeNode | null = null
  const [dragged, setDragged] = createSignal<TreeNode | null>(null)
  /** Folder the pointer is currently over, which is where a release would drop. */
  const [dropDir, setDropDir] = createSignal<string | null>(null)

  /** Row index under a screen row, whether or not anything is there. */
  const rowAt = (screenY: number) => scrollTop() + screenY - (box?.y ?? 0)

  const aim = (screenY: number) => {
    const node = props.nodes[rowAt(screenY)]
    // Over a file, the destination is the folder holding it — dropping "onto" a file
    // can only sensibly mean "in with that file".
    setDropDir(node ? (node.isDir ? node.path : dirname(node.path)) : null)
  }

  const finishDrag = () => {
    const node = dragged()
    const dir = dropDir()
    pressed = null
    setDragged(null)
    setDropDir(null)
    if (node && dir) props.onMove(node.path, dir)
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
      {/* Drag handling sits on the scrollbox, not the rows: a row is one line tall,
          so the pointer leaves it on the first movement, and each event goes to
          whatever it is over at the time. */}
      <scrollbox
        ref={el => {
          box = el
          followScroll(el)
        }}
        flexGrow={1}
        backgroundColor={ui.panelBg}
        scrollbarOptions={{
          trackOptions: { foregroundColor: ui.scrollbar, backgroundColor: ui.panelBg },
        }}
        onMouseDrag={(event: MouseEvent) => {
          if (!pressed) return
          setDragged(pressed)
          aim(event.y)
        }}
        /* `up`, not `drop` or `drag-end`: those two are only delivered to a
           renderable the renderer has taken capture of, which does not happen for
           these rows — verified by logging every type the scrollbox sees during a
           drag. `up` bubbles here from the row under the pointer, which is all this
           needs, since `dropDir` was worked out while dragging. It arrives twice;
           `finishDrag` clears its own state, so the second is a no-op. */
        onMouseUp={finishDrag}
      >
        {/* Spacers keep the scrollable extent honest while only a window exists. */}
        <box height={visible().start} flexShrink={0} backgroundColor={ui.panelBg} />
        <For each={visible().nodes}>
          {node => {
            const selected = () =>
              node.path === props.selectedPath || props.markedPaths.includes(node.path)
            const bg = () =>
              selected() ? (props.focused ? ui.treeSelectedBg : ui.treeFocusBg) : ui.panelBg
            /** Waiting to be moved, by either route: drawn as already gone. */
            const leaving = () =>
              props.cutPaths.includes(node.path) || node.path === dragged()?.path
            const isTarget = () => dropDir() === node.path
            // The destination is marked in the arrow column rather than by a
            // background: selection already owns the background, and two highlights
            // that mean different things are worse than none.
            const arrow = () =>
              isTarget() ? '→' : node.isDir ? (props.expanded.has(node.path) ? '▾' : '▸') : '·'
            const status = () => statusOf(node)
            const nameColor = () =>
              leaving()
                ? ui.faint
                : isTarget()
                  ? ui.accent
                  : status()
                    ? statusColor(status()!)
                    : node.isDir
                      ? ui.folder
                      : ui.text
            return (
              <box
                height={1}
                flexDirection="row"
                backgroundColor={bg()}
                /* Activation waits for the release. A press that turns out to be
                   the start of a drag must not toggle the folder underneath it —
                   doing that collapsed the very folder being dragged and took the
                   destination rows off the screen mid-gesture. */
                onMouseDown={() => {
                  pressed = node
                  props.onFocus()
                }}
                onMouseUp={() => {
                  if (!dragged()) click(node)
                }}
              >
                {/* Everything but the name is flexShrink={0}. Flex shrinks every
                    item by default, so one long filename squeezed the indent and
                    the arrow and slid the row's glyphs a column left — which made
                    them jump around as a resize changed which rows overflow. The
                    name is the only thing allowed to give. */}
                <text
                  fg={ui.faint}
                  bg={bg()}
                  flexShrink={0}
                  content={` ${'│ '.repeat(node.depth)}`}
                />
                <text
                  fg={isTarget() ? ui.accent : node.isDir ? ui.dim : ui.faint}
                  bg={bg()}
                  flexShrink={0}
                  content={`${arrow()} `}
                />
                {/* The name takes the slack, so the mark is pushed to the panel's
                    right edge and every mark lines up in one column. */}
                <box flexGrow={1} backgroundColor={bg()}>
                  <text
                    fg={nameColor()}
                    bg={bg()}
                    content={node.name}
                    attributes={node.isDir || isTarget() ? TextAttributes.BOLD : undefined}
                  />
                </box>
                <Show when={status()}>
                  {(status: () => FileStatus) => (
                    <text
                      fg={statusColor(status())}
                      bg={bg()}
                      flexShrink={0}
                      content={`${MARKS[status()]} `}
                    />
                  )}
                </Show>
              </box>
            )
          }}
        </For>
        <box
          height={Math.max(0, props.nodes.length - visible().start - visible().nodes.length)}
          flexShrink={0}
          backgroundColor={ui.panelBg}
        />
      </scrollbox>
    </box>
  )
}

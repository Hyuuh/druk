import { dirname, join } from 'node:path'

import { createMemo, createSignal } from 'solid-js'

import { flattenVisible } from '../core/fs'

/** File-tree state: which folders are open, where the cursor is, what is marked. */
export function createTree(
  rootDir: string,
  initial: { expanded: string[]; selected: string | null },
) {
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set(initial.expanded))
  const [selectedPath, setSelectedPath] = createSignal<string | null>(initial.selected)
  /**
   * Rows picked out with Shift+↑/↓, in tree order. Empty for the ordinary case of
   * one row under the cursor — `actionTargets` is what reconciles the two, so no
   * action has to care which of the pair it is looking at.
   */
  const [marked, setMarked] = createSignal<string[]>([])
  /** Row the current range grows from; null when there is no range. */
  const [anchor, setAnchor] = createSignal<string | null>(null)

  const nodes = createMemo(() => flattenVisible(rootDir, expanded()))

  // Bump the Set identity so `nodes` recomputes and re-reads the filesystem.
  const refreshTree = () => setExpanded(prev => new Set(prev))
  const expand = (path: string) => setExpanded(prev => new Set(prev).add(path))

  const toggleExpand = (path: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  /** Expand every folder above `path` so the tree actually has a row for it. */
  const reveal = (path: string) => {
    const parts = path.startsWith(rootDir) ? path.slice(rootDir.length + 1).split('/') : []
    if (parts.length < 2) return
    setExpanded(prev => {
      const next = new Set(prev)
      let dir = rootDir
      for (const part of parts.slice(0, -1)) {
        dir = join(dir, part)
        next.add(dir)
      }
      // Same identity when nothing opened: `expanded` also drives the git-status
      // effect, so a fresh Set here costs a whole-repo `git status` on every file
      // open and every tab switch, neither of which touches the working tree.
      return next.size === prev.size ? prev : next
    })
  }

  const clearMarks = () => {
    setMarked([])
    setAnchor(null)
  }

  const moveSelection = (delta: number) => {
    const rows = nodes()
    if (rows.length === 0) return
    const idx = rows.findIndex(n => n.path === selectedPath())
    // From no selection, land on the first row regardless of direction.
    const next = idx < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, idx + delta))
    setSelectedPath(rows[next]!.path)
    clearMarks()
  }

  /**
   * Shift+↑/↓: move the cursor and drag a range along behind it.
   *
   * Over the rows as they are displayed, so a range is exactly what you saw between
   * the two ends — a collapsed folder counts as the one row it draws, not as the
   * files inside it. The anchor is where the range started and does not move, so
   * reversing direction shrinks the range instead of leaving a stranded end.
   */
  const extendSelection = (delta: number) => {
    const rows = nodes()
    const head = rows.findIndex(n => n.path === selectedPath())
    if (rows.length === 0 || head < 0) return moveSelection(delta)

    const from = anchor() ?? rows[head]!.path
    if (!anchor()) setAnchor(from)
    const start = rows.findIndex(n => n.path === from)
    const next = Math.max(0, Math.min(rows.length - 1, head + delta))
    const [lo, hi] = start <= next ? [start, next] : [next, start]

    setMarked(rows.slice(lo, hi + 1).map(n => n.path))
    setSelectedPath(rows[next]!.path)
  }

  /** Everything an action should apply to: the marked rows, else the cursor's row. */
  const actionTargets = (): string[] => {
    const all = marked()
    if (all.length > 0) return all
    const path = selectedPath()
    return path ? [path] : []
  }

  const selectedNode = () => nodes().find(n => n.path === selectedPath())

  const targetDir = () => {
    const node = selectedNode()
    if (!node) return rootDir
    return node.isDir ? node.path : dirname(node.path)
  }

  /** Fresh Set identity, so this doubles as the tree refresh. */
  const remapExpanded = (remap: (path: string) => string) =>
    setExpanded(prev => new Set([...prev].map(remap)))

  return {
    expanded,
    selectedPath,
    setSelectedPath,
    marked,
    nodes,
    refreshTree,
    expand,
    toggleExpand,
    reveal,
    clearMarks,
    moveSelection,
    extendSelection,
    actionTargets,
    selectedNode,
    targetDir,
    remapExpanded,
  }
}

export type Tree = ReturnType<typeof createTree>

import { createSignal } from 'solid-js'

import type { Tree } from './tree'
import type { Focus } from './types'

/** Which pane the keyboard belongs to, and whether the sidebar is on screen. */
export function createPanes(tree: Tree, initialSidebar: boolean) {
  const [sidebar, setSidebar] = createSignal(initialSidebar)
  const [focus, setFocus] = createSignal<Focus>(initialSidebar ? 'tree' : 'editor')

  // Focus is useless without a visible cursor: a file opened from the picker or a
  // tab may sit in a collapsed folder, leaving no row to highlight.
  const focusTree = () => {
    const path = tree.selectedPath()
    if (path) tree.reveal(path)
    if (!tree.nodes().some(n => n.path === tree.selectedPath())) {
      tree.setSelectedPath(tree.nodes()[0]?.path ?? null)
    }
    setFocus('tree')
  }

  const toggleSidebar = () => {
    if (sidebar()) {
      setSidebar(false)
      setFocus('editor')
      return
    }
    setSidebar(true)
    focusTree()
  }

  return { sidebar, focus, setFocus, focusTree, toggleSidebar }
}

export type Panes = ReturnType<typeof createPanes>

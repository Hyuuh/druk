import { createSignal } from 'solid-js'

import type { KeyScope } from '../ui/keys'
import type { Tree } from './tree'
import type { Focus } from './types'

/** Which pane the keyboard belongs to, whether the sidebar is on screen, and
 * which of its two views — the file tree or the source-control panel — it shows. */
export function createPanes(tree: Tree, initialSidebar: boolean) {
  const [sidebar, setSidebar] = createSignal(initialSidebar)
  const [focus, setFocus] = createSignal<Focus>(initialSidebar ? 'tree' : 'editor')
  const [view, setView] = createSignal<'files' | 'git'>('files')
  /** Row under the cursor in the source-control panel; clamped where it is read,
   * because the change list shrinks under it on every commit. */
  const [gitCursor, setGitCursor] = createSignal(0)

  // Focus is useless without a visible cursor: a file opened from the picker or a
  // tab may sit in a collapsed folder, leaving no row to highlight.
  const focusTree = () => {
    // The source-control panel borrows this focus slot. Revealing here would
    // expand folders in a tree that is not on screen, and the expansion would
    // still be there when it comes back.
    if (view() === 'git') return setFocus('tree')
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

  /** Open the sidebar on one of its views, as the tab strip above it does. */
  const showView = (next: 'files' | 'git') => {
    setView(next)
    setSidebar(true)
    focusTree()
  }

  /** Ctrl+Opt+G, as VS Code's Ctrl+Shift+G: show the panel, or put the tree back. */
  const toggleGitView = () => {
    if (sidebar() && view() === 'git') return showView('files')
    showView('git')
  }

  /** Which keymap is live, for the peek strip: the panel has its own keys and
   * shows under the tree's focus. */
  const keyPane = (): KeyScope => (focus() === 'tree' && view() === 'git' ? 'git' : focus())

  return {
    sidebar,
    focus,
    setFocus,
    focusTree,
    toggleSidebar,
    view,
    showView,
    toggleGitView,
    keyPane,
    gitCursor,
    setGitCursor,
  }
}

export type Panes = ReturnType<typeof createPanes>

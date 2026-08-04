import { createSignal } from 'solid-js'

import type { Panes } from './panes'
import type { Tree } from './tree'

/** What the preview pane is showing: a file to read, or the folder it sits on. */
export interface PreviewTarget {
  path: string
  isDir: boolean
}

/**
 * Quick look: the row under the tree's cursor drawn over the editor slot, with no
 * tab opened and no buffer loaded. Walking the tree is the whole interaction — the
 * pane follows the cursor — so this is a mode the tree is in rather than a view of
 * its own, and it belongs to the tree's focus: hand the keyboard to the editor and
 * the editor's own tab is back on screen.
 */
export function createPreview(deps: { tree: Tree; panes: Panes }) {
  const { tree, panes } = deps
  const [on, setOn] = createSignal(false)
  /**
   * The tree keeps the keyboard while it previews, so the page keys have to reach
   * the pane from there. A ticket rather than a scroll position: the pane owns how
   * tall a page is, and two pages down in a row must not read as no change.
   */
  const [scrollRequest, setScrollRequest] = createSignal<{ pages: number; at: number } | null>(null)
  let ticket = 0

  const target = (): PreviewTarget | null => {
    if (!on() || !panes.sidebar() || panes.view() !== 'files' || panes.focus() !== 'tree') {
      return null
    }
    const node = tree.selectedNode()
    return node ? { path: node.path, isDir: node.isDir } : null
  }

  return {
    on,
    target,
    open: () => setOn(true),
    close: () => setOn(false),
    toggle: () => setOn(previewing => !previewing),
    scroll: (pages: number) => setScrollRequest({ pages, at: ++ticket }),
    scrollRequest,
  }
}

export type Preview = ReturnType<typeof createPreview>

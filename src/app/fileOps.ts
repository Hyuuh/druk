import { basename, dirname, join, relative } from 'node:path'

import { createSignal } from 'solid-js'

import { copyAll, moveAll, removeAll } from '../core/bulk'
import { copyToClipboard } from '../core/clipboard'
import { exists, freePath, rename } from '../core/fs'
import type { Status } from './status'
import type { Tree } from './tree'
import type { Workspace } from './workspace'

/** Moving, copying and deleting files — single, batched, and via the x/c/p clipboard. */
export function createFileOps(deps: {
  rootDir: string
  status: Status
  tree: Tree
  workspace: Workspace
  renderer: { copyToClipboardOSC52: (text: string) => void }
}) {
  const { rootDir, status, tree, workspace, renderer } = deps
  const { say, setBusy, whileFree } = status

  /**
   * Rows taken with `x` or `c`, waiting for the `p` that says where they go. A cut
   * is spent by the paste; a copy is not, so the same thing can be dropped in
   * several places without picking it up again.
   */
  const [clipboard, setClipboard] = createSignal<{ paths: string[]; mode: 'cut' | 'copy' }>({
    paths: [],
    mode: 'cut',
  })
  /** Only a cut greys its rows: a copy leaves the original exactly where it is. */
  const cut = () => (clipboard().mode === 'cut' ? clipboard().paths : [])

  /**
   * Point everything that remembers a path at where the file went: open tabs, their
   * buffers, the active and preview tabs, the selection and the expanded folders.
   * Paths *under* `from` move with it — a buffer left pointing at the old path
   * saves the file back to where it used to be, recreating the folder just moved.
   */
  const adoptMove = (from: string, to: string) => {
    const inside = `${from}/`
    const remap = (path: string) =>
      path === from ? to : path.startsWith(inside) ? to + path.slice(from.length) : path

    workspace.remapPaths(remap)
    tree.setSelectedPath(to)
    tree.remapExpanded(remap)
  }

  const movePath = (from: string, to: string): string | null => {
    const err = rename(from, to)
    if (err) return err
    adoptMove(from, to)
    return null
  }

  /** `dir` is `path` itself or sits inside it — moving or copying there is circular. */
  const within = (dir: string, path: string) => dir === path || dir.startsWith(`${path}/`)

  /**
   * Why one path cannot go into `dir`, or null when it can. Separated from doing the
   * move so a batch can report which of its files were refused and still move the rest.
   */
  const whyNotMove = (path: string, dir: string): string | null => {
    if (dirname(path) === dir) return `${basename(path)} is already there`
    // A folder cannot be moved inside itself: the destination would travel with the
    // source, and `fs.renameSync` reports EINVAL for it.
    if (within(dir, path)) return `Cannot move ${basename(path)} into itself`
    return null
  }

  /** Move `path` into the folder `dir`, refusing the moves that cannot mean anything. */
  const moveInto = (path: string, dir: string) => {
    const refused = whyNotMove(path, dir)
    if (refused) return say(refused, 'warn')
    const err = movePath(path, join(dir, basename(path)))
    if (err) return say(err, 'error')
    tree.expand(dir)
    say(`Moved ${basename(path)} to ${relative(rootDir, dir) || basename(rootDir)}/`)
  }

  /**
   * Move several into `dir`. One refusal does not stop the others — a range selection
   * routinely includes the destination folder itself, and failing the whole batch for
   * that would be maddening.
   */
  const moveAllInto = (paths: string[], dir: string) => {
    if (paths.length === 1) return moveInto(paths[0]!, dir)
    // Refusals are decided up front — they are cheap checks, and the ones that
    // survive go through the incremental mover so the bar can count them.
    const refused: string[] = []
    const movable = paths.filter(path => {
      if (!whyNotMove(path, dir)) return true
      refused.push(basename(path))
      return false
    })
    tree.clearMarks()

    whileFree(
      () =>
        void (async () => {
          setBusy({ label: 'Moving', done: 0, total: movable.length })
          const { done, failed, moved } = await moveAll(
            movable,
            dir,
            (into, base) => join(into, base),
            progress => setBusy({ label: 'Moving', done: progress.done, total: progress.total }),
          )
          setBusy(null)
          // Tabs, buffers and the selection follow the files, exactly as they do
          // when a single file is moved.
          for (const { from, to } of moved) adoptMove(from, to)
          if (done > 0) tree.expand(dir)
          tree.refreshTree()
          const where = relative(rootDir, dir) || basename(rootDir)
          const left = [...refused, ...failed]
          if (left.length === 0) return say(`Moved ${done} items to ${where}/`)
          say(`Moved ${done} to ${where}/ — left ${left.join(', ')}`, 'warn')
        })(),
    )
  }

  const copyAllInto = (paths: string[], dir: string) => {
    // A folder cannot be copied into itself: the copy would walk the copy it is
    // writing. Its own parent is fine, and is how a folder gets duplicated.
    const refused: string[] = []
    const copyable = paths.filter(path => {
      if (!within(dir, path)) return true
      refused.push(basename(path))
      return false
    })
    tree.clearMarks()
    // Nothing left to do: say why rather than reporting "copied 0 items", which
    // describes the outcome without naming the reason.
    if (copyable.length === 0) {
      return say(`Cannot copy ${refused.join(', ')} into itself`, 'warn')
    }

    whileFree(
      () =>
        void (async () => {
          setBusy({ label: 'Copying', done: 0, total: copyable.length })
          const { done, failed } = await copyAll(copyable, dir, freePath, progress =>
            setBusy({ label: 'Copying', done: progress.done, total: progress.total }),
          )
          setBusy(null)
          if (done === 0) return
          tree.expand(dir)
          tree.refreshTree()
          const where = relative(rootDir, dir) || basename(rootDir)
          const what = done === 1 ? basename(copyable[0]!) : `${done} items`
          const left = [...refused, ...failed]
          if (left.length > 0) return say(`Copied ${what} — left ${left.join(', ')}`, 'warn')
          say(`Copied ${what} to ${where}/`)
        })(),
    )
  }

  /** Take the selection for a move or a copy; `p` drops it into the folder chosen next. */
  const takeForPaste = (mode: 'cut' | 'copy') => {
    const targets = tree.actionTargets()
    if (targets.length === 0) return say('Nothing selected', 'warn')
    setClipboard({ paths: targets, mode })
    tree.clearMarks()
    const what = targets.length === 1 ? basename(targets[0]!) : `${targets.length} items`
    const verb = mode === 'cut' ? 'Cut' : 'Copied'
    say(`${verb} ${what} — press p on the folder to ${mode === 'cut' ? 'move' : 'copy'} into`)
  }

  /** Complete an `x` or `c` into whatever folder the selection is in or on. */
  const paste = () => {
    const { paths, mode } = clipboard()
    if (paths.length === 0) {
      return say('Nothing taken — press x or c on a file or folder first', 'warn')
    }
    const from = paths.filter(path => exists(path))
    // A copy stays on the clipboard: pasting it twice is a reasonable thing to want.
    if (mode === 'cut') setClipboard({ paths: [], mode: 'cut' })
    if (from.length === 0) return say(`What was ${mode} is gone`, 'warn')
    if (mode === 'cut') moveAllInto(from, tree.targetDir())
    else copyAllInto(from, tree.targetDir())
  }

  /**
   * Put a file's own path on the system clipboard — the string, not the file, so
   * this shares nothing with the `x`/`c`/`p` clipboard above. A path outside the
   * project has no relative form worth pasting (`../../..` to somewhere the reader
   * cannot see), so `relative` falls back to the absolute path and says so.
   */
  const copyPath = (path: string, kind: 'absolute' | 'relative') => {
    const rel = relative(rootDir, path)
    const outside = rel.startsWith('..')
    const text = kind === 'relative' && !outside ? rel : path

    copyToClipboard(text)
    // Both routes, as the editor's Ctrl+C does, and the return value is ignored for
    // the same reason: the subprocess reaches this machine's clipboard, the escape
    // sequence reaches the terminal's own — which over SSH is the one the user is
    // sitting at, and is the one that worked when no pbcopy/xclip exists here.
    renderer.copyToClipboardOSC52(text)
    if (kind === 'relative' && outside) return say(`Copied ${text} — outside the project`, 'warn')
    say(`Copied ${text}`)
  }

  /** Esc: drop what `x` or `c` took, so `p` no longer fires. */
  const cancelTake = () => {
    const cancelled = clipboard().mode === 'cut' ? 'Move' : 'Copy'
    setClipboard({ paths: [], mode: 'cut' })
    say(`${cancelled} cancelled`)
  }

  /** Carry out a confirmed delete: close affected tabs, remove, re-land the cursor. */
  const deleteTargets = (targets: string[]) => {
    for (const target of targets) {
      if (workspace.tabs().includes(target)) workspace.closeTab(target, true)
    }
    // Land on whatever took the deleted row's place, rather than clearing
    // the selection: with nothing selected the next arrow key jumps back to
    // the top of the tree instead of carrying on from here.
    const gone = tree.selectedPath()
    const wasAt = gone && targets.includes(gone) ? tree.nodes().findIndex(n => n.path === gone) : -1
    tree.clearMarks()

    whileFree(
      () =>
        void (async () => {
          setBusy({ label: 'Deleting', done: 0, total: 0 })
          const { failed } = await removeAll(targets, progress =>
            setBusy({ label: 'Deleting', done: progress.done, total: progress.total }),
          )
          setBusy(null)
          tree.refreshTree()
          if (wasAt >= 0) {
            const rows = tree.nodes()
            tree.setSelectedPath(rows[Math.min(wasAt, rows.length - 1)]?.path ?? null)
          }
          if (failed.length > 0) return say(`Could not delete ${failed.join(', ')}`, 'error')
          say(
            targets.length === 1
              ? `Deleted ${basename(targets[0]!)}`
              : `Deleted ${targets.length} items`,
          )
        })(),
    )
  }

  return {
    clipboard,
    cut,
    movePath,
    moveInto,
    moveAllInto,
    copyAllInto,
    takeForPaste,
    copyPath,
    paste,
    cancelTake,
    deleteTargets,
  }
}

export type FileOps = ReturnType<typeof createFileOps>

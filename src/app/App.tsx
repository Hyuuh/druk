import { basename, dirname, join, relative } from 'node:path'

import type { KeyEvent, MouseEvent } from '@opentui/core'
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import { createStore, produce, unwrap } from 'solid-js/store'

import { copyAll, moveAll, removeAll } from '../core/bulk'
import { saveConfig, sidebarColumns, SIDEBAR_MIN, SIDEBAR_MAX } from '../core/config'
import type { Config } from '../core/config'
import type { TreeNode } from '../core/fs'
import {
  BinaryFileError,
  createDir,
  createFile,
  exists,
  freePath,
  flattenVisible,
  isDirectory,
  mtimeOf,
  readFile,
  rename,
  watchTree,
  writeFile,
} from '../core/fs'
import { currentBranch, diffLines, statusMap, upstreamOf } from '../core/git'
import type { FileStatus, LineChange, Upstream } from '../core/git'
import type { Match } from '../core/search'
import { replaceAll, replaceMatch } from '../core/search'
import { loadSession, saveSession } from '../core/session'
import { checkForUpdate } from '../core/update'
import type { UpdateInfo } from '../core/update'
import type { VimMode } from '../editor/vim'
import { languageLabel } from '../languages'
import { filetypeForPath, invalidateSyntaxStyle } from '../languages/highlight'
import { setTheme, themeLabels, ui } from '../themes'
import type { ThemeName } from '../themes'
import { ChoiceModal } from '../ui/ChoiceModal'
import { CommandPalette } from '../ui/CommandPalette'
import { ConfirmModal } from '../ui/ConfirmModal'
import { EditorPane } from '../ui/EditorPane'
import { FilePicker } from '../ui/FilePicker'
import { FileTree } from '../ui/FileTree'
import { HelpOverlay } from '../ui/HelpOverlay'
import { PromptModal } from '../ui/PromptModal'
import { SearchPanel } from '../ui/SearchPanel'
import type { SearchScope } from '../ui/SearchPanel'
import { StatusBar } from '../ui/StatusBar'
import type { Tone } from '../ui/StatusBar'
import { Tabs } from '../ui/Tabs'
import { UpdateBanner } from '../ui/UpdateBanner'
import { buildCommands } from './commands'

type Focus = 'tree' | 'editor'

interface Buffer {
  content: string
  dirty: boolean
  /** Disk mtime this buffer was last in sync with; used to detect outside edits. */
  mtime: number
}
/** Dirty buffers a disk sync refused to touch, split by what happened to the file. */
interface DiskSync {
  changed: string[]
  deleted: string[]
}

/** An unsaved buffer whose file also changed on disk. */
interface Conflict {
  path: string
  disk: string
  /** The file is gone: there is no outside version to accept. */
  deleted: boolean
}
type Prompt =
  | { kind: 'gotoLine' }
  | { kind: 'newFile'; dir: string }
  | { kind: 'newFolder'; dir: string }
  | { kind: 'rename'; target: string }
  | { kind: 'delete'; targets: string[] }
  | { kind: 'closeDirty'; paths: string[]; names: string[] }
  | { kind: 'quitDirty'; names: string[] }
  | null

type PromptKind = NonNullable<Prompt>['kind']

/** What a yes/no prompt asks and how loudly it asks it. */
interface Confirmation {
  title: string
  message: string
  verb: string
  danger: boolean
}

/**
 * Prompts answered with text, and the title their input box carries. Having a
 * title here is what makes a prompt a text prompt — every other kind is a
 * yes/no confirm, so the two sets can never fall out of step.
 */
/** Columns the editor keeps for itself, whatever width the sidebar was saved at. */
const EDITOR_MIN = 20

/** True for Ctrl+Opt+<key>, however this terminal spells the second modifier. */
const chord = (key: KeyEvent) => key.shift || key.option || key.meta

/** Idle: the footer shows contextual key hints instead of a message. */
/** Rows the divider's grip occupies — long enough to aim at, short enough to be a grip. */
const GRIP = [0, 1, 2, 3, 4]

const READY = ''
/**
 * Prefixes of the watcher's clash warnings, so it can recognise its own message and
 * clear it again. A deleted file is not a changed one — saying "changed" for a file
 * that is gone sends the user looking for a diff that does not exist.
 */
const CLASH_CHANGED = 'Changed on disk with unsaved edits: '
const CLASH_DELETED = 'Deleted on disk with unsaved edits: '

const PROMPT_TITLES: Partial<Record<PromptKind, string>> = {
  newFile: 'New file name',
  newFolder: 'New folder name',
  rename: 'Rename to',
  gotoLine: 'Go to line',
}

export function App(props: {
  rootDir: string
  /** `druk file.ts`: the one file to open, instead of the project's saved session. */
  openFile?: string | null
  initialConfig: Config
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const rootDir = props.rootDir
  const single = props.openFile ?? null

  // Restored synchronously: the editor must mount with its buffers already in
  // place, otherwise it renders an empty document and marks it modified.
  const restored = (() => {
    // Asked for one file, so that is what opens: no saved tabs, no expanded folders,
    // and the sidebar out of the way. The session is neither read nor written — the
    // folder's own layout is not this invocation's to inherit or to overwrite.
    if (single) {
      try {
        const buffer = { content: readFile(single), dirty: false, mtime: mtimeOf(single) }
        return {
          buffers: { [single]: buffer },
          tabs: [single],
          activePath: single as string | null,
          expanded: [] as string[],
          sidebar: false,
          failed: null as string | null,
        }
      } catch (e) {
        // Unreadable or not text. The editor still starts — with nothing open, and
        // the reason on the status bar once there is a status bar to put it on.
        return {
          buffers: {},
          tabs: [],
          activePath: null,
          expanded: [] as string[],
          sidebar: false,
          failed:
            e instanceof BinaryFileError
              ? 'It is binary, or uses an encoding druk cannot read.'
              : (e as Error).message,
        }
      }
    }
    const saved = loadSession(rootDir)
    const buffers: Record<string, Buffer> = {}
    for (const path of saved.tabs) {
      try {
        buffers[path] = { content: readFile(path), dirty: false, mtime: mtimeOf(path) }
      } catch {
        // unreadable since last time — the tab is dropped below
      }
    }
    const tabs = saved.tabs.filter(path => buffers[path])
    const activePath =
      saved.activePath && buffers[saved.activePath] ? saved.activePath : (tabs[0] ?? null)
    return {
      buffers,
      tabs,
      activePath,
      expanded: saved.expanded,
      sidebar: saved.sidebar,
      failed: null as string | null,
    }
  })()

  const [config, setConfig] = createStore<Config>({ ...props.initialConfig })
  const [buffers, setBuffers] = createStore<Record<string, Buffer>>(restored.buffers)
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set(restored.expanded))
  const [selectedPath, setSelectedPath] = createSignal<string | null>(restored.activePath)
  /**
   * Rows picked out with Shift+↑/↓, in tree order. Empty for the ordinary case of
   * one row under the cursor — `actionTargets` is what reconciles the two, so no
   * action has to care which of the pair it is looking at.
   */
  const [marked, setMarked] = createSignal<string[]>([])
  /** Row the current range grows from; null when there is no range. */
  const [anchor, setAnchor] = createSignal<string | null>(null)
  /** A file that would not open, shown over the editor until the next keypress. */
  const [notice, setNotice] = createSignal<{ name: string; reason: string } | null>(null)
  const [tabs, setTabs] = createSignal<string[]>(restored.tabs)
  const [activePath, setActivePath] = createSignal<string | null>(restored.activePath)
  // Preview tab (VS Code style): opened from the tree, reused by the next
  // preview, and promoted to a permanent tab on click, double-click or edit.
  const [previewPath, setPreviewPath] = createSignal<string | null>(null)
  const [sidebar, setSidebar] = createSignal(restored.sidebar)
  const [focus, setFocus] = createSignal<Focus>(restored.sidebar ? 'tree' : 'editor')
  const [prompt, setPrompt] = createSignal<Prompt>(null)
  const [help, setHelp] = createSignal(false)
  const [palette, setPalette] = createSignal(false)
  const [vimMode, setVimMode] = createSignal<VimMode | null>(
    props.initialConfig.vim ? 'normal' : null,
  )
  const [reloadKey, setReloadKey] = createSignal(0)
  const [conflict, setConflict] = createSignal<Conflict | null>(null)
  /** Open search: its scope, and whether the replacement field starts showing. */
  const [search, setSearch] = createSignal<{ scope: SearchScope; replacing?: boolean } | null>(null)
  /**
   * What is selected on screen, for search to open with. One line only: a query
   * spanning a newline matches nothing, so carrying it over would just look broken.
   */
  const selection = () => {
    const text = renderer.getSelection()?.getSelectedText() ?? ''
    return text.includes('\n') ? '' : text
  }
  const [picker, setPicker] = createSignal<'files' | 'tabs' | null>(null)
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
  const [update, setUpdate] = createSignal<UpdateInfo | null>(null)
  const [gitLines, setGitLines] = createSignal<Map<number, LineChange>>(new Map())
  /** Bumped when something may have changed what git would report. */
  const [gitRevision, setGitRevision] = createSignal(0)
  const [gitStatus, setGitStatus] = createSignal<Map<string, FileStatus>>(new Map())
  const [branch, setBranch] = createSignal(currentBranch(rootDir))
  const [upstream, setUpstream] = createSignal<Upstream | null>(null)
  /** True between grabbing the sidebar divider and letting go. */
  const [resizing, setResizing] = createSignal(false)
  const [history, setHistory] = createSignal<{ kind: 'undo' | 'redo'; key: number } | null>(null)
  const [goto, setGoto] = createSignal<{ line: number; col: number; key: number } | null>(null)
  const [cursor, setCursor] = createSignal({ line: 0, col: 0 })
  /** A long file operation in flight, so the bar can count instead of freezing. */
  const [busy, setBusy] = createSignal<{ label: string; done: number; total: number } | null>(null)

  const [status, setStatus] = createSignal<{ msg: string; tone: Tone }>({
    msg: READY,
    tone: 'info',
  })

  const nodes = createMemo(() => flattenVisible(rootDir, expanded()))
  const activeBuffer = () => {
    const path = activePath()
    return path ? buffers[path] : undefined
  }

  /** True while a modal or overlay owns the keyboard. One list, two readers. */
  const overlay = createMemo(
    () => !!(prompt() || palette() || conflict() || help() || search() || update() || picker()),
  )

  const dirtyPaths = () => Object.keys(unwrap(buffers)).filter(path => buffers[path]?.dirty)

  const quit = (discardUnsaved = false) => {
    const dirty = dirtyPaths()
    if (!discardUnsaved && dirty.length > 0) {
      return setPrompt({ kind: 'quitDirty', names: dirty.map(path => basename(path)) })
    }
    renderer.destroy()
    process.exit(0)
  }

  const say = (msg: string, tone: Tone = 'info') => setStatus({ msg, tone })

  /**
   * One at a time. The operations run in the background now, so a second delete
   * started while the first is going would share the one progress slot and clear
   * it early — and both would be rewriting the same tree underneath each other.
   */
  const whileFree = (run: () => void) => {
    const running = busy()
    if (running) return say(`${running.label} already — let it finish`, 'warn')
    run()
  }
  // Bump the Set identity so `nodes` recomputes and re-reads the filesystem.
  const refreshTree = () => setExpanded(prev => new Set(prev))
  const expand = (path: string) => setExpanded(prev => new Set(prev).add(path))
  const discardBuffer = (path: string) => setBuffers(produce(draft => void delete draft[path]))

  const patchConfig = (patch: Partial<Config>) => {
    setConfig(patch)
    saveConfig(unwrap(config))
  }

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

  // Focus is useless without a visible cursor: a file opened from the picker or a
  // tab may sit in a collapsed folder, leaving no row to highlight.
  const focusTree = () => {
    const path = selectedPath()
    if (path) reveal(path)
    if (!nodes().some(n => n.path === selectedPath())) setSelectedPath(nodes()[0]?.path ?? null)
    setFocus('tree')
  }

  const moveSelection = (delta: number) => {
    const rows = nodes()
    if (rows.length === 0) return
    const idx = rows.findIndex(n => n.path === selectedPath())
    // From no selection, land on the first row regardless of direction.
    const next = idx < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, idx + delta))
    setSelectedPath(rows[next]!.path)
    setMarked([])
    setAnchor(null)
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

  const toggleSidebar = () => {
    if (sidebar()) {
      setSidebar(false)
      setFocus('editor')
      return
    }
    setSidebar(true)
    focusTree()
  }

  const openFile = (path: string, preview = false) => {
    setNotice(null)
    if (!buffers[path]) {
      try {
        setBuffers(path, { content: readFile(path), dirty: false, mtime: mtimeOf(path) })
      } catch (e) {
        // Nothing druk can show, so no tab and no buffer — which is what keeps a file
        // like this from ever being written back. The refusal goes over the editor
        // rather than into the status bar: down there it reads as a footnote to the
        // file still on screen, and the answer to "open this" was no.
        setNotice({
          name: basename(path),
          reason:
            e instanceof BinaryFileError
              ? 'It is binary, or uses an encoding druk cannot read.'
              : (e as Error).message,
        })
        return
      }
    }
    setTabs(prev => {
      if (prev.includes(path)) return prev
      // A preview tab takes the previous preview's slot instead of stacking up.
      const slot = previewPath() ? prev.indexOf(previewPath()!) : -1
      if (preview && slot >= 0) return prev.map((p, i) => (i === slot ? path : p))
      return [...prev, path]
    })
    if (preview) {
      const previous = previewPath()
      if (previous && previous !== path) discardBuffer(previous)
      setPreviewPath(path)
    } else if (previewPath() === path) {
      setPreviewPath(null)
    }
    reveal(path)
    setSelectedPath(path)
    setActivePath(path)
    setFocus('editor')
  }

  /** Promote the preview tab to a permanent one (click, double-click, edit). */
  const pinTab = (path: string) => {
    if (previewPath() === path) setPreviewPath(null)
  }

  /**
   * Rename or move `from` to `to`, carrying the editor's own state along.
   *
   * Paths *under* `from` move with it, and that is the whole reason this is one
   * function: moving or renaming a folder invalidates the absolute path of every
   * tab, buffer and expanded entry inside it, and a buffer left pointing at the old
   * path saves the file back to where it used to be — recreating the folder that was
   * just moved. Returns an error message, or null on success.
   */
  /**
   * Point everything that remembers a path at where the file went: open tabs, their
   * buffers, the active and preview tabs, the selection and the expanded folders.
   * A batch move needs this as much as a single one — without it the tabs of moved
   * files keep pointing at paths that no longer exist.
   */
  const adoptMove = (from: string, to: string) => {
    const inside = `${from}/`
    const remap = (path: string) =>
      path === from ? to : path.startsWith(inside) ? to + path.slice(from.length) : path

    setTabs(prev => prev.map(remap))
    // Snapshotted first: moving a buffer writes to the store being walked.
    for (const path of Object.keys(unwrap(buffers))) {
      const next = remap(path)
      if (next === path) continue
      setBuffers(next, { ...buffers[path]! })
      discardBuffer(path)
    }
    const active = activePath()
    if (active) setActivePath(remap(active))
    const preview = previewPath()
    if (preview) setPreviewPath(remap(preview))
    setSelectedPath(to)
    // Fresh Set identity, so this doubles as the tree refresh.
    setExpanded(prev => new Set([...prev].map(remap)))
  }

  const movePath = (from: string, to: string): string | null => {
    const err = rename(from, to)
    if (err) return err
    adoptMove(from, to)
    return null
  }

  /**
   * Why one path cannot go into `dir`, or null when it can. Separated from doing the
   * move so a batch can report which of its files were refused and still move the rest.
   */
  const whyNotMove = (path: string, dir: string): string | null => {
    if (dirname(path) === dir) return `${basename(path)} is already there`
    // A folder cannot be moved inside itself: the destination would travel with the
    // source, and `fs.renameSync` reports EINVAL for it.
    if (dir === path || dir.startsWith(`${path}/`)) {
      return `Cannot move ${basename(path)} into itself`
    }
    return null
  }

  /** Move `path` into the folder `dir`, refusing the moves that cannot mean anything. */
  const moveInto = (path: string, dir: string) => {
    const refused = whyNotMove(path, dir)
    if (refused) return say(refused, 'warn')
    const err = movePath(path, join(dir, basename(path)))
    if (err) return say(err, 'error')
    expand(dir)
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
    setMarked([])
    setAnchor(null)

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
          if (done > 0) expand(dir)
          refreshTree()
          const where = relative(rootDir, dir) || basename(rootDir)
          const left = [...refused, ...failed]
          if (left.length === 0) return say(`Moved ${done} items to ${where}/`)
          say(`Moved ${done} to ${where}/ — left ${left.join(', ')}`, 'warn')
        })(),
    )
  }

  const activateNode = (node: TreeNode) => {
    setSelectedPath(node.path)
    if (node.isDir) toggleExpand(node.path)
    else openFile(node.path, true)
  }

  const selectedNode = () => nodes().find(n => n.path === selectedPath())

  const targetDir = () => {
    const node = selectedNode()
    if (!node) return rootDir
    return node.isDir ? node.path : dirname(node.path)
  }

  const copyAllInto = (paths: string[], dir: string) => {
    // A folder cannot be copied into itself: the copy would walk the copy it is
    // writing. Its own parent is fine, and is how a folder gets duplicated.
    const refused: string[] = []
    const copyable = paths.filter(path => {
      if (dir !== path && !dir.startsWith(`${path}/`)) return true
      refused.push(basename(path))
      return false
    })
    setMarked([])
    setAnchor(null)
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
          expand(dir)
          refreshTree()
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
    const targets = actionTargets()
    if (targets.length === 0) return say('Nothing selected', 'warn')
    setClipboard({ paths: targets, mode })
    setMarked([])
    setAnchor(null)
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
    if (mode === 'cut') moveAllInto(from, targetDir())
    else copyAllInto(from, targetDir())
  }

  /**
   * Closing drops the buffer, and sessions persist only paths — so unsaved edits
   * are gone for good. `discardUnsaved` is the caller promising that is intended.
   */
  const closeTab = (path: string, discardUnsaved = false) => {
    if (!discardUnsaved && buffers[path]?.dirty) {
      return setPrompt({ kind: 'closeDirty', paths: [path], names: [basename(path)] })
    }
    const idx = tabs().indexOf(path)
    const next = tabs().filter(p => p !== path)
    setTabs(next)
    if (activePath() === path) {
      const fallback = next[idx] ?? next[idx - 1] ?? null
      setActivePath(fallback)
      if (!fallback && sidebar()) focusTree()
    }
    if (previewPath() === path) setPreviewPath(null)
    discardBuffer(path)
  }

  /** Close a batch, asking once if any of them has unsaved edits. */
  const closeTabs = (paths: string[], done: string) => {
    const dirty = paths.filter(path => buffers[path]?.dirty)
    if (dirty.length > 0) {
      return setPrompt({ kind: 'closeDirty', paths, names: dirty.map(path => basename(path)) })
    }
    for (const path of paths) closeTab(path, true)
    say(done)
  }

  const switchTab = (delta: number) => {
    const list = tabs()
    if (list.length === 0) return
    const idx = activePath() ? list.indexOf(activePath()!) : 0
    openFile(list[(idx + delta + list.length) % list.length]!)
  }

  /** Put replaced text into the buffer. The tab is pinned first: an edited preview
   * tab must never be recycled out from under the edit. */
  const applyReplacement = (path: string, next: string) => {
    pinTab(path)
    setBuffers(path, { content: next, dirty: true })
    setReloadKey(k => k + 1)
  }

  const jumpTo = (match: Match) => {
    setSearch(null)
    if (match.path && match.path !== activePath()) openFile(match.path)
    setGoto(prev => ({ line: match.line, col: match.col, key: (prev?.key ?? 0) + 1 }))
    setFocus('editor')
  }

  /** Write the buffer to disk unconditionally and re-sync its mtime. */
  const writeBuffer = (path: string, content: string) => {
    const err = writeFile(path, content)
    if (err) {
      say(`Save failed: ${err}`, 'error')
      return
    }
    setBuffers(path, { content, dirty: false, mtime: mtimeOf(path) })
    setGitRevision(n => n + 1)
    say(`Saved ${basename(path)}`)
  }

  const saveActive = () => {
    const path = activePath()
    const buffer = activeBuffer()
    if (!path || !buffer) return
    // Someone else touched the file since we loaded it — ask before clobbering.
    if (mtimeOf(path) !== buffer.mtime) {
      if (!exists(path)) {
        setConflict({ path, disk: '', deleted: true })
        return
      }
      let disk = ''
      try {
        disk = readFile(path)
      } catch {
        // unreadable (binary now) — treat as empty
      }
      if (disk !== buffer.content) {
        setConflict({ path, disk, deleted: false })
        return
      }
    }
    writeBuffer(path, buffer.content)
  }

  const resolveConflict = (choice: string) => {
    const c = conflict()
    setConflict(null)
    if (!c) return
    if (choice === 'overwrite' && buffers[c.path]) {
      writeBuffer(c.path, buffers[c.path]!.content)
    } else if (choice === 'reload') {
      setBuffers(c.path, { content: c.disk, dirty: false, mtime: mtimeOf(c.path) })
      setReloadKey(k => k + 1)
      say(`Reloaded ${basename(c.path)} from disk`)
    }
  }

  const onEditorChange = (text: string) => {
    const path = activePath()
    if (!path || buffers[path]?.content === text) return
    pinTab(path)
    setBuffers(path, { content: text, dirty: true })
  }

  /**
   * Pull disk changes into open buffers — used by the watcher and after a checkout.
   * Returns the dirty buffers it refused to touch, for the caller to report: every
   * caller follows this with its own `say`, which would bury a warning said here.
   */
  const syncFromDisk = (): DiskSync => {
    const updates: [string, Buffer][] = []
    const changed: string[] = []
    const deleted: string[] = []
    const vanished: string[] = []
    for (const path of Object.keys(buffers)) {
      const buffer = buffers[path]!
      // The file is gone — deleted here, removed by a checkout, or cleaned up
      // outside. A clean buffer has nothing left to show, so its tab goes with it.
      // A dirty one keeps the tab: saving recreates the file, which is exactly what
      // the deleted-on-disk conflict prompt offers.
      if (!exists(path)) {
        if (buffer.dirty) deleted.push(basename(path))
        else vanished.push(path)
        continue
      }
      let disk: string
      try {
        disk = readFile(path)
      } catch {
        continue // unreadable, or binary now — the tree refresh below reflects it
      }
      if (disk === buffer.content) continue
      // Unsaved edits stay untouched; the user is warned and asked on save.
      if (buffer.dirty) changed.push(basename(path))
      else updates.push([path, { content: disk, dirty: false, mtime: mtimeOf(path) }])
    }
    // After the walk: closing a tab mutates the store being iterated.
    for (const path of vanished) closeTab(path, true)
    if (updates.length > 0) {
      setBuffers(
        produce(draft => {
          for (const [path, buffer] of updates) draft[path] = buffer
        }),
      )
      setReloadKey(k => k + 1)
    }
    refreshTree()
    return { changed, deleted }
  }

  /** The watcher's warning for a sync, or null when nothing clashed. */
  const clashWarning = (sync: DiskSync): string | null => {
    const parts: string[] = []
    if (sync.changed.length > 0) parts.push(`${CLASH_CHANGED}${sync.changed.join(', ')}`)
    if (sync.deleted.length > 0) parts.push(`${CLASH_DELETED}${sync.deleted.join(', ')}`)
    return parts.length > 0 ? parts.join(' · ') : null
  }

  const submitPrompt = (value: string) => {
    const name = value.trim()
    const p = prompt()
    setPrompt(null)
    if (!p || !PROMPT_TITLES[p.kind]) return
    if (!name) return say('Nothing entered', 'warn')

    if (p.kind === 'gotoLine') {
      const asked = Number.parseInt(name, 10)
      if (!Number.isInteger(asked) || asked < 1) return say(`Not a line number: ${name}`, 'error')
      const total = activeBuffer()?.content.split('\n').length ?? 1
      const line = Math.min(asked, total)
      setGoto(prev => ({ line: line - 1, col: 0, key: (prev?.key ?? 0) + 1 }))
      setFocus('editor')
      say(line === asked ? `Line ${line}` : `Line ${line} — the file ends there`)
    } else if (p.kind === 'newFile') {
      const path = join(p.dir, name)
      const err = createFile(path)
      if (err) return say(err, 'error')
      expand(p.dir)
      openFile(path)
      say(`Created ${name}`)
    } else if (p.kind === 'newFolder') {
      const path = join(p.dir, name)
      const err = createDir(path)
      if (err) return say(err, 'error')
      expand(path)
      setSelectedPath(path)
      say(`Created ${name}/`)
    } else if (p.kind === 'rename') {
      const err = movePath(p.target, join(dirname(p.target), name))
      if (err) return say(err, 'error')
      say(`Renamed to ${name}`)
    }
  }

  /** Carry out whatever the open confirm prompt was asking about. */
  const confirmPrompt = () => {
    const p = prompt()
    setPrompt(null)
    switch (p?.kind) {
      case 'delete': {
        for (const target of p.targets) {
          if (tabs().includes(target)) closeTab(target, true)
        }
        // Land on whatever took the deleted row's place, rather than clearing
        // the selection: with nothing selected the next arrow key jumps back to
        // the top of the tree instead of carrying on from here.
        const gone = selectedPath()
        const wasAt =
          gone && p.targets.includes(gone) ? nodes().findIndex(n => n.path === gone) : -1
        setMarked([])
        setAnchor(null)

        const targets = p.targets
        whileFree(
          () =>
            void (async () => {
              setBusy({ label: 'Deleting', done: 0, total: 0 })
              const { failed } = await removeAll(targets, progress =>
                setBusy({ label: 'Deleting', done: progress.done, total: progress.total }),
              )
              setBusy(null)
              refreshTree()
              if (wasAt >= 0) {
                const rows = nodes()
                setSelectedPath(rows[Math.min(wasAt, rows.length - 1)]?.path ?? null)
              }
              if (failed.length > 0) return say(`Could not delete ${failed.join(', ')}`, 'error')
              say(
                targets.length === 1
                  ? `Deleted ${basename(targets[0]!)}`
                  : `Deleted ${targets.length} items`,
              )
            })(),
        )
        return
      }
      case 'closeDirty': {
        for (const path of p.paths) closeTab(path, true)
        return say(`Discarded unsaved edits in ${p.names.join(', ')}`, 'warn')
      }
      case 'quitDirty':
        return quit(true)
    }
  }

  const applyTheme = (name: ThemeName) => {
    setTheme(name)
    invalidateSyntaxStyle()
    patchConfig({ theme: name })
    say(`Theme: ${themeLabels[name]}`)
  }

  /**
   * `'auto'` resolved against the terminal, then clamped against it again: a width
   * saved on a wide screen must not swallow the editor when the window is smaller
   * next time. The second clamp wins outright — below `SIDEBAR_MIN + EDITOR_MIN`
   * columns the tree gives up its minimum rather than leave the editor unusable.
   * The config value is untouched, so a saved width returns in full on a wide screen.
   */
  const treeWidth = () =>
    Math.max(
      0,
      Math.min(
        sidebarColumns(config.sidebarWidth, dimensions().width),
        dimensions().width - EDITOR_MIN,
      ),
    )

  const resizeSidebar = (width: number) => {
    const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(width)))
    if (next !== config.sidebarWidth) patchConfig({ sidebarWidth: next })
  }

  /**
   * Step the width by `delta`, from what is on screen rather than from the config.
   * On a window too narrow to honour a large saved width that does discard it — but
   * the alternative is a key that visibly does nothing while quietly counting down.
   */
  const nudgeSidebar = (delta: number) => resizeSidebar(treeWidth() + delta)

  const applyTabSize = (size: number) => {
    patchConfig({ tabSize: size })
    say(`Tab size: ${size}`)
  }

  const applyVim = (enabled: boolean) => {
    setVimMode(enabled ? 'normal' : null)
    patchConfig({ vim: enabled })
    say(`Vim mode ${enabled ? 'on' : 'off'}`)
  }

  /** For commands that act on the tree selection, which the palette can run without one. */
  const withNode = (run: (node: TreeNode) => void) => () => {
    const node = selectedNode()
    if (node) run(node)
    else say('Select a file in the tree first', 'warn')
  }

  const promptTitle = () => {
    const p = prompt()
    return p ? PROMPT_TITLES[p.kind] : undefined
  }
  const promptValue = () => {
    const p = prompt()
    return p?.kind === 'rename' ? basename(p.target) : ''
  }

  /**
   * What the confirm modal asks, per prompt kind. Narrowing on `p.kind` is what
   * types the payload fields here, so the JSX needs no casts.
   */
  const confirmation = createMemo<Confirmation | null>(() => {
    const p = prompt()
    switch (p?.kind) {
      case 'delete': {
        const only = p.targets.length === 1 ? p.targets[0]! : null
        return {
          title: 'Delete',
          verb: 'delete',
          danger: true,
          // Naming several files would run past the modal; the count is the thing
          // worth checking before agreeing to this one.
          message: only
            ? `Delete "${basename(only)}"${isDirectory(only) ? ' and its contents' : ''}?`
            : `Delete these ${p.targets.length} items and anything inside them?`,
        }
      }
      case 'closeDirty':
        return {
          title: 'Unsaved changes',
          verb: 'close without saving',
          danger: true,
          message: `Unsaved edits in ${p.names.join(', ')} will be lost. Close anyway?`,
        }
      case 'quitDirty':
        return {
          title: 'Unsaved changes',
          verb: 'quit without saving',
          danger: true,
          message: `Unsaved edits in ${p.names.join(', ')} will be lost. Quit anyway?`,
        }
      default:
        return null
    }
  })

  const commands = createMemo(() =>
    buildCommands(
      {
        save: saveActive,
        openFile: () => setPicker('files'),
        switchTab: () => setPicker('tabs'),
        closeOthers: () => {
          const keep = activePath()
          if (keep)
            closeTabs(
              tabs().filter(path => path !== keep),
              'Closed other tabs',
            )
        },
        closeAll: () => closeTabs(tabs(), 'Closed all tabs'),
        gotoLine: () => setPrompt({ kind: 'gotoLine' }),
        undo: () => setHistory(prev => ({ kind: 'undo', key: (prev?.key ?? 0) + 1 })),
        redo: () => setHistory(prev => ({ kind: 'redo', key: (prev?.key ?? 0) + 1 })),
        findInFile: () => setSearch({ scope: 'file' }),
        findInProject: () => setSearch({ scope: 'project' }),
        replaceInFile: () => setSearch({ scope: 'file', replacing: true }),
        newFile: () => setPrompt({ kind: 'newFile', dir: targetDir() }),
        newFolder: () => setPrompt({ kind: 'newFolder', dir: targetDir() }),
        rename: withNode(n => setPrompt({ kind: 'rename', target: n.path })),
        remove: () => {
          const targets = actionTargets()
          if (targets.length === 0) return say('Nothing selected', 'warn')
          setPrompt({ kind: 'delete', targets })
        },
        cutForMove: () => takeForPaste('cut'),
        copyForPaste: () => takeForPaste('copy'),
        paste,
        closeTab: () => void (activePath() && closeTab(activePath()!)),
        nextTab: () => switchTab(1),
        prevTab: () => switchTab(-1),
        toggleFocus: () => (focus() === 'tree' ? setFocus('editor') : focusTree()),
        toggleSidebar,
        setVim: applyVim,
        setTabSize: applyTabSize,
        setTheme: applyTheme,
        showHelp: () => setHelp(true),
        quit,
      },
      {
        vimEnabled: config.vim,
        activeTheme: config.theme,
        tabSize: config.tabSize,
      },
    ),
  )

  onMount(() => {
    // Same refusal `druk file.ts` deserves as opening one from the tree, and for the
    // same reason: an empty editor with a status line under it looks like a bug.
    if (restored.failed) setNotice({ name: basename(single!), reason: restored.failed })
  })

  onMount(() => {
    if (!props.initialConfig.checkUpdates) return
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    void (async () => {
      const info = await checkForUpdate()
      if (!cancelled && info && info.latest !== props.initialConfig.skipUpdate) setUpdate(info)
    })()
  })

  // The watcher has no follow-up message of its own, so unlike the git callers it
  // reports the clash itself — and clears it again once the files agree, since
  // nothing else would ever replace a warning the user has already dealt with.
  onMount(() =>
    onCleanup(
      watchTree(rootDir, changed => {
        // History moved elsewhere: nothing in the working tree need have changed, so
        // this is the only thing that tells the branch and ahead/behind to re-read.
        if (changed.git) setGitRevision(n => n + 1)
        if (!changed.tree) return
        const warning = clashWarning(syncFromDisk())
        if (warning) {
          say(warning, 'warn')
        } else if (
          status().msg.startsWith(CLASH_CHANGED) ||
          status().msg.startsWith(CLASH_DELETED)
        ) {
          say(READY)
        }
      }),
    ),
  )

  createEffect(
    on(
      // Not keyed on content: `git diff` is a subprocess, far too heavy to run
      // on every keystroke. Saving bumps reloadKey, which refreshes the marks.
      () => [activePath(), reloadKey(), gitRevision()] as const,
      ([path]) => {
        setGitLines(path ? diffLines(path) : new Map())
      },
    ),
  )

  // Ahead/behind only moves when history does, so it is deliberately not tied to
  // the tree refresh, which fires on every filesystem event.
  createEffect(
    on(
      () => [branch(), gitRevision()] as const,
      () => setUpstream(upstreamOf(rootDir)),
    ),
  )

  // Tree marks follow the same cadence, plus any filesystem change. The branch
  // rides along: a checkout in another terminal writes .git, so the watcher fires
  // here, and nothing else would ever notice HEAD had moved.
  createEffect(
    on(
      () => [expanded(), gitRevision(), reloadKey()] as const,
      () => {
        setGitStatus(statusMap(rootDir))
        setBranch(currentBranch(rootDir))
      },
    ),
  )

  createEffect(
    on(
      () => [tabs(), activePath(), expanded(), sidebar()] as const,
      ([openTabs, active, folders, showTree]) => {
        // Single-file mode leaves no trace: `druk one.ts` would otherwise save a
        // one-tab, sidebar-hidden layout over whatever the folder had.
        if (single) return
        saveSession(rootDir, {
          tabs: openTabs,
          activePath: active,
          expanded: [...folders],
          sidebar: showTree,
        })
      },
    ),
  )

  useKeyboard((key: KeyEvent) => {
    const k = key.name

    // Overlays own their keys (handled inside their own components).
    if (help()) {
      if (k === 'escape') setHelp(false)
      return
    }
    if (overlay()) return

    // The refusal has been read by the time another key is pressed. Dismissed here
    // rather than on a timer, so it cannot vanish while it is still being read.
    if (notice()) setNotice(null)

    /**
     * Run a global chord and hide the key from the textarea, which binds many of
     * the same ones itself — Ctrl+W deletes a word, Ctrl+F/Ctrl+B move the caret,
     * Ctrl+←/→ jump a word. Without this, closing a tab also ate a word.
     */
    const claim = (run: () => void) => {
      key.preventDefault()
      run()
    }

    if (key.ctrl && k === 'q') return claim(quit)
    // Ctrl+C quits from the tree. In the editor it belongs to EditorPane, which is
    // the only place that knows whether there is a selection to copy instead — the
    // renderer's own selection covers mouse drags only. Either way it
    // routes through `quit()`, so a dirty buffer still gets its prompt.
    if (key.ctrl && k === 'c' && focus() !== 'editor') return claim(quit)
    if (key.ctrl && k === 'p') return claim(() => setPalette(true))
    if (key.ctrl && k === 'o') return claim(() => setPicker('files'))
    // Ctrl+E is line-end in every terminal; keep the tab family on the arrows.
    if (key.ctrl && (k === 't' || k === 'up')) return claim(() => setPicker('tabs'))
    if (key.ctrl && k === 'g') return claim(() => setPrompt({ kind: 'gotoLine' }))
    if (key.ctrl && k === 's') return claim(saveActive)
    // Ctrl+Shift+<letter> is byte-identical to Ctrl+<letter> outside the kitty
    // keyboard protocol, so it cannot be bound at all in Terminal.app, plain
    // iTerm2 or tmux — hence a plain Ctrl chord for the project search. Ctrl+Opt
    // arrives as ctrl+meta (Terminal.app) or ctrl+option (iTerm2), never both.
    // In vim, Ctrl+R is redo and belongs to the editor. Project search keeps its
    // other spelling, Ctrl+Opt+F, so nothing becomes unreachable.
    const vimOwnsRedo = config.vim && focus() === 'editor' && vimMode() !== 'insert'
    if (key.ctrl && k === 'r' && !vimOwnsRedo) return claim(() => setSearch({ scope: 'project' }))
    if (key.ctrl && chord(key) && k === 'f') return claim(() => setSearch({ scope: 'project' }))
    if (key.ctrl && k === 'f') return claim(() => setSearch({ scope: 'file' }))
    if (key.ctrl && k === 'w') {
      return claim(() => void (activePath() && closeTab(activePath()!)))
    }
    if (key.ctrl && chord(key) && k === 'n') {
      return claim(() => setPrompt({ kind: 'newFolder', dir: targetDir() }))
    }
    if (key.ctrl && k === 'n') return claim(() => setPrompt({ kind: 'newFile', dir: targetDir() }))
    if (key.ctrl && k === 'b') return claim(toggleSidebar)
    // macOS binds plain Ctrl+arrows to Mission Control, so they never arrive there.
    // Ctrl+Opt+arrow reports as ctrl+arrow and does reach us, and MacBooks have no
    // page keys — hence all three spellings.
    if (key.ctrl && (k === 'pageup' || k === 'left')) return claim(() => switchTab(-1))
    if (key.ctrl && (k === 'pagedown' || k === 'right')) return claim(() => switchTab(1))

    if (focus() === 'editor') {
      // In vim, Esc belongs to the mode switch. Focus moves synchronously, so
      // leaving now would mean EditorPane's vim handler is already unfocused when
      // it runs and never sees the key.
      const vimOwnsEscape = config.vim && vimMode() !== 'normal'
      if (k === 'escape' && sidebar() && !vimOwnsEscape) focusTree()
      return // everything else belongs to the textarea
    }

    // The cases below switch on the bare key name, so a chord that got this far
    // would fire one of them — Ctrl+D on the tree used to open the delete prompt.
    if (key.ctrl || key.meta || key.option) return

    // Solid applies focus synchronously, so without this the key that opens a
    // file also reaches the freshly focused textarea.
    key.preventDefault()

    const node = selectedNode()
    switch (k) {
      case 'tab':
        if (activePath()) setFocus('editor')
        break
      case 'up':
        if (key.shift) extendSelection(-1)
        else moveSelection(-1)
        break
      case 'down':
        if (key.shift) extendSelection(1)
        else moveSelection(1)
        break
      case 'right':
        if (node?.isDir && !expanded().has(node.path)) toggleExpand(node.path)
        else moveSelection(1)
        break
      case 'left':
        if (node?.isDir && expanded().has(node.path)) toggleExpand(node.path)
        else if (node) setSelectedPath(dirname(node.path))
        break
      case 'return':
      case 'enter':
        if (node) activateNode(node)
        break
      // Bare keys rather than a chord: the tree owns its keyboard while focused,
      // and every Ctrl+Opt pair worth having is already spoken for.
      case '[':
        nudgeSidebar(-2)
        break
      case ']':
        nudgeSidebar(2)
        break
      case 'a':
        setPrompt({ kind: key.shift ? 'newFolder' : 'newFile', dir: targetDir() })
        break
      case 'r':
        if (node) setPrompt({ kind: 'rename', target: node.path })
        break
      // Cut, copy and paste rather than a "move to…" prompt: the tree is already the
      // way to choose a folder, and typing a destination path is the thing it exists
      // to save you from.
      case 'x':
        takeForPaste('cut')
        break
      case 'c':
        takeForPaste('copy')
        break
      case 'p':
        paste()
        break
      case 'escape':
        if (clipboard().paths.length > 0) {
          const cancelled = clipboard().mode === 'cut' ? 'Move' : 'Copy'
          setClipboard({ paths: [], mode: 'cut' })
          say(`${cancelled} cancelled`)
        } else if (marked().length > 0) {
          setMarked([])
          setAnchor(null)
        }
        break
      case 'd':
      case 'delete':
      case 'backspace': {
        const targets = actionTargets()
        if (targets.length > 0) setPrompt({ kind: 'delete', targets })
        break
      }
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={ui.bg}>
      <Tabs
        tabs={tabs().map(p => ({
          path: p,
          name: basename(p),
          dirty: buffers[p]?.dirty ?? false,
          preview: p === previewPath(),
        }))}
        activePath={activePath()}
        onSelect={p => openFile(p)}
        onClose={closeTab}
        onOverflow={() => setPicker('tabs')}
      />
      {/* Drag capture lives on the row, not the divider: the pointer leaves a
          one-column target immediately, and each drag event is delivered to
          whatever sits under it. */}
      <box
        flexDirection="row"
        flexGrow={1}
        onMouseDrag={(event: MouseEvent) => {
          if (resizing()) resizeSidebar(event.x)
        }}
        onMouseDragEnd={() => setResizing(false)}
        onMouseUp={() => setResizing(false)}
      >
        <Show when={sidebar()}>
          <FileTree
            rootName={basename(rootDir) || rootDir}
            nodes={nodes()}
            selectedPath={selectedPath()}
            expanded={expanded()}
            focused={focus() === 'tree'}
            width={treeWidth()}
            gitStatus={gitStatus()}
            cutPaths={cut()}
            markedPaths={marked()}
            onActivate={activateNode}
            onPin={node => pinTab(node.path)}
            onFocus={() => setFocus('tree')}
          />
          {/* Drag handle: the whole column is the grab target, but only a short
              grip is drawn at its middle — a full-height rule is a heavy line
              down the screen for something you touch once. The spacers centre it
              without anyone having to know the pane's height. `scrollbar` is the
              palette's quiet rule colour, and the accent while dragging says the
              grab took. The sidebar starts at column 0, so the pointer's x is the
              width asked for. */}
          <box
            width={1}
            flexShrink={0}
            flexDirection="column"
            backgroundColor={ui.bg}
            onMouseDown={(event: MouseEvent) => {
              setResizing(true)
              resizeSidebar(event.x)
            }}
          >
            <box flexGrow={1} backgroundColor={ui.bg} />
            <For each={GRIP}>
              {() => <text fg={resizing() ? ui.accent : ui.scrollbar} bg={ui.bg} content="│" />}
            </For>
            <box flexGrow={1} backgroundColor={ui.bg} />
          </box>
        </Show>
        <EditorPane
          path={activePath()}
          content={activeBuffer()?.content ?? ''}
          filetype={activePath() ? filetypeForPath(activePath()!) : undefined}
          focused={focus() === 'editor'}
          theme={config.theme}
          reloadKey={reloadKey()}
          goto={goto()}
          history={history()}
          vim={config.vim}
          tabSize={config.tabSize}
          gitLines={gitLines()}
          notice={notice()}
          blocked={overlay()}
          onChange={onEditorChange}
          onCursor={setCursor}
          onFocus={() => setFocus('editor')}
          onVimMode={setVimMode}
          onQuit={quit}
        />
      </box>
      <StatusBar
        message={status().msg}
        tone={status().tone}
        filetype={
          activePath() ? languageLabel(filetypeForPath(activePath()!) ?? 'plain') : undefined
        }
        cursor={activePath() ? cursor() : undefined}
        dirty={activeBuffer()?.dirty ?? false}
        vimMode={activePath() ? vimMode() : null}
        branch={branch()}
        ahead={upstream()?.ahead ?? 0}
        behind={upstream()?.behind ?? 0}
        changed={gitStatus().size}
        focus={focus()}
        busy={busy()}
      />

      <Show when={promptTitle()}>
        {(title: () => string) => (
          <PromptModal
            title={title()}
            initialValue={promptValue()}
            onSubmit={submitPrompt}
            onCancel={() => setPrompt(null)}
          />
        )}
      </Show>
      <Show when={confirmation()}>
        {(ask: () => Confirmation) => (
          <ConfirmModal
            title={ask().title}
            verb={ask().verb}
            danger={ask().danger}
            message={ask().message}
            onConfirm={confirmPrompt}
            onCancel={() => setPrompt(null)}
          />
        )}
      </Show>
      <Show when={search()}>
        {(open: () => { scope: SearchScope; replacing?: boolean }) => (
          <SearchPanel
            scope={open().scope}
            rootDir={rootDir}
            activePath={activePath()}
            activeContent={activeBuffer()?.content ?? ''}
            initialQuery={selection()}
            replacing={open().replacing}
            onPick={jumpTo}
            onReplaceOne={
              open().scope === 'file'
                ? (match, query, replacement) => {
                    const path = activePath()
                    const buffer = path ? buffers[path] : undefined
                    if (!path || !buffer) return
                    const next = replaceMatch(buffer.content, match, query, replacement)
                    // Refused when the line has moved on since the scan — say so rather
                    // than writing the replacement at a drifted offset.
                    if (next === null) return say('That match is gone', 'warn')
                    applyReplacement(path, next)
                  }
                : undefined
            }
            onReplaceAll={
              open().scope === 'file'
                ? (query, replacement) => {
                    const path = activePath()
                    const buffer = path ? buffers[path] : undefined
                    if (!path || !buffer) return
                    const next = replaceAll(buffer.content, query, replacement)
                    setSearch(null)
                    if (next === buffer.content) return say('Nothing to replace')
                    applyReplacement(path, next)
                    say(`Replaced "${query}" in ${basename(path)}`)
                  }
                : undefined
            }
            onClose={() => setSearch(null)}
          />
        )}
      </Show>
      <Show when={picker()}>
        {(kind: () => 'files' | 'tabs') => (
          <FilePicker
            rootDir={rootDir}
            files={kind() === 'tabs' ? tabs() : undefined}
            title={kind() === 'tabs' ? 'Switch tab' : 'Open file'}
            onPick={path => {
              setPicker(null)
              openFile(path)
            }}
            onClose={() => setPicker(null)}
          />
        )}
      </Show>
      <Show when={palette()}>
        <CommandPalette commands={commands()} onClose={() => setPalette(false)} />
      </Show>
      <Show when={conflict()}>
        {(c: () => Conflict) => (
          <ChoiceModal
            title={c().deleted ? 'File deleted on disk' : 'File changed on disk'}
            message={
              c().deleted
                ? `"${basename(c().path)}" was deleted on disk and has unsaved edits here.`
                : `"${basename(c().path)}" changed on disk and has unsaved edits here.`
            }
            choices={
              c().deleted
                ? [
                    { id: 'overwrite', label: 'Write it back (recreate the file)' },
                    { id: 'cancel', label: 'Cancel (keep editing)' },
                  ]
                : [
                    { id: 'overwrite', label: 'Overwrite (keep my version)' },
                    { id: 'reload', label: 'Reload (discard my changes)' },
                    { id: 'cancel', label: 'Cancel' },
                  ]
            }
            onPick={resolveConflict}
            onCancel={() => setConflict(null)}
          />
        )}
      </Show>
      <Show when={update()}>
        {(info: () => UpdateInfo) => (
          <UpdateBanner
            update={info()}
            onClose={() => setUpdate(null)}
            onSkip={() => {
              patchConfig({ skipUpdate: info().latest })
              setUpdate(null)
            }}
          />
        )}
      </Show>
      <Show when={help()}>
        <HelpOverlay />
      </Show>
    </box>
  )
}

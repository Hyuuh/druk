import { basename, dirname, join } from 'node:path'

import type { KeyEvent } from '@opentui/core'
import { useKeyboard, useRenderer } from '@opentui/solid'
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import { createStore, produce, unwrap } from 'solid-js/store'

import { saveConfig } from '../core/config'
import type { Config } from '../core/config'
import type { TreeNode } from '../core/fs'
import {
  BinaryFileError,
  createDir,
  createFile,
  exists,
  fileSize,
  flattenVisible,
  isDirectory,
  mtimeOf,
  readFile,
  remove,
  rename,
  watchTree,
  writeFile,
} from '../core/fs'
import {
  checkoutBranch,
  commitAll,
  createBranch,
  currentBranch,
  deleteBranch,
  diffLines,
  lastCommitSubject,
  listBranches,
  popStash,
  stashAll,
  undoLastCommit,
  statusMap,
} from '../core/git'
import type { Branch, FileStatus, LineChange } from '../core/git'
import type { Match } from '../core/search'
import { replaceAll } from '../core/search'
import { loadSession, saveSession } from '../core/session'
import { checkForUpdate } from '../core/update'
import type { UpdateInfo } from '../core/update'
import type { VimMode } from '../editor/vim'
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
import { Tabs } from '../ui/Tabs'
import { UpdateBanner } from '../ui/UpdateBanner'
import { buildCommands } from './commands'

type Focus = 'tree' | 'editor'

/** Which question the branch list is answering. */
type BranchPicker = 'switch' | 'base' | 'delete' | null
interface Buffer {
  content: string
  dirty: boolean
  /** Not text: the tab opens but shows a notice instead of an editor. */
  binary?: boolean
  /** Disk mtime this buffer was last in sync with; used to detect outside edits. */
  mtime: number
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
  | { kind: 'delete'; target: string }
  | { kind: 'newBranch'; from: string | null }
  | { kind: 'commit' }
  | { kind: 'undoCommit'; subject: string }
  | { kind: 'deleteBranch'; name: string }
  | null

const TREE_WIDTH = 30
const PROMPT_TITLES = {
  newFile: 'New file name',
  newFolder: 'New folder name',
  rename: 'Rename to',
  gotoLine: 'Go to line',
  newBranch: 'New branch name',
  commit: 'Commit message',
}

/** Prompts answered with yes/no rather than text. */
const CONFIRM_KINDS = new Set(['delete', 'deleteBranch', 'undoCommit'])

export function App(props: { rootDir: string; initialConfig: Config }) {
  const renderer = useRenderer()
  const rootDir = props.rootDir

  // Restored synchronously: the editor must mount with its buffers already in
  // place, otherwise it renders an empty document and marks it modified.
  const restored = (() => {
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
    return { buffers, tabs, activePath, expanded: saved.expanded, sidebar: saved.sidebar }
  })()

  const [config, setConfig] = createStore<Config>({ ...props.initialConfig })
  const [buffers, setBuffers] = createStore<Record<string, Buffer>>(restored.buffers)
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set(restored.expanded))
  const [selectedPath, setSelectedPath] = createSignal<string | null>(restored.activePath)
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
  const [search, setSearch] = createSignal<SearchScope | null>(null)
  const [picker, setPicker] = createSignal<'files' | 'tabs' | null>(null)
  const [multiCursor, setMultiCursor] = createSignal(0)
  const [update, setUpdate] = createSignal<UpdateInfo | null>(null)
  const [gitLines, setGitLines] = createSignal<Map<number, LineChange>>(new Map())
  const [savedAt, setSavedAt] = createSignal(0)
  const [gitStatus, setGitStatus] = createSignal<Map<string, FileStatus>>(new Map())
  const [branch, setBranch] = createSignal(currentBranch(rootDir))
  const [branchPicker, setBranchPicker] = createSignal<BranchPicker>(null)
  const [branches, setBranches] = createSignal<Branch[]>([])
  const [history, setHistory] = createSignal<{ kind: 'undo' | 'redo'; key: number } | null>(null)
  const [goto, setGoto] = createSignal<{ line: number; col: number; key: number } | null>(null)
  const [cursor, setCursor] = createSignal({ line: 0, col: 0 })
  const [status, setStatus] = createSignal({ msg: 'Ready — Ctrl+P for commands', error: false })

  const nodes = createMemo(() => flattenVisible(rootDir, expanded(), config.showHidden))
  const activeBuffer = () => {
    const path = activePath()
    return path ? buffers[path] : undefined
  }

  const say = (msg: string, error = false) => setStatus({ msg, error })
  // Bump the Set identity so `nodes` recomputes and re-reads the filesystem.
  const refreshTree = () => setExpanded(prev => new Set(prev))
  const expand = (path: string) => setExpanded(prev => new Set(prev).add(path))
  const discardBuffer = (path: string) => setBuffers(produce(draft => void delete draft[path]))

  /** Update settings in memory and on disk in one step. */
  const patchConfig = (patch: Partial<Config>) => {
    setConfig(patch)
    saveConfig(unwrap(config))
  }

  // tree
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
      return next
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
    if (!buffers[path]) {
      try {
        setBuffers(path, { content: readFile(path), dirty: false, mtime: mtimeOf(path) })
      } catch (e) {
        if (!(e instanceof BinaryFileError)) {
          say(`Cannot open ${basename(path)}: ${(e as Error).message}`, true)
          return
        }
        setBuffers(path, { content: '', dirty: false, mtime: mtimeOf(path), binary: true })
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

  const activateNode = (node: TreeNode) => {
    setSelectedPath(node.path)
    if (node.isDir) toggleExpand(node.path)
    else openFile(node.path, true)
  }

  const selectedNode = () => nodes().find(n => n.path === selectedPath())

  // Directory that new files/folders should be created in.
  const targetDir = () => {
    const node = selectedNode()
    if (!node) return rootDir
    return node.isDir ? node.path : dirname(node.path)
  }

  // tabs / editor
  const closeTab = (path: string) => {
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

  const switchTab = (delta: number) => {
    const list = tabs()
    if (list.length === 0) return
    const idx = activePath() ? list.indexOf(activePath()!) : 0
    openFile(list[(idx + delta + list.length) % list.length]!)
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
      say(`Save failed: ${err}`, true)
      return
    }
    setBuffers(path, { content, dirty: false, mtime: mtimeOf(path) })
    setSavedAt(n => n + 1)
    say(`Saved ${basename(path)}`)
  }

  const saveActive = () => {
    const path = activePath()
    const buffer = activeBuffer()
    if (!path || !buffer) return
    if (buffer.binary) return say(`${basename(path)} is not text — nothing to save`, true)
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
    pinTab(path) // editing makes the tab permanent
    setBuffers(path, { content: text, dirty: true })
  }

  /** Pull disk changes into open buffers — used by the watcher and after a checkout. */
  const syncFromDisk = () => {
    const updates: [string, Buffer][] = []
    const clashed: string[] = []
    for (const path of Object.keys(buffers)) {
      const buffer = buffers[path]!
      if (buffer.binary) continue
      let disk: string
      try {
        disk = readFile(path)
      } catch {
        continue // gone or binary — the tree refresh below reflects it
      }
      if (disk === buffer.content) continue
      // Unsaved edits stay untouched; the user is warned and asked on save.
      if (buffer.dirty) clashed.push(basename(path))
      else updates.push([path, { content: disk, dirty: false, mtime: mtimeOf(path) }])
    }
    if (updates.length > 0) {
      setBuffers(
        produce(draft => {
          for (const [path, buffer] of updates) draft[path] = buffer
        }),
      )
      setReloadKey(k => k + 1)
    }
    if (clashed.length > 0) {
      say(`Changed on disk with unsaved edits: ${clashed.join(', ')}`, true)
    }
    refreshTree()
  }

  const afterBranchChange = (message: string) => {
    setBranch(currentBranch(rootDir))
    syncFromDisk()
    // A checkout rewrites files behind our back: refresh the gutter and tree marks.
    setSavedAt(Date.now())
    say(message)
  }

  const openBranchPicker = (mode: Exclude<BranchPicker, null>) => {
    const all = listBranches(rootDir)
    if (all.length === 0) return say('Not a git repository', true)
    const usable =
      mode === 'delete' ? all.filter(b => !b.remote && !b.current) : all.filter(b => !b.current)
    if (usable.length === 0) {
      return say(mode === 'delete' ? 'No other local branches' : 'No other branches', true)
    }
    setBranches(usable)
    setBranchPicker(mode)
  }

  const pickBranch = (name: string) => {
    const mode = branchPicker()
    const target = branches().find(b => b.name === name)
    setBranchPicker(null)
    if (!mode || !target) return
    if (mode === 'base') return setPrompt({ kind: 'newBranch', from: target.name })
    if (mode === 'delete') return setPrompt({ kind: 'deleteBranch', name: target.name })
    const err = checkoutBranch(rootDir, target)
    if (err) return say(err, true)
    afterBranchChange(`Switched to ${currentBranch(rootDir) ?? target.name}`)
  }

  // prompts
  const submitPrompt = (value: string) => {
    const name = value.trim()
    const p = prompt()
    setPrompt(null)
    if (!p || CONFIRM_KINDS.has(p.kind) || !name) return

    if (p.kind === 'commit') {
      const err = commitAll(rootDir, name)
      if (err) return say(err, true)
      afterBranchChange(`Committed "${name}"`)
    } else if (p.kind === 'newBranch') {
      const err = createBranch(rootDir, name, p.from ?? undefined)
      if (err) return say(err, true)
      afterBranchChange(`Created ${name}`)
    } else if (p.kind === 'gotoLine') {
      const line = Math.max(1, Number.parseInt(name, 10) || 1) - 1
      setGoto(prev => ({ line, col: 0, key: (prev?.key ?? 0) + 1 }))
      setFocus('editor')
    } else if (p.kind === 'newFile') {
      const path = join(p.dir, name)
      const err = createFile(path)
      if (err) return say(err, true)
      expand(p.dir)
      openFile(path)
      say(`Created ${name}`)
    } else if (p.kind === 'newFolder') {
      const path = join(p.dir, name)
      const err = createDir(path)
      if (err) return say(err, true)
      expand(path)
      setSelectedPath(path)
      say(`Created ${name}/`)
    } else if (p.kind === 'rename') {
      const to = join(dirname(p.target), name)
      const err = rename(p.target, to)
      if (err) return say(err, true)
      setTabs(prev => prev.map(t => (t === p.target ? to : t)))
      const buffer = buffers[p.target]
      if (buffer) {
        setBuffers(to, { ...buffer })
        discardBuffer(p.target)
      }
      if (activePath() === p.target) setActivePath(to)
      setSelectedPath(to)
      refreshTree()
      say(`Renamed to ${name}`)
    }
  }

  const doDelete = () => {
    const p = prompt()
    setPrompt(null)
    if (p?.kind === 'undoCommit') {
      const err = undoLastCommit(rootDir)
      if (err) return say(err, true)
      return afterBranchChange(`Undid "${p.subject}" — its changes are staged`)
    }
    if (p?.kind === 'deleteBranch') {
      const err = deleteBranch(rootDir, p.name)
      if (err) return say(err, true)
      return say(`Deleted branch ${p.name}`)
    }
    if (p?.kind !== 'delete') return
    const err = remove(p.target)
    if (err) return say(err, true)
    if (tabs().includes(p.target)) closeTab(p.target)
    if (selectedPath() === p.target) setSelectedPath(null)
    refreshTree()
    say(`Deleted ${basename(p.target)}`)
  }

  // theme / commands
  const applyTheme = (name: ThemeName) => {
    setTheme(name)
    invalidateSyntaxStyle()
    patchConfig({ theme: name })
    say(`Theme: ${themeLabels[name]}`)
  }

  const applyWordWrap = (wrap: boolean) => {
    patchConfig({ wordWrap: wrap })
    say(`Word wrap ${wrap ? 'on' : 'off'}`)
  }

  const applyShowHidden = (show: boolean) => {
    patchConfig({ showHidden: show })
    say(show ? 'Showing hidden files' : 'Hiding system files')
  }

  const applyTabSize = (size: number) => {
    patchConfig({ tabSize: size })
    say(`Tab size: ${size}`)
  }

  const applyVim = (enabled: boolean) => {
    setVimMode(enabled ? 'normal' : null)
    patchConfig({ vim: enabled })
    say(`Vim mode ${enabled ? 'on' : 'off'}`)
  }

  const quit = () => {
    renderer.destroy()
    process.exit(0)
  }

  const withNode = (run: (node: TreeNode) => void) => () => {
    const node = selectedNode()
    if (node) run(node)
  }

  // The palette is the feature index — see src/app/commands.ts.
  const commands = createMemo(() =>
    buildCommands(
      {
        save: saveActive,
        openFile: () => setPicker('files'),
        switchTab: () => setPicker('tabs'),
        closeOthers: () => {
          const keep = activePath()
          if (!keep) return
          for (const path of tabs()) if (path !== keep) closeTab(path)
          say('Closed other tabs')
        },
        closeAll: () => {
          // closeTab replaces the array rather than mutating it, so this snapshot stays valid.
          for (const path of tabs()) closeTab(path)
          say('Closed all tabs')
        },
        gotoLine: () => setPrompt({ kind: 'gotoLine' }),
        undo: () => setHistory(prev => ({ kind: 'undo', key: (prev?.key ?? 0) + 1 })),
        redo: () => setHistory(prev => ({ kind: 'redo', key: (prev?.key ?? 0) + 1 })),
        findInFile: () => setSearch('file'),
        findInProject: () => setSearch('project'),
        newFile: () => setPrompt({ kind: 'newFile', dir: targetDir() }),
        newFolder: () => setPrompt({ kind: 'newFolder', dir: targetDir() }),
        rename: withNode(n => setPrompt({ kind: 'rename', target: n.path })),
        remove: withNode(n => setPrompt({ kind: 'delete', target: n.path })),
        closeTab: () => void (activePath() && closeTab(activePath()!)),
        nextTab: () => switchTab(1),
        prevTab: () => switchTab(-1),
        toggleFocus: () => (focus() === 'tree' ? setFocus('editor') : focusTree()),
        toggleSidebar,
        commit: () => setPrompt({ kind: 'commit' }),
        undoCommit: () => {
          const subject = lastCommitSubject(rootDir)
          if (!subject) return say('No commit to undo', true)
          setPrompt({ kind: 'undoCommit', subject })
        },
        stash: () => {
          const err = stashAll(rootDir)
          if (err) return say(err, true)
          afterBranchChange('Stashed all changes')
        },
        popStash: () => {
          const err = popStash(rootDir)
          if (err) return say(err, true)
          afterBranchChange('Restored the latest stash')
        },
        switchBranch: () => openBranchPicker('switch'),
        newBranch: () => setPrompt({ kind: 'newBranch', from: null }),
        newBranchFrom: () => openBranchPicker('base'),
        deleteBranch: () => openBranchPicker('delete'),
        setVim: applyVim,
        setTabSize: applyTabSize,
        setShowHidden: applyShowHidden,
        setWordWrap: applyWordWrap,
        setTheme: applyTheme,
        showHelp: () => setHelp(true),
        quit,
      },
      {
        vimEnabled: config.vim,
        activeTheme: config.theme,
        tabSize: config.tabSize,
        showHidden: config.showHidden,
        wordWrap: config.wordWrap,
      },
    ),
  )

  // Ask npm once at startup whether a newer druk exists (opt-out in config).
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

  // watch disk
  onMount(() => onCleanup(watchTree(rootDir, syncFromDisk)))

  createEffect(
    on(
      // Not keyed on content: `git diff` is a subprocess, far too heavy to run
      // on every keystroke. Saving bumps reloadKey, which refreshes the marks.
      () => [activePath(), reloadKey(), savedAt()] as const,
      ([path]) => {
        setGitLines(path && !activeBuffer()?.binary ? diffLines(path) : new Map())
      },
    ),
  )

  // Tree marks follow the same cadence, plus any filesystem change.
  createEffect(
    on(
      () => [expanded(), savedAt(), reloadKey()] as const,
      () => setGitStatus(statusMap(rootDir)),
    ),
  )

  createEffect(
    on(
      () => [tabs(), activePath(), expanded(), sidebar()] as const,
      ([openTabs, active, folders, showTree]) => {
        saveSession(rootDir, {
          tabs: openTabs,
          activePath: active,
          expanded: [...folders],
          sidebar: showTree,
        })
      },
    ),
  )

  // keyboard
  useKeyboard((key: KeyEvent) => {
    const k = key.name

    // Overlays own their keys (handled inside their own components).
    if (help()) {
      if (k === 'escape') setHelp(false)
      return
    }
    if (prompt() || palette() || conflict() || search() || update() || picker() || branchPicker())
      return

    if (key.ctrl && k === 'q') return quit()
    if (key.ctrl && k === 'p') return setPalette(true)
    if (key.ctrl && k === 'o') return setPicker('files')
    // Ctrl+E is line-end in every terminal; keep the tab family on the arrows.
    if (key.ctrl && (k === 't' || k === 'up')) return setPicker('tabs')
    if (key.ctrl && k === 'g') return setPrompt({ kind: 'gotoLine' })
    if (key.ctrl && k === 's') return saveActive()
    if (key.ctrl && key.shift && k === 'f') return setSearch('project')
    if (key.ctrl && k === 'f') return setSearch('file')
    if (key.ctrl && k === 'w') return void (activePath() && closeTab(activePath()!))
    if (key.ctrl && key.shift && k === 'n')
      return setPrompt({ kind: 'newFolder', dir: targetDir() })
    if (key.ctrl && k === 'n') return setPrompt({ kind: 'newFile', dir: targetDir() })
    if (key.ctrl && k === 'b') return toggleSidebar()
    // macOS binds plain Ctrl+arrows to Mission Control, so they never arrive there.
    // Ctrl+Opt+arrow reports as ctrl+arrow and does reach us, and MacBooks have no
    // page keys — hence all three spellings.
    if (key.ctrl && (k === 'pageup' || k === 'left')) return switchTab(-1)
    if (key.ctrl && (k === 'pagedown' || k === 'right')) return switchTab(1)

    if (focus() === 'editor') {
      // Esc first collapses extra carets; only a second one leaves the editor.
      if (k === 'escape' && multiCursor() === 0 && sidebar()) focusTree()
      return // everything else belongs to the textarea
    }

    // Solid applies focus synchronously, so without this the key that opens a
    // file also reaches the freshly focused textarea.
    key.preventDefault()

    const node = selectedNode()
    switch (k) {
      case 'tab':
        if (activePath()) setFocus('editor')
        break
      case 'up':
        moveSelection(-1)
        break
      case 'down':
        moveSelection(1)
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
      case 'a':
        setPrompt({ kind: key.shift ? 'newFolder' : 'newFile', dir: targetDir() })
        break
      case 'r':
        if (node) setPrompt({ kind: 'rename', target: node.path })
        break
      case 'd':
      case 'delete':
      case 'backspace':
        if (node) setPrompt({ kind: 'delete', target: node.path })
        break
    }
  })

  // render
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
        treeWidth={sidebar() ? TREE_WIDTH : 0}
        onSelect={p => openFile(p)}
        onClose={closeTab}
        onOverflow={() => setPicker('tabs')}
      />
      <box flexDirection="row" flexGrow={1}>
        <Show when={sidebar()}>
          <FileTree
            rootName={basename(rootDir) || rootDir}
            nodes={nodes()}
            selectedPath={selectedPath()}
            expanded={expanded()}
            focused={focus() === 'tree'}
            width={TREE_WIDTH}
            gitStatus={gitStatus()}
            onActivate={activateNode}
            onPin={node => pinTab(node.path)}
            onFocus={() => setFocus('tree')}
          />
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
          wordWrap={config.wordWrap}
          gitLines={gitLines()}
          notice={
            activeBuffer()?.binary
              ? `${basename(activePath()!)} · ${fileSize(activePath()!)}`
              : null
          }
          blocked={
            !!(
              prompt() ||
              palette() ||
              conflict() ||
              help() ||
              search() ||
              update() ||
              picker() ||
              branchPicker()
            )
          }
          onChange={onEditorChange}
          onCursor={setCursor}
          onFocus={() => setFocus('editor')}
          onVimMode={setVimMode}
          onMultiCursor={setMultiCursor}
        />
      </box>
      <StatusBar
        message={status().msg}
        isError={status().error}
        filetype={activePath() ? (filetypeForPath(activePath()!) ?? 'plain') : undefined}
        cursor={activePath() ? cursor() : undefined}
        dirty={activeBuffer()?.dirty ?? false}
        vimMode={activePath() ? vimMode() : null}
        branch={branch()}
      />

      <Show when={prompt() && !CONFIRM_KINDS.has(prompt()!.kind)}>
        <PromptModal
          title={PROMPT_TITLES[prompt()!.kind as keyof typeof PROMPT_TITLES]}
          initialValue={
            prompt()!.kind === 'rename' ? basename((prompt() as { target: string }).target) : ''
          }
          onSubmit={submitPrompt}
          onCancel={() => setPrompt(null)}
        />
      </Show>
      <Show when={prompt()?.kind === 'undoCommit'}>
        <ConfirmModal
          message={`Undo "${(prompt() as { subject: string }).subject}"? Its changes stay in the working tree.`}
          onConfirm={doDelete}
          onCancel={() => setPrompt(null)}
        />
      </Show>
      <Show when={prompt()?.kind === 'deleteBranch'}>
        <ConfirmModal
          message={`Delete branch "${(prompt() as { name: string }).name}"?`}
          onConfirm={doDelete}
          onCancel={() => setPrompt(null)}
        />
      </Show>
      <Show when={prompt()?.kind === 'delete'}>
        <ConfirmModal
          message={`Delete "${basename((prompt() as { target: string }).target)}"${
            isDirectory((prompt() as { target: string }).target) ? ' and its contents' : ''
          }?`}
          onConfirm={doDelete}
          onCancel={() => setPrompt(null)}
        />
      </Show>
      <Show when={search()}>
        {(scope: () => SearchScope) => (
          <SearchPanel
            scope={scope()}
            rootDir={rootDir}
            activePath={activePath()}
            activeContent={activeBuffer()?.content ?? ''}
            onPick={jumpTo}
            onReplaceAll={
              scope() === 'file'
                ? (query, replacement) => {
                    const path = activePath()
                    const buffer = path ? buffers[path] : undefined
                    if (!path || !buffer) return
                    const next = replaceAll(buffer.content, query, replacement)
                    setSearch(null)
                    if (next === buffer.content) return say('Nothing to replace')
                    setBuffers(path, { content: next, dirty: true })
                    setReloadKey(k => k + 1)
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
            showHidden={config.showHidden}
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
      <Show when={branchPicker()}>
        {(mode: () => Exclude<BranchPicker, null>) => (
          <FilePicker
            rootDir={rootDir}
            showHidden={config.showHidden}
            files={branches().map(b => b.name)}
            display={name => name}
            title={
              mode() === 'switch'
                ? 'Switch branch'
                : mode() === 'delete'
                  ? 'Delete branch'
                  : 'Branch off'
            }
            onPick={pickBranch}
            onClose={() => setBranchPicker(null)}
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

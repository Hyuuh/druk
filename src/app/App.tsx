import { basename, dirname, join } from 'node:path'

import type { KeyEvent } from '@opentui/core'
import { useKeyboard, useRenderer } from '@opentui/solid'
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import { createStore, produce, unwrap } from 'solid-js/store'

import { saveConfig } from '../core/config'
import type { Config } from '../core/config'
import { changedFiles, parseDiff } from '../core/diff'
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
  diffText,
  discardFile,
  fetchAll,
  lastCommitSubject,
  listBranches,
  popStash,
  pull,
  push,
  stashAll,
  unpushedCount,
  upstreamOf,
  undoLastCommit,
  statusMap,
} from '../core/git'
import type { Branch, FileStatus, LineChange, Upstream } from '../core/git'
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
import { DiffView } from '../ui/DiffView'
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
  | { kind: 'push'; target: string; ahead: number; publish: boolean }
  | { kind: 'discardFile'; target: string }
  | { kind: 'deleteBranch'; name: string }
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

const TREE_WIDTH = 30

/**
 * Prompts answered with text, and the title their input box carries. Having a
 * title here is what makes a prompt a text prompt — every other kind is a
 * yes/no confirm, so the two sets can never fall out of step.
 */
/** True for Ctrl+Opt+<key>, however this terminal spells the second modifier. */
const chord = (key: KeyEvent) => key.shift || key.option || key.meta

const READY = 'Ready — Ctrl+P for commands'
/** Prefix of the watcher's clash warning, so it can recognise its own message. */
const CLASH_WARNING = 'Changed on disk with unsaved edits: '

const PROMPT_TITLES: Partial<Record<PromptKind, string>> = {
  newFile: 'New file name',
  newFolder: 'New folder name',
  rename: 'Rename to',
  gotoLine: 'Go to line',
  newBranch: 'New branch name',
  commit: 'Commit message',
}

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
  const [gitRevision, setGitRevision] = createSignal(0)
  const [gitStatus, setGitStatus] = createSignal<Map<string, FileStatus>>(new Map())
  const [branch, setBranch] = createSignal(currentBranch(rootDir))
  const [upstream, setUpstream] = createSignal<Upstream | null>(null)
  const [branchPicker, setBranchPicker] = createSignal<BranchPicker>(null)
  const [diff, setDiff] = createSignal<{ title: string; text: string } | null>(null)
  const [branches, setBranches] = createSignal<Branch[]>([])
  const [history, setHistory] = createSignal<{ kind: 'undo' | 'redo'; key: number } | null>(null)
  const [goto, setGoto] = createSignal<{ line: number; col: number; key: number } | null>(null)
  const [cursor, setCursor] = createSignal({ line: 0, col: 0 })
  const [status, setStatus] = createSignal<{ msg: string; tone: Tone }>({
    msg: READY,
    tone: 'info',
  })

  const nodes = createMemo(() => flattenVisible(rootDir, expanded(), config.showHidden))
  const activeBuffer = () => {
    const path = activePath()
    return path ? buffers[path] : undefined
  }

  /** True while a modal or overlay owns the keyboard. One list, two readers. */
  const overlay = createMemo(
    () =>
      !!(
        prompt() ||
        palette() ||
        conflict() ||
        help() ||
        search() ||
        update() ||
        picker() ||
        branchPicker()
      ),
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
          say(`Cannot open ${basename(path)}: ${(e as Error).message}`, 'error')
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

  const targetDir = () => {
    const node = selectedNode()
    if (!node) return rootDir
    return node.isDir ? node.path : dirname(node.path)
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
    if (buffer.binary) return say(`${basename(path)} is not text — nothing to save`, 'warn')
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
  const syncFromDisk = (): string[] => {
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
    refreshTree()
    return clashed
  }

  /** Report an operation that may have rewritten files under the editor. */
  const afterGitChange = (message: string) => {
    setBranch(currentBranch(rootDir))
    setUpstream(upstreamOf(rootDir))
    const clashed = syncFromDisk()
    setGitRevision(n => n + 1)
    if (clashed.length === 0) return say(message)
    say(`${message} — unsaved edits kept in ${clashed.join(', ')}`, 'warn')
  }

  const openBranchPicker = (mode: Exclude<BranchPicker, null>) => {
    const all = listBranches(rootDir)
    if (all.length === 0) return say('Not a git repository', 'warn')
    const usable =
      mode === 'delete' ? all.filter(b => !b.remote && !b.current) : all.filter(b => !b.current)
    if (usable.length === 0) {
      return say(mode === 'delete' ? 'No other local branches' : 'No other branches', 'warn')
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
    if (err) return say(err, 'error')
    afterGitChange(`Switched to ${currentBranch(rootDir) ?? target.name}`)
  }

  const submitPrompt = (value: string) => {
    const name = value.trim()
    const p = prompt()
    setPrompt(null)
    if (!p || !PROMPT_TITLES[p.kind]) return
    if (!name) return say('Nothing entered', 'warn')

    if (p.kind === 'commit') {
      const err = commitAll(rootDir, name)
      if (err) return say(err, 'error')
      afterGitChange(`Committed "${name}"`)
    } else if (p.kind === 'newBranch') {
      const err = createBranch(rootDir, name, p.from ?? undefined)
      if (err) return say(err, 'error')
      afterGitChange(`Created ${name}`)
    } else if (p.kind === 'gotoLine') {
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
      const to = join(dirname(p.target), name)
      const err = rename(p.target, to)
      if (err) return say(err, 'error')
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

  /** Carry out whatever the open confirm prompt was asking about. */
  const confirmPrompt = () => {
    const p = prompt()
    setPrompt(null)
    switch (p?.kind) {
      case 'push': {
        const err = push(rootDir)
        return err ? say(err, 'error') : afterGitChange(`Pushed to ${p.target}`)
      }
      case 'discardFile': {
        const err = discardFile(rootDir, p.target)
        if (err) return say(err, 'error')
        // The buffer is what the user sees, and syncFromDisk deliberately leaves
        // dirty ones alone — so discarding has to reset this one explicitly.
        try {
          setBuffers(p.target, {
            content: readFile(p.target),
            dirty: false,
            mtime: mtimeOf(p.target),
          })
          setReloadKey(k => k + 1)
        } catch {
          closeTab(p.target, true) // the file only existed in the working tree
        }
        syncFromDisk()
        setGitRevision(n => n + 1)
        return say(`Discarded changes in ${basename(p.target)}`)
      }
      case 'undoCommit': {
        const err = undoLastCommit(rootDir)
        return err
          ? say(err, 'error')
          : afterGitChange(`Undid "${p.subject}" — its changes are staged`)
      }
      case 'deleteBranch': {
        const err = deleteBranch(rootDir, p.name)
        return err ? say(err, 'error') : say(`Deleted branch ${p.name}`)
      }
      case 'delete': {
        const err = remove(p.target)
        if (err) return say(err, 'error')
        if (tabs().includes(p.target)) closeTab(p.target, true)
        if (selectedPath() === p.target) setSelectedPath(null)
        refreshTree()
        return say(`Deleted ${basename(p.target)}`)
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
      case 'push':
        return p.publish
          ? {
              title: 'Publish branch',
              verb: 'publish',
              danger: false,
              message: `Publish "${p.target}" and its ${p.ahead} commit(s) to origin?`,
            }
          : {
              title: 'Push',
              verb: 'push',
              danger: false,
              message: `Push ${p.ahead} commit(s) to ${p.target}?`,
            }
      case 'discardFile':
        return {
          title: 'Discard changes',
          verb: 'discard',
          danger: true,
          message: `Discard all changes in "${basename(p.target)}"? This cannot be undone.`,
        }
      case 'undoCommit':
        return {
          title: 'Undo commit',
          verb: 'undo',
          danger: false,
          message: `Undo "${p.subject}"? Its changes stay in the working tree.`,
        }
      case 'deleteBranch':
        return {
          title: 'Delete branch',
          verb: 'delete',
          danger: true,
          message: `Delete branch "${p.name}"?`,
        }
      case 'delete':
        return {
          title: 'Delete',
          verb: 'delete',
          danger: true,
          message: `Delete "${basename(p.target)}"${
            isDirectory(p.target) ? ' and its contents' : ''
          }?`,
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
        diffFile: () => {
          const path = activePath()
          if (!path) return say('No file open', 'warn')
          const text = diffText(rootDir, path)
          if (!text.trim()) return say(`${basename(path)} matches HEAD`)
          setDiff({ title: `Diff — ${basename(path)}`, text })
        },
        diffAll: () => {
          const text = diffText(rootDir)
          if (!text.trim()) return say('Nothing changed since HEAD')
          const files = changedFiles(parseDiff(text))
          setDiff({ title: `Diff — ${files} file${files === 1 ? '' : 's'}`, text })
        },
        undoCommit: () => {
          const subject = lastCommitSubject(rootDir)
          if (!subject) return say('No commit to undo', 'warn')
          setPrompt({ kind: 'undoCommit', subject })
        },
        push: () => {
          // Read HEAD now rather than trusting the cached signal: the user may have
          // checked out something else in another terminal, and push follows HEAD.
          const here = currentBranch(rootDir)
          if (!here) return say('Not on a branch', 'warn')
          const upstream = upstreamOf(rootDir)
          if (!upstream) return say('Not a git repository', 'warn')
          setBranch(here)
          setPrompt({
            kind: 'push',
            target: upstream.name ?? here,
            ahead: upstream.name ? upstream.ahead : unpushedCount(rootDir),
            publish: upstream.name === null,
          })
        },
        pull: () => {
          const err = pull(rootDir)
          if (err) return say(err, 'error')
          afterGitChange('Pulled')
        },
        fetch: () => {
          const err = fetchAll(rootDir)
          if (err) return say(err, 'error')
          const upstream = upstreamOf(rootDir)
          afterGitChange(
            upstream?.name
              ? `Fetched — ${upstream.ahead} ahead, ${upstream.behind} behind ${upstream.name}`
              : 'Fetched',
          )
        },
        discardChanges: () => {
          const path = activePath()
          if (!path) return say('No file open', 'warn')
          setPrompt({ kind: 'discardFile', target: path })
        },
        stash: () => {
          const err = stashAll(rootDir)
          if (err) return say(err, 'error')
          afterGitChange('Stashed all changes')
        },
        popStash: () => {
          const err = popStash(rootDir)
          if (err) return say(err, 'error')
          afterGitChange('Restored the latest stash')
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
      watchTree(rootDir, () => {
        const clashed = syncFromDisk()
        if (clashed.length > 0) {
          say(`${CLASH_WARNING}${clashed.join(', ')}`, 'warn')
        } else if (status().msg.startsWith(CLASH_WARNING)) {
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
        setGitLines(path && !activeBuffer()?.binary ? diffLines(path) : new Map())
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
    if (key.ctrl && k === 'r') return claim(() => setSearch('project'))
    if (key.ctrl && chord(key) && k === 'f') return claim(() => setSearch('project'))
    if (key.ctrl && k === 'f') return claim(() => setSearch('file'))
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
      // Esc first collapses extra carets; only a second one leaves the editor. In
      // vim it belongs to the mode switch, and focus moves synchronously — leaving
      // now means EditorPane's vim handler is already unfocused and never runs.
      const vimOwnsEscape = config.vim && vimMode() !== 'normal'
      if (k === 'escape' && multiCursor() === 0 && sidebar() && !vimOwnsEscape) focusTree()
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
          blocked={overlay()}
          onChange={onEditorChange}
          onCursor={setCursor}
          onFocus={() => setFocus('editor')}
          onVimMode={setVimMode}
          onMultiCursor={setMultiCursor}
        />
      </box>
      <StatusBar
        message={status().msg}
        tone={status().tone}
        filetype={activePath() ? (filetypeForPath(activePath()!) ?? 'plain') : undefined}
        cursor={activePath() ? cursor() : undefined}
        dirty={activeBuffer()?.dirty ?? false}
        vimMode={activePath() ? vimMode() : null}
        branch={branch()}
        ahead={upstream()?.ahead ?? 0}
        behind={upstream()?.behind ?? 0}
        changed={gitStatus().size}
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
                    pinTab(path) // an edited preview must never be recycled
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
      <Show when={diff()}>
        {(open: () => { title: string; text: string }) => (
          <DiffView title={open().title} diff={open().text} onClose={() => setDiff(null)} />
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

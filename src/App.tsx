import { basename, dirname, join } from 'node:path'

import type { KeyEvent } from '@opentui/core'
import { useKeyboard, useRenderer } from '@opentui/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { CommandPalette } from './components/CommandPalette'
import type { Command } from './components/CommandPalette'
import { ConfirmModal } from './components/ConfirmModal'
import { EditorPane } from './components/EditorPane'
import { FileTree } from './components/FileTree'
import { HelpOverlay } from './components/HelpOverlay'
import { PromptModal } from './components/PromptModal'
import { StatusBar } from './components/StatusBar'
import { Tabs } from './components/Tabs'
import { saveConfig } from './config'
import type { TreeNode } from './fs'
import {
  createDir,
  createFile,
  flattenVisible,
  isDirectory,
  readFile,
  remove,
  rename,
  watchTree,
  writeFile,
} from './fs'
import { filetypeForPath, invalidateSyntaxStyle } from './highlight'
import { setTheme, themeLabels, ui } from './theme'
import type { ThemeName } from './theme'

type Focus = 'tree' | 'editor'
interface Buffer {
  content: string
  dirty: boolean
}
type Prompt =
  | { kind: 'newFile'; dir: string }
  | { kind: 'newFolder'; dir: string }
  | { kind: 'rename'; target: string }
  | { kind: 'delete'; target: string }
  | null

const TREE_WIDTH = 30
const PROMPT_TITLES: Record<'newFile' | 'newFolder' | 'rename', string> = {
  newFile: 'New file name',
  newFolder: 'New folder name',
  rename: 'Rename to',
}

export function App({ rootDir, initialTheme }: { rootDir: string; initialTheme: ThemeName }) {
  const renderer = useRenderer()

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [tabs, setTabs] = useState<string[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({})
  const [focus, setFocus] = useState<Focus>('tree')
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [help, setHelp] = useState(false)
  const [palette, setPalette] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [theme, setThemeState] = useState<ThemeName>(initialTheme)
  const [reloadKey, setReloadKey] = useState(0)
  const [cursor, setCursor] = useState({ line: 0, col: 0 })
  const [status, setStatusState] = useState({ msg: 'Ready — Ctrl+P for commands', error: false })

  const nodes = useMemo(() => flattenVisible(rootDir, expanded), [rootDir, expanded])
  const activeBuffer = activePath ? buffers[activePath] : undefined

  // Mirror for the watcher callback, which is created once and would otherwise
  // capture a stale buffers snapshot.
  const buffersRef = useRef(buffers)
  buffersRef.current = buffers

  const setStatus = (msg: string, error = false) => setStatusState({ msg, error })
  // Bump the Set identity so `nodes` recomputes and re-reads the filesystem.
  const refreshTree = () => setExpanded(prev => new Set(prev))
  const expand = (path: string) => setExpanded(prev => new Set(prev).add(path))

  // ---- tree ----------------------------------------------------------------
  const toggleExpand = (path: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const openFile = (path: string) => {
    if (!buffers[path]) {
      try {
        const content = readFile(path)
        setBuffers(prev => ({ ...prev, [path]: { content, dirty: false } }))
      } catch (e) {
        setStatus(`Cannot open ${basename(path)}: ${(e as Error).message}`, true)
        return
      }
    }
    setSelectedPath(path)
    setTabs(prev => (prev.includes(path) ? prev : [...prev, path]))
    setActivePath(path)
    setFocus('editor')
  }

  const activateNode = (node: TreeNode) => {
    setSelectedPath(node.path)
    if (node.isDir) toggleExpand(node.path)
    else openFile(node.path)
  }

  const selectedNode = () => nodes.find(n => n.path === selectedPath)

  const moveSelection = (delta: number) => {
    if (nodes.length === 0) return
    const idx = nodes.findIndex(n => n.path === selectedPath)
    // From no selection, land on the first row regardless of direction.
    const next = idx < 0 ? 0 : Math.max(0, Math.min(nodes.length - 1, idx + delta))
    setSelectedPath(nodes[next]!.path)
  }

  // Directory that new files/folders should be created in.
  const targetDir = () => {
    const node = selectedNode()
    if (!node) return rootDir
    return node.isDir ? node.path : dirname(node.path)
  }

  // ---- tabs / editor -------------------------------------------------------
  const closeTab = (path: string) => {
    setTabs(prev => {
      const idx = prev.indexOf(path)
      const next = prev.filter(p => p !== path)
      if (activePath === path) {
        const fallback = next[idx] ?? next[idx - 1] ?? null
        setActivePath(fallback)
        if (!fallback) setFocus('tree')
      }
      return next
    })
    setBuffers(prev => {
      const { [path]: _drop, ...rest } = prev
      return rest
    })
  }

  const switchTab = (delta: number) => {
    if (tabs.length === 0) return
    const idx = activePath ? tabs.indexOf(activePath) : 0
    openFile(tabs[(idx + delta + tabs.length) % tabs.length]!)
  }

  const saveActive = () => {
    if (!activePath || !activeBuffer) return
    const err = writeFile(activePath, activeBuffer.content)
    if (err) {
      setStatus(`Save failed: ${err}`, true)
      return
    }
    setBuffers(prev => ({ ...prev, [activePath]: { ...prev[activePath]!, dirty: false } }))
    setStatus(`Saved ${basename(activePath)}`)
  }

  const onEditorChange = (text: string) => {
    if (!activePath) return
    setBuffers(prev =>
      prev[activePath]?.content === text
        ? prev
        : { ...prev, [activePath]: { content: text, dirty: true } },
    )
  }

  // ---- prompts -------------------------------------------------------------
  const submitPrompt = (value: string) => {
    const name = value.trim()
    const p = prompt
    setPrompt(null)
    if (!p || p.kind === 'delete' || !name) return

    if (p.kind === 'newFile') {
      const path = join(p.dir, name)
      const err = createFile(path)
      if (err) return setStatus(err, true)
      expand(p.dir)
      openFile(path)
      setStatus(`Created ${name}`)
    } else if (p.kind === 'newFolder') {
      const path = join(p.dir, name)
      const err = createDir(path)
      if (err) return setStatus(err, true)
      expand(path)
      setSelectedPath(path)
      setStatus(`Created ${name}/`)
    } else {
      const to = join(dirname(p.target), name)
      const err = rename(p.target, to)
      if (err) return setStatus(err, true)
      setTabs(prev => prev.map(t => (t === p.target ? to : t)))
      setBuffers(prev => {
        const buf = prev[p.target]
        if (!buf) return prev
        const { [p.target]: _old, ...rest } = prev
        return { ...rest, [to]: buf }
      })
      if (activePath === p.target) setActivePath(to)
      setSelectedPath(to)
      refreshTree()
      setStatus(`Renamed to ${name}`)
    }
  }

  const doDelete = () => {
    const p = prompt
    setPrompt(null)
    if (p?.kind !== 'delete') return
    const err = remove(p.target)
    if (err) return setStatus(err, true)
    if (tabs.includes(p.target)) closeTab(p.target)
    if (selectedPath === p.target) setSelectedPath(null)
    refreshTree()
    setStatus(`Deleted ${basename(p.target)}`)
  }

  // ---- theme / commands ----------------------------------------------------
  const applyTheme = (name: ThemeName) => {
    setTheme(name)
    invalidateSyntaxStyle()
    setThemeState(name)
    saveConfig({ theme: name })
    setStatus(`Theme: ${themeLabels[name]}`)
  }

  const quit = () => {
    renderer.destroy()
    process.exit(0)
  }

  const withNode = (run: (node: TreeNode) => void) => () => {
    const node = selectedNode()
    if (node) run(node)
  }

  // Command palette entries (Ctrl+P). Everything reachable by keyboard, in one list.
  const commands: (Command & { run: () => void })[] = [
    { id: 'save', label: 'Save file', hint: 'Ctrl+S', run: saveActive },
    {
      id: 'newFile',
      label: 'New file',
      hint: 'Ctrl+N',
      run: () => setPrompt({ kind: 'newFile', dir: targetDir() }),
    },
    {
      id: 'newFolder',
      label: 'New folder',
      hint: 'Ctrl+Shift+N',
      run: () => setPrompt({ kind: 'newFolder', dir: targetDir() }),
    },
    {
      id: 'rename',
      label: 'Rename…',
      hint: 'r',
      run: withNode(n => setPrompt({ kind: 'rename', target: n.path })),
    },
    {
      id: 'delete',
      label: 'Delete…',
      hint: 'd',
      run: withNode(n => setPrompt({ kind: 'delete', target: n.path })),
    },
    {
      id: 'close',
      label: 'Close tab',
      hint: 'Ctrl+W',
      run: () => void (activePath && closeTab(activePath)),
    },
    { id: 'next', label: 'Next tab', hint: 'Ctrl+→', run: () => switchTab(1) },
    { id: 'prev', label: 'Previous tab', hint: 'Ctrl+←', run: () => switchTab(-1) },
    {
      id: 'focus',
      label: 'Toggle tree / editor',
      hint: 'Ctrl+B',
      run: () => setFocus(f => (f === 'tree' ? 'editor' : 'tree')),
    },
    { id: 'theme.dark', label: `Theme: ${themeLabels.dark}`, run: () => applyTheme('dark') },
    { id: 'theme.light', label: `Theme: ${themeLabels.light}`, run: () => applyTheme('light') },
    { id: 'help', label: 'Keyboard shortcuts', run: () => setHelp(true) },
    { id: 'quit', label: 'Quit', hint: 'Ctrl+Q', run: quit },
  ]

  const runCommand = (id: string) => {
    setPalette(false)
    commands.find(c => c.id === id)?.run()
  }

  // ---- watch disk ----------------------------------------------------------
  // Reload clean open buffers and refresh the tree when files change externally.
  useEffect(() => {
    const reload = () => {
      const cur = buffersRef.current
      const updates: Record<string, Buffer> = {}
      for (const path in cur) {
        const buf = cur[path]!
        if (buf.dirty) continue // never clobber unsaved edits
        try {
          const disk = readFile(path)
          if (disk !== buf.content) updates[path] = { content: disk, dirty: false }
        } catch {
          // file gone — the tree refresh below reflects it
        }
      }
      if (Object.keys(updates).length > 0) {
        setBuffers(prev => ({ ...prev, ...updates }))
        setReloadKey(k => k + 1)
      }
      refreshTree()
    }
    return watchTree(rootDir, reload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootDir])

  // ---- keyboard ------------------------------------------------------------
  useKeyboard((key: KeyEvent) => {
    const k = key.name

    // Overlays own their keys (handled inside their own components).
    if (help) {
      if (k === 'escape') setHelp(false)
      return
    }
    if (prompt || palette || completing) return

    // Global shortcuts.
    if (key.ctrl && k === 'q') return quit()
    if (key.ctrl && k === 'p') return setPalette(true)
    if (key.ctrl && k === 's') return saveActive()
    if (key.ctrl && k === 'w') return void (activePath && closeTab(activePath))
    if (key.ctrl && key.shift && k === 'n')
      return setPrompt({ kind: 'newFolder', dir: targetDir() })
    if (key.ctrl && k === 'n') return setPrompt({ kind: 'newFile', dir: targetDir() })
    if (key.ctrl && k === 'b') return setFocus(f => (f === 'tree' ? 'editor' : 'tree'))
    if (key.ctrl && k === 'left') return switchTab(-1)
    if (key.ctrl && k === 'right') return switchTab(1)

    if (focus === 'editor') {
      if (k === 'escape') setFocus('tree')
      return // everything else belongs to the textarea
    }

    // Tree navigation.
    const node = selectedNode()
    switch (k) {
      case 'tab':
        if (activePath) setFocus('editor')
        break
      case 'up':
        moveSelection(-1)
        break
      case 'down':
        moveSelection(1)
        break
      case 'right':
        if (node?.isDir && !expanded.has(node.path)) toggleExpand(node.path)
        else moveSelection(1)
        break
      case 'left':
        if (node?.isDir && expanded.has(node.path)) toggleExpand(node.path)
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

  // ---- render --------------------------------------------------------------
  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={ui.bg}>
      <Tabs
        tabs={tabs.map(p => ({ path: p, name: basename(p), dirty: buffers[p]?.dirty ?? false }))}
        activePath={activePath}
        onSelect={openFile}
        onClose={closeTab}
      />
      <box flexDirection="row" flexGrow={1}>
        <FileTree
          rootName={basename(rootDir) || rootDir}
          nodes={nodes}
          selectedPath={selectedPath}
          expanded={expanded}
          focused={focus === 'tree'}
          width={TREE_WIDTH}
          onActivate={activateNode}
          onFocus={() => setFocus('tree')}
        />
        <EditorPane
          path={activePath}
          content={activeBuffer?.content ?? ''}
          filetype={activePath ? filetypeForPath(activePath) : undefined}
          focused={focus === 'editor'}
          theme={theme}
          reloadKey={reloadKey}
          onChange={onEditorChange}
          onCursor={setCursor}
          onFocus={() => setFocus('editor')}
          onCompletingChange={setCompleting}
        />
      </box>
      <StatusBar
        message={status.msg}
        isError={status.error}
        filetype={activePath ? (filetypeForPath(activePath) ?? 'plain') : undefined}
        cursor={activePath ? cursor : undefined}
        dirty={activeBuffer?.dirty ?? false}
      />

      {prompt && prompt.kind !== 'delete' && (
        <PromptModal
          title={PROMPT_TITLES[prompt.kind]}
          initialValue={prompt.kind === 'rename' ? basename(prompt.target) : ''}
          onSubmit={submitPrompt}
          onCancel={() => setPrompt(null)}
        />
      )}
      {prompt?.kind === 'delete' && (
        <ConfirmModal
          message={`Delete "${basename(prompt.target)}"${isDirectory(prompt.target) ? ' and its contents' : ''}?`}
          onConfirm={doDelete}
          onCancel={() => setPrompt(null)}
        />
      )}
      {palette && (
        <CommandPalette commands={commands} onRun={runCommand} onClose={() => setPalette(false)} />
      )}
      {help && <HelpOverlay />}
    </box>
  )
}

import { basename } from 'node:path'

import type { MouseEvent } from '@opentui/core'
import { useRenderer, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'

import { watchAppearance } from '../core/appearance'
import { CONFIG_FILE } from '../core/config'
import type { Config } from '../core/config'
import { watchTree } from '../core/fs'
import { isImagePath } from '../core/image'
import { checkForUpdate, currentVersion } from '../core/update'
import { languageLabel } from '../languages'
import { filetypeForPath } from '../languages/highlight'
import { SEVERITY_RANK } from '../lsp/protocol'
import type { ProblemSeverity } from '../lsp/protocol'
import { ui } from '../themes'
import { DiffView } from '../ui/DiffView'
import type { DiffFile } from '../ui/DiffView'
import { EditorPane } from '../ui/EditorPane'
import { FileTree } from '../ui/FileTree'
import { GitPanel } from '../ui/GitPanel'
import { ImageView } from '../ui/ImageView'
import { SettingsView } from '../ui/SettingsView'
import { SidebarTabs } from '../ui/SidebarTabs'
import { StatusBar } from '../ui/StatusBar'
import { Tabs } from '../ui/Tabs'
import { createCommands } from './actions'
import { createBranches } from './branches'
import type { AppContext } from './context'
import { createEditorBridge } from './editor'
import { createFileOps } from './fileOps'
import { createGit, createGitOp, wireGitEffects } from './git'
import { installKeyboard } from './keyboard'
import { createLsp, wireLspEffects } from './lsp'
import { createOverlays, OverlayStack } from './Overlays'
import { createPanes } from './panes'
import { createPromptHandlers, createPromptState } from './prompts'
import { createSettings } from './settings'
import { createStatus, READY } from './status'
import { createTree, hiddenNodes } from './tree'
import { CLASH_CHANGED, CLASH_DELETED, createWorkspace, restoreWorkspace } from './workspace'

/** Rows the divider's grip occupies — long enough to aim at, short enough to be a grip. */
const GRIP = [0, 1, 2, 3, 4]

/**
 * The composition root. Each concern lives in its own controller module; this
 * component creates them in dependency order, hands the assembled context to the
 * keyboard and palette wiring, and renders the layout around them.
 */
export function App(props: {
  rootDir: string
  /** `druk file.ts`: the one file to open, instead of the project's saved session. */
  openFile?: string | null
  /** `druk file.ts:42`: 0-based line to land on in `openFile`. */
  openLine?: number | null
  initialConfig: Config
  /**
   * The startup update check is unconditional for users — this switch exists so
   * the test harness can keep hundreds of launches off the npm registry.
   */
  checkUpdates?: boolean
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const rootDir = props.rootDir
  const single = props.openFile ?? null

  const restored = restoreWorkspace(rootDir, single)

  const status = createStatus()
  const editor = createEditorBridge(props.initialConfig.vim)
  const settings = createSettings({ initial: props.initialConfig, status, editor, dimensions })
  const tree = createTree(
    rootDir,
    { expanded: restored.expanded, selected: restored.activePath },
    () => hiddenNodes(rootDir, settings.config),
  )
  const panes = createPanes(tree, restored.sidebar)
  const git = createGit(rootDir, () => settings.config.gitPanelView)
  const lsp = createLsp({ rootDir, settings, status })
  // Also on the quit path: the renderer tears the root down before exiting, and
  // a leaked server would outlive the editor (tests leak them per launch).
  onCleanup(lsp.dispose)
  const promptState = createPromptState()
  const workspace = createWorkspace({
    rootDir,
    single,
    restored,
    settings,
    status,
    tree,
    panes,
    editor,
    git,
    setPrompt: promptState.setPrompt,
  })
  const fileOps = createFileOps({ rootDir, status, tree, workspace })
  const gitOp = createGitOp({ rootDir, git, status, workspace })
  const branches = createBranches({ rootDir, status, git, gitOp, prompts: promptState })
  const promptHandlers = createPromptHandlers({
    rootDir,
    renderer,
    state: promptState,
    status,
    tree,
    panes,
    editor,
    workspace,
    fileOps,
    gitOp,
    branches,
  })
  const overlays = createOverlays({
    renderer,
    promptState,
    workspace,
    git,
    branches,
    panes,
    editor,
  })

  const ctx: AppContext = {
    rootDir,
    status,
    settings,
    tree,
    panes,
    editor,
    git,
    gitOp,
    lsp,
    branches,
    workspace,
    fileOps,
    prompts: { ...promptState, ...promptHandlers },
    overlays,
  }

  wireGitEffects({ rootDir, git, tree, editor, workspace, config: settings.config })
  wireLspEffects({ lsp, settings, workspace })
  const { commands, actions } = createCommands(ctx)
  installKeyboard(ctx, actions)

  // `revision` covers saves, git commands and anything the watcher sees in .git;
  // `reloadKey` covers a buffer replaced from disk; `diffBase` covers the branch
  // being compared against moving under it. `refreshDiff` returns at once when no
  // diff is open, so the subprocess it needs is only ever spawned for a page that
  // is actually on screen.
  //
  // It reads `gitStatus`, which `wireGitEffects` fills from the same three — and
  // does so first, since effects run in creation order and that call is above.
  createEffect(
    on(() => [git.revision(), editor.reloadKey(), git.diffBase()] as const, actions.refreshDiff),
  )

  const { config } = settings
  const { say } = status

  /** True between grabbing the sidebar divider and letting go. */
  const [resizing, setResizing] = createSignal(false)

  /** Worst problem per line of the active file: the gutter dot and inline text. */
  const problemLines = createMemo(() => {
    const lines = new Map<number, { severity: ProblemSeverity; message: string }>()
    const path = workspace.activePath()
    if (!path) return lines
    for (const problem of lsp.problems[path] ?? []) {
      const held = lines.get(problem.line)
      if (!held || SEVERITY_RANK[problem.severity] < SEVERITY_RANK[held.severity]) {
        lines.set(problem.line, { severity: problem.severity, message: problem.message })
      }
    }
    return lines
  })

  /** Every problem of the active file with its range, for the underlines. */
  const problemRanges = createMemo(() => {
    const path = workspace.activePath()
    return (path ? lsp.problems[path] : undefined) ?? []
  })

  const problemCounts = createMemo(() => {
    const path = workspace.activePath()
    let errors = 0
    let warnings = 0
    for (const problem of (path ? lsp.problems[path] : undefined) ?? []) {
      if (problem.severity === 'error') errors++
      else if (problem.severity === 'warning') warnings++
    }
    return { errors, warnings }
  })

  /** The active tab when it is an image — a viewer page covers the editor slot. */
  const activeImage = () => {
    const path = workspace.activePath()
    return path && isImagePath(path) ? path : null
  }

  /** The diff was opened from the source-control panel, and the panel is still
   * there to go back to. */
  const backToPanel = () => panes.sidebar() && panes.view() === 'git'

  onMount(() => {
    // Same refusal `druk file.ts` deserves as opening one from the tree, and for the
    // same reason: an empty editor with a status line under it looks like a bug.
    if (restored.failed) workspace.setNotice({ name: basename(single!), reason: restored.failed })
    const line = props.openLine
    const buffer = workspace.activeBuffer()
    if (line != null && buffer) {
      const total = buffer.content.split('\n').length
      editor.requestGoto(Math.min(line, total - 1), 0)
    }
  })

  // Polling, not a subscription: no OS offers one portably. `watchAppearance`
  // reports the current appearance straight away, so turning the setting on — and
  // starting with it already on — paints the matching theme without waiting a tick.
  createEffect(
    on(
      () => config.themeSync,
      sync => {
        if (!sync) return
        onCleanup(watchAppearance(settings.applyAppearance))
      },
    ),
  )

  onMount(() => {
    if (props.checkUpdates === false) return
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    void (async () => {
      const info = await checkForUpdate()
      if (!cancelled && info && info.latest !== props.initialConfig.skipUpdate) {
        overlays.setUpdate(info)
      }
    })()
  })

  // Focus reporting (DECSET 1004): the terminal sends CSI I / CSI O as the window
  // gains / loses focus. OpenTUI's key parser recognises both and swallows them,
  // so the raw stdin stream is the only place left to see the blur. The mode is
  // enabled only on a real terminal — in tests stdin is a mock and there is no
  // terminal to answer — but the listener is always attached, so a test can drive
  // it by emitting the sequence.
  onMount(() => {
    if (process.stdout.isTTY) process.stdout.write('\x1B[?1004h')
    const onStdin = (chunk: Buffer | string) => {
      if (config.autoSaveOnBlur && chunk.toString().includes('\x1B[O')) {
        workspace.saveDirtyOnBlur()
      }
    }
    renderer.stdin.on('data', onStdin)
    onCleanup(() => {
      renderer.stdin.off('data', onStdin)
      if (process.stdout.isTTY) process.stdout.write('\x1B[?1004l')
    })
  })

  // The watcher has no follow-up message of its own, so unlike the git callers it
  // reports the clash itself — and clears it again once the files agree, since
  // nothing else would ever replace a warning the user has already dealt with.
  onMount(() =>
    onCleanup(
      watchTree(rootDir, changed => {
        // History moved elsewhere: nothing in the working tree need have changed, so
        // this is the only thing that tells the branch and ahead/behind to re-read.
        if (changed.git) git.bump()
        if (!changed.tree) return
        const warning = workspace.clashWarning(workspace.syncFromDisk())
        if (warning) {
          say(warning, 'warn')
        } else if (
          status.status().msg.startsWith(CLASH_CHANGED) ||
          status.status().msg.startsWith(CLASH_DELETED)
        ) {
          say(READY)
        }
      }),
    ),
  )

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={ui.bg}>
      <Tabs
        tabs={workspace.views().map(id => ({
          id,
          // The diff's own tab, marked as one: a file and its diff are two tabs
          // for one path, and the strip has to say which is which.
          name: workspace.isDiffView(id) ? `⇄ ${basename(id)}` : basename(id),
          dirty: workspace.buffers[id]?.dirty ?? false,
          preview: id === workspace.previewPath(),
        }))}
        activeId={workspace.activeView()}
        onSelect={workspace.showView}
        onClose={workspace.closeView}
        onOverflow={() => overlays.setPicker('tabs')}
      />
      {/* Drag capture lives on the row, not the divider: the pointer leaves a
          one-column target immediately, and each drag event is delivered to
          whatever sits under it. */}
      <box
        flexDirection="row"
        flexGrow={1}
        onMouseDrag={(event: MouseEvent) => {
          if (resizing()) settings.resizeSidebar(event.x)
        }}
        onMouseDragEnd={() => setResizing(false)}
        onMouseUp={() => setResizing(false)}
      >
        <Show when={panes.sidebar()}>
          <box
            width={settings.treeWidth()}
            flexShrink={0}
            flexDirection="column"
            backgroundColor={ui.sidebarBg}
          >
            <SidebarTabs
              view={panes.view()}
              focused={panes.focus() === 'tree'}
              onSelect={view => panes.showView(view)}
            />
            <Show
              when={panes.view() === 'git'}
              fallback={
                <FileTree
                  rootName={basename(rootDir) || rootDir}
                  nodes={tree.nodes()}
                  selectedPath={tree.selectedPath()}
                  expanded={tree.expanded()}
                  focused={panes.focus() === 'tree'}
                  width={settings.treeWidth()}
                  gitStatus={git.gitStatus()}
                  gitIgnored={git.gitIgnored()}
                  cutPaths={fileOps.cut()}
                  markedPaths={tree.marked()}
                  onActivate={node => {
                    // Landing in a file is how a page closes — the tree stays
                    // interactive while one is up, like any other editor page.
                    workspace.setDiff(null)
                    workspace.setSettingsPage(false)
                    workspace.activateNode(node)
                  }}
                  onPin={node => workspace.pinTab(node.path)}
                  onFocus={() => panes.setFocus('tree')}
                />
              }
            >
              <GitPanel
                branch={git.branch()}
                ahead={git.upstream()?.ahead ?? 0}
                behind={git.upstream()?.behind ?? 0}
                rows={git.rows()}
                base={git.diffBase()}
                cursor={panes.gitCursor()}
                focused={panes.focus() === 'tree'}
                width={settings.treeWidth()}
                inRepo={git.inRepo()}
                onFocus={() => panes.setFocus('tree')}
                onActivate={actions.gitActivateRow}
              />
            </Show>
          </box>
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
              settings.resizeSidebar(event.x)
            }}
          >
            <box flexGrow={1} backgroundColor={ui.bg} />
            <For each={GRIP}>
              {() => <text fg={resizing() ? ui.accent : ui.scrollbar} bg={ui.bg} content="│" />}
            </For>
            <box flexGrow={1} backgroundColor={ui.bg} />
          </box>
        </Show>
        {/* The diff pane sits over the editor's slot only, so the tabs, tree and
            status bar stay put — it reads as a view of the editor, not a modal. */}
        <box flexGrow={1} flexDirection="column">
          <EditorPane
            path={workspace.activePath()}
            content={workspace.activeBuffer()?.content ?? ''}
            rootName={basename(rootDir) || rootDir}
            branch={git.branch()}
            version={currentVersion()}
            filetype={workspace.activePath() ? filetypeForPath(workspace.activePath()!) : undefined}
            // Also unfocused while the diff or an image viewer covers the pane:
            // the terminal's own cursor tracks the focused textarea and is drawn
            // over everything, so a focused editor bleeds a phantom block into
            // whatever page sits on top.
            focused={
              panes.focus() === 'editor' &&
              !workspace.diff() &&
              !workspace.settingsPage() &&
              !activeImage()
            }
            theme={config.theme}
            reloadKey={editor.reloadKey()}
            goto={editor.goto()}
            history={editor.history()}
            edit={editor.edit()}
            lineOp={editor.lineOp()}
            vim={config.vim}
            tabSize={config.tabSize}
            gitLines={git.gitLines()}
            problems={problemLines()}
            problemRanges={problemRanges()}
            problemText={config.lspInline}
            complete={
              config.lsp && config.lspCompletion
                ? (line, col) => {
                    const path = workspace.activePath()
                    return path ? lsp.complete(path, line, col) : Promise.resolve(null)
                  }
                : null
            }
            resolveCompletion={
              config.lsp && config.lspCompletion
                ? item => {
                    const path = workspace.activePath()
                    return path ? lsp.resolveCompletion(path, item) : Promise.resolve(null)
                  }
                : null
            }
            completionRequest={editor.completion()}
            onCompletionMenu={editor.setCompletionOpen}
            notice={workspace.notice()}
            // The diff is a page over this pane, not an overlay — but the hidden
            // textarea must still not eat keys meant for it.
            blocked={
              overlays.overlay() ||
              workspace.diff() !== null ||
              workspace.settingsPage() ||
              activeImage() !== null
            }
            onChange={workspace.onEditorChange}
            onCursor={editor.setCursor}
            onFocus={() => panes.setFocus('editor')}
            onVimMode={editor.setVimMode}
            onQuit={promptHandlers.quit}
          />
          <Show when={activeImage()}>
            {(path: () => string) => (
              <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={40}>
                <ImageView
                  path={path()}
                  width={dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)}
                  height={dimensions().height - 2}
                  onFocus={() => panes.setFocus('editor')}
                />
              </box>
            )}
          </Show>
          <Show when={workspace.settingsPage()}>
            <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={60}>
              <SettingsView
                rows={settings.rows()}
                configFile={CONFIG_FILE}
                width={dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)}
                focused={panes.focus() === 'editor'}
                blocked={overlays.overlay()}
                onFocus={() => panes.setFocus('editor')}
                onClose={() => workspace.setSettingsPage(false)}
              />
            </box>
          </Show>
          <Show when={workspace.diff()}>
            {(file: () => DiffFile) => (
              <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={50}>
                <DiffView
                  file={file()}
                  mode={config.diffView}
                  width={dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)}
                  focused={panes.focus() === 'editor'}
                  blocked={overlays.overlay()}
                  onFocus={() => panes.setFocus('editor')}
                  onToggleMode={settings.toggleDiffView}
                  escLabel={backToPanel() ? 'panel' : 'close'}
                  onClose={() => {
                    // The panel is the only thing that pages to the next change,
                    // so Esc here gives the focus back to it rather than closing:
                    // Tab into the diff would otherwise be a dead end, with the
                    // arrows scrolling and nothing left that moves to another file.
                    if (backToPanel()) panes.focusTree()
                    else workspace.setDiff(null)
                  }}
                />
              </box>
            )}
          </Show>
        </box>
      </box>
      <StatusBar
        message={status.status().msg}
        tone={status.status().tone}
        filetype={
          activeImage()
            ? 'image'
            : workspace.activePath()
              ? languageLabel(filetypeForPath(workspace.activePath()!) ?? 'plain')
              : undefined
        }
        // A viewer tab has no caret: the numbers would be wherever the editor last was.
        cursor={workspace.activePath() && !activeImage() ? editor.cursor() : undefined}
        dirty={workspace.activeBuffer()?.dirty ?? false}
        vimMode={workspace.activePath() && !activeImage() ? editor.vimMode() : null}
        branch={git.branch()}
        ahead={git.upstream()?.ahead ?? 0}
        behind={git.upstream()?.behind ?? 0}
        changed={git.gitStatus().size}
        problems={problemCounts()}
        focus={panes.focus()}
        busy={status.busy()}
      />
      <OverlayStack ctx={ctx} commands={commands} />
    </box>
  )
}

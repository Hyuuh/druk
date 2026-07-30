import { basename } from 'node:path'

import type { BorderSides, MouseEvent } from '@opentui/core'
import { useRenderer, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js'

import { watchAppearance } from '../core/appearance'
import { loadProjectConfig, resolveConfig } from '../core/config'
import type { Config } from '../core/config'
import { watchTree } from '../core/fs'
import { isImagePath } from '../core/image'
import { checkForUpdate, currentVersion } from '../core/update'
import { languageLabel } from '../languages'
import { filetypeForPath } from '../languages/highlight'
import { SEVERITY_RANK } from '../lsp/protocol'
import type { ProblemSeverity } from '../lsp/protocol'
import { ui } from '../themes'
import { ComparePanel } from '../ui/ComparePanel'
import { ComparisonView } from '../ui/ComparisonView'
import { DiffView } from '../ui/DiffView'
import type { DiffFile } from '../ui/DiffView'
import { EditorPane } from '../ui/EditorPane'
import { FileTree } from '../ui/FileTree'
import { GitPanel } from '../ui/GitPanel'
import { ImageView } from '../ui/ImageView'
import { MarkdownView } from '../ui/MarkdownView'
import { SettingsView } from '../ui/SettingsView'
import { SidebarTabs } from '../ui/SidebarTabs'
import { StatusBar } from '../ui/StatusBar'
import { Tabs } from '../ui/Tabs'
import { createCommands } from './actions'
import { createBranches } from './branches'
import { createComparison } from './comparison'
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

/** The divider draws its own left edge; a box border is how it spans the height. */
const BORDER_LEFT: BorderSides[] = ['left']

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
  /** The user's own settings; the project's overrides go on top of them. */
  initialConfig: Config
  /**
   * `<rootDir>/.druk/settings.json`, already read — main.tsx needs it before the
   * first render to paint the right theme, and reading it twice would be waste.
   * Left out, it is read here.
   */
  initialProject?: Partial<Config>
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
  const project = props.initialProject ?? loadProjectConfig(rootDir)
  const initial = resolveConfig(props.initialConfig, project)
  const editor = createEditorBridge(initial.vim)
  const settings = createSettings({
    user: props.initialConfig,
    project,
    rootDir,
    status,
    editor,
    dimensions,
  })
  const tree = createTree(
    rootDir,
    { expanded: restored.expanded, selected: restored.activePath },
    () => hiddenNodes(rootDir, settings.config),
  )
  const panes = createPanes(tree, restored.sidebar)
  const git = createGit(rootDir, () => settings.config.gitPanelView)
  const comparison = createComparison({ rootDir, git, status })
  const promptState = createPromptState()
  const lsp = createLsp({ rootDir, settings, status, prompts: promptState })
  // Also on the quit path: the renderer tears the root down before exiting, and
  // a leaked server would outlive the editor (tests leak them per launch).
  onCleanup(lsp.dispose)
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
    lsp,
  })
  const overlays = createOverlays({
    renderer,
    promptState,
    workspace,
    git,
    branches,
    comparison,
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
    comparison,
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
    on(
      () => [git.revision(), editor.reloadKey(), git.diffBase()] as const,
      () => {
        actions.refreshDiff()
        comparison.refresh()
      },
    ),
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

  const closeComparisonDetail = () => {
    comparison.closeDetail()
    panes.focusTree()
  }

  /** The diff was opened from the source-control panel, and the panel is still
   * there to go back to. */
  const backToPanel = () => panes.sidebar() && panes.view() === 'git'

  onMount(() => {
    // A shortcut that did not take is invisible until the key is pressed and
    // nothing happens, so a bad `keybindings` entry is reported on the way in.
    const { invalid, conflicts } = settings.keymap()
    const bad = invalid[0]
    const clash = conflicts.find(entry => entry.rejected)
    if (bad) say(`Shortcut "${bad.value}" for ${bad.label}: ${bad.reason}`, 'warn')
    else if (clash) {
      say(
        `${clash.key} is bound twice — ${clash.winner} keeps it, ${clash.loser} has no key`,
        'warn',
      )
    }
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
      if (!cancelled && info && info.latest !== initial.skipUpdate) {
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
          // for one path, and the strip has to say which is which. A markdown tab
          // reading as the rendered document is still the one tab, so it is the
          // same name with a mark rather than a second entry.
          name: workspace.isDiffView(id)
            ? `⇄ ${basename(id)}`
            : id === workspace.renderedPath()
              ? `¶ ${basename(id)}`
              : basename(id),
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
              <Show
                when={comparison.active()}
                fallback={
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
                }
              >
                <ComparePanel
                  state={comparison.state()}
                  comparison={comparison.result()}
                  files={comparison.filteredFiles()}
                  commits={comparison.filteredCommits()}
                  mode={comparison.mode()}
                  cursor={
                    comparison.mode() === 'files'
                      ? comparison.fileCursor()
                      : comparison.commitCursor()
                  }
                  focused={panes.focus() === 'tree'}
                  width={settings.treeWidth()}
                  error={comparison.error()}
                  onFocus={() => panes.setFocus('tree')}
                  onActivate={index => {
                    if (comparison.mode() === 'files') {
                      comparison.move(index - comparison.fileCursor())
                    } else {
                      comparison.move(index - comparison.commitCursor())
                    }
                    comparison.openSelection()
                  }}
                />
              </Show>
            </Show>
          </box>
          {/* The sidebar's edge, and the grab target that resizes it. A rule the
              whole way down rather than a short grip at the middle: in `border` it
              is the quietest line on screen and reads as where one pane ends,
              where five glyphs floating in the middle of an empty pane read as
              debris. The accent while dragging says the grab took. Painted in
              `bg`, not `panelBg` — the sidebar's right edge is found by where
              panel colour stops, and the resize tests measure exactly that. The
              sidebar starts at column 0, so the pointer's x is the width asked
              for. */}
          <box
            width={1}
            flexShrink={0}
            flexDirection="column"
            backgroundColor={ui.bg}
            border={BORDER_LEFT}
            borderColor={resizing() ? ui.accent : ui.border}
            onMouseDown={(event: MouseEvent) => {
              setResizing(true)
              settings.resizeSidebar(event.x)
            }}
          />
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
              !comparison.detailOpen() &&
              !activeImage() &&
              !workspace.renderedPath()
            }
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
              comparison.detailOpen() ||
              activeImage() !== null ||
              workspace.renderedPath() !== null
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
          <Show when={workspace.renderedPath()}>
            {(path: () => string) => (
              <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={40}>
                <MarkdownView
                  path={path()}
                  name={basename(path())}
                  content={workspace.buffers[path()]?.content ?? ''}
                  width={dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)}
                  focused={panes.focus() === 'editor'}
                  blocked={overlays.overlay()}
                  onFocus={() => panes.setFocus('editor')}
                  onShowSource={workspace.toggleRendered}
                />
              </box>
            )}
          </Show>
          <Show when={workspace.settingsPage()}>
            <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={60}>
              <SettingsView
                rows={settings.rows()}
                scope={settings.scope()}
                onToggleScope={settings.toggleScope}
                configFile={settings.configFile()}
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
          <Show when={comparison.detailOpen()}>
            <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={55}>
              <ComparisonView
                file={comparison.selectedFile()}
                content={comparison.selectedContent()}
                commit={comparison.selectedCommit()}
                mode={config.diffView}
                width={dimensions().width - (panes.sidebar() ? settings.treeWidth() + 1 : 0)}
                focused={panes.focus() === 'editor'}
                blocked={overlays.overlay()}
                onFocus={() => panes.setFocus('editor')}
                onMoveFile={comparison.moveDetail}
                onToggleMode={settings.toggleDiffView}
                onClose={closeComparisonDetail}
              />
            </box>
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
        cursor={
          workspace.activePath() && !activeImage() && !workspace.renderedPath()
            ? editor.cursor()
            : undefined
        }
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

import { relative } from 'node:path'

import { createMemo } from 'solid-js'

import { readFile } from '../core/fs'
import type { TreeNode } from '../core/fs'
import {
  fetchRemote,
  headText,
  inRepository,
  lastCommitSubject,
  pull,
  push,
  stagedPaths,
  stashPop,
  stashPush,
  statusMap,
} from '../core/git'
import type { FileStatus } from '../core/git'
import type { DiffFile } from '../ui/DiffView'
import { buildCommands } from './commands'
import type { Command } from './commands'
import type { AppContext } from './context'

/** Wire the palette's command tree to the controllers that carry the actions out. */
export function createCommands(ctx: AppContext) {
  const {
    rootDir,
    status,
    settings,
    tree,
    panes,
    editor,
    git,
    gitOp,
    comparison,
    workspace,
    fileOps,
  } = ctx
  const { say } = status
  const { config } = settings

  /** For commands that act on the tree selection, which the palette can run without one. */
  const withNode = (run: (node: TreeNode) => void) => () => {
    const node = tree.selectedNode()
    if (node) run(node)
    else say('Select a file in the tree first', 'warn')
  }

  /**
   * Both texts of one file's diff. The new side prefers the open buffer over the
   * disk, so unsaved edits show — that is the diff the user is looking at. Null
   * for a file that cannot be read (binary), which the callers skip.
   */
  const diffFileFor = (path: string, fileStatus: FileStatus): DiffFile | null => {
    const rel = relative(rootDir, path)
    const oldText = fileStatus === 'untracked' ? '' : (headText(rootDir, rel) ?? '')
    let newText = ''
    if (fileStatus !== 'deleted') {
      const open = workspace.buffers[path]
      if (open) {
        newText = open.content
      } else {
        try {
          newText = readFile(path)
        } catch {
          return null
        }
      }
    }
    return { path, rel, status: fileStatus, oldText, newText }
  }

  /**
   * Show one changed file's diff over the editor slot. The source-control
   * panel's cursor is what pages through the changes, so everything that opens
   * a diff moves that cursor first and calls this second — a page the arrows
   * cannot move from is a dead end.
   */
  const showDiff = (path: string) => {
    // The panel only lists changed files, but its list is a frame behind a fresh
    // edit — 'modified' is the fallback for a path git has not caught up with,
    // and diffing it against HEAD is right either way.
    const file = diffFileFor(path, git.gitStatus().get(path) ?? 'modified')
    if (!file) return say('Cannot diff this file', 'warn')
    ctx.overlays.setSettingsPage(false)
    ctx.overlays.setDiff(file)
  }

  const actions = {
    save: workspace.saveActive,
    openFile: () => ctx.overlays.setPicker('files'),
    switchTab: () => ctx.overlays.setPicker('tabs'),
    closeOthers: () => {
      const keep = workspace.activePath()
      if (keep)
        workspace.closeTabs(
          workspace.tabs().filter(path => path !== keep),
          'Closed other tabs',
        )
    },
    closeAll: () => workspace.closeTabs(workspace.tabs(), 'Closed all tabs'),
    gotoLine: () => ctx.prompts.setPrompt({ kind: 'gotoLine' }),
    undo: () => editor.requestHistory('undo'),
    redo: () => editor.requestHistory('redo'),
    findInFile: () => ctx.overlays.setSearch({ scope: 'file' }),
    findInProject: () => ctx.overlays.setSearch({ scope: 'project' }),
    replaceInFile: () => ctx.overlays.setSearch({ scope: 'file', replacing: true }),
    newFile: () => ctx.prompts.setPrompt({ kind: 'newFile', dir: tree.targetDir() }),
    newFolder: () => ctx.prompts.setPrompt({ kind: 'newFolder', dir: tree.targetDir() }),
    rename: withNode(n => ctx.prompts.setPrompt({ kind: 'rename', target: n.path })),
    remove: () => {
      const targets = tree.actionTargets()
      if (targets.length === 0) return say('Nothing selected', 'warn')
      ctx.prompts.setPrompt({ kind: 'delete', targets })
    },
    cutForMove: () => fileOps.takeForPaste('cut'),
    copyForPaste: () => fileOps.takeForPaste('copy'),
    paste: fileOps.paste,
    closeTab: () => void (workspace.activePath() && workspace.closeTab(workspace.activePath()!)),
    reopenTab: workspace.reopenTab,
    nextTab: () => workspace.switchTab(1),
    prevTab: () => workspace.switchTab(-1),
    toggleFocus: () => (panes.focus() === 'tree' ? panes.setFocus('editor') : panes.focusTree()),
    toggleSidebar: panes.toggleSidebar,
    toggleGitView: panes.toggleGitView,
    setTheme: settings.applyTheme,
    lineOp: editor.requestLineOp,
    openSettings: () => {
      // One page at a time: the slot under the settings page is the editor's.
      ctx.overlays.setDiff(null)
      ctx.overlays.setSettingsPage(true)
      panes.setFocus('editor')
    },
    showDiff,
    gitCompareBranches: () => {
      ctx.overlays.setDiff(null)
      panes.showView('git')
      comparison.open()
    },
    /**
     * "Diff current file" — the palette's way into the panel: it opens the
     * source-control view with the cursor on the file being edited, so the
     * arrows carry on from there like any other diff.
     */
    gitDiffFile: () => {
      if (!inRepository(rootDir)) return say('Not a git repository', 'warn')
      const path = workspace.activePath()
      if (!path) return say('No file open', 'warn')
      const row = git.changes().findIndex(change => change.path === path)
      if (row < 0) return say(`No changes in ${relative(rootDir, path)}`)
      panes.showView('git')
      panes.setGitCursor(row)
      showDiff(path)
    },
    /**
     * Rebuild the open diff from the repository as it is now. The page is a
     * snapshot taken when it opened, so a commit, stash or save made anywhere
     * else would otherwise leave it showing changes that no longer exist. Not a
     * palette command: `App` runs it whenever git or a buffer moves.
     */
    refreshDiff: () => {
      const shown = ctx.overlays.diff()?.path
      if (!shown) return
      // The page belongs to a row in the panel: once the change is committed,
      // stashed or reverted the row is gone, and so is the page it opened.
      const fileStatus = git.gitStatus().get(shown)
      if (!fileStatus) return ctx.overlays.setDiff(null)
      ctx.overlays.setDiff(diffFileFor(shown, fileStatus))
    },
    gitCommit: () => {
      if (!inRepository(rootDir)) return say('Not a git repository', 'warn')
      // A hand-built index is a selection already made, so the picker mirrors
      // it: staged files start checked, the rest unchecked. With nothing
      // staged there is no selection to respect and everything starts checked.
      const staged = stagedPaths(rootDir)
      const changes = [...statusMap(rootDir)]
        .map(([path, fileStatus]) => ({
          path,
          rel: relative(rootDir, path),
          status: fileStatus,
          checked: staged.size === 0 || staged.has(path),
        }))
        .toSorted((a, b) => a.rel.localeCompare(b.rel))
      if (changes.length === 0) return say('Nothing to commit — working tree clean')
      git.setCommitPick(changes)
    },
    gitUndoCommit: () => {
      if (!inRepository(rootDir)) return say('Not a git repository', 'warn')
      const subject = lastCommitSubject(rootDir)
      if (!subject) return say('No commit to undo', 'warn')
      ctx.prompts.setPrompt({ kind: 'undoCommit', subject })
    },
    gitPush: () => {
      const name = git.branch()
      // Detached HEAD and an unborn branch both land here; neither is pushable.
      if (!name) return say('No branch to push', 'warn')
      const hasUpstream = git.upstream()?.name != null
      gitOp('Pushing', () => push(rootDir, name, hasUpstream), {
        done: () =>
          hasUpstream ? `Pushed ${name}` : `Pushed ${name} — upstream set to origin/${name}`,
      })
    },
    gitFetch: () => gitOp('Fetching', () => fetchRemote(rootDir), { done: () => 'Fetched' }),
    gitPull: () => gitOp('Pulling', () => pull(rootDir), { touchesTree: true }),
    gitStash: () => gitOp('Stashing', () => stashPush(rootDir), { touchesTree: true }),
    gitStashPop: () => gitOp('Popping stash', () => stashPop(rootDir), { touchesTree: true }),
    gitSwitchBranch: () => ctx.branches.open('switch'),
    gitNewBranch: ctx.branches.newBranch,
    gitNewBranchFrom: () => ctx.branches.open('from'),
    gitMergeBranch: () => ctx.branches.open('merge'),
    gitRenameBranch: () => ctx.branches.open('rename'),
    gitDeleteBranch: () => ctx.branches.open('delete'),
    gitDeleteBranchForce: () => ctx.branches.open('deleteForce'),
    showHelp: () => ctx.overlays.setHelp(true),
    quit: ctx.prompts.quit,
  }

  const commands = createMemo<Command[]>(() =>
    buildCommands(actions, { activeTheme: config.theme }),
  )

  return { commands, actions }
}

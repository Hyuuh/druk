/**
 * Command registry — the catalogue of everything druk can do. This tree is the
 * command palette (F1 / Ctrl+Shift+P), so it doubles as the feature index.
 *
 * A command either runs (`run`) or opens a submenu (`children`), never both.
 * Typing in the palette searches every leaf across all levels, so nesting keeps
 * the list short without hiding anything.
 *
 * To add a command: add an action to `CommandActions`, then an entry below. Set
 * `hint` when a keybinding also triggers it (keybindings live in App).
 */
import { THEMES, themeLabels } from '../themes'
import type { ThemeName } from '../themes'
import { ALT } from '../ui/keys'

export interface Command {
  id: string
  label: string
  /** Keybinding shown right-aligned, e.g. "Ctrl+S". Leaves only. */
  hint?: string
  run?: () => void
  children?: Command[]
}

export interface CommandActions {
  save: () => void
  openFile: () => void
  switchTab: () => void
  closeOthers: () => void
  closeAll: () => void
  gotoLine: () => void
  undo: () => void
  redo: () => void
  findInFile: () => void
  findInProject: () => void
  replaceInFile: () => void
  newFile: () => void
  newFolder: () => void
  rename: () => void
  cutForMove: () => void
  copyForPaste: () => void
  paste: () => void
  remove: () => void
  closeTab: () => void
  reopenTab: () => void
  nextTab: () => void
  prevTab: () => void
  toggleFocus: () => void
  toggleSidebar: () => void
  toggleGitView: () => void
  setTheme: (name: ThemeName) => void
  toggleThemeSync: () => void
  lineOp: (op: 'comment' | 'up' | 'down' | 'duplicate') => void
  triggerCompletion: () => void
  openSettings: () => void
  problemsList: () => void
  problemsNext: () => void
  problemsPrev: () => void
  gitDiffFile: () => void
  gitCompareBranches: () => void
  gitDiffBase: () => void
  gitTogglePanelView: () => void
  gitDiffBaseReset: () => void
  /** Not a command: the panel's cursor is what opens a diff, and this is it. */
  showDiff: (path: string) => void
  /** Not commands: the source-control panel's cursor, moved and pressed. */
  gitMoveTo: (row: number) => void
  gitActivateRow: (row: number) => void
  /** Not a command: `App` runs it when git or a buffer moves under an open diff. */
  refreshDiff: () => void
  gitCommit: () => void
  gitUndoCommit: () => void
  gitPush: () => void
  gitFetch: () => void
  gitPull: () => void
  gitStash: () => void
  gitStashPop: () => void
  gitSwitchBranch: () => void
  gitNewBranch: () => void
  gitNewBranchFrom: () => void
  gitMergeBranch: () => void
  gitRenameBranch: () => void
  gitDeleteBranch: () => void
  gitDeleteBranchForce: () => void
  showHelp: () => void
  quit: () => void
}

export interface CommandContext {
  activeTheme: ThemeName
  themeSync: boolean
}

/** Marks the entry matching the current setting, so submenus show state. */
const check = (on: boolean) => (on ? '* ' : '  ')

export function buildCommands(actions: CommandActions, ctx: CommandContext): Command[] {
  return [
    { id: 'open', label: 'Open file…', hint: 'Ctrl+P', run: actions.openFile },
    { id: 'save', label: 'Save file', hint: 'Ctrl+S', run: actions.save },
    { id: 'goto', label: 'Go to line…', hint: 'Ctrl+G', run: actions.gotoLine },
    { id: 'undo', label: 'Undo', hint: 'Ctrl+Z', run: actions.undo },
    { id: 'redo', label: 'Redo', hint: 'Ctrl+Y', run: actions.redo },
    {
      id: 'find',
      label: 'Find',
      children: [
        { id: 'find.file', label: 'In current file', hint: 'Ctrl+F', run: actions.findInFile },
        {
          id: 'find.project',
          label: 'In project',
          hint: 'Ctrl+R',
          run: actions.findInProject,
        },
        {
          id: 'find.replace',
          label: 'Replace in current file',
          hint: 'Ctrl+F then Tab',
          run: actions.replaceInFile,
        },
      ],
    },
    {
      id: 'file',
      label: 'File',
      children: [
        { id: 'file.new', label: 'New file', hint: 'Ctrl+N', run: actions.newFile },
        { id: 'file.newDir', label: 'New folder', hint: `Ctrl+${ALT}+N`, run: actions.newFolder },
        { id: 'file.rename', label: 'Rename…', hint: 'r', run: actions.rename },
        { id: 'file.cut', label: 'Cut for moving', hint: 'x', run: actions.cutForMove },
        { id: 'file.copy', label: 'Copy', hint: 'c', run: actions.copyForPaste },
        { id: 'file.paste', label: 'Paste here', hint: 'p', run: actions.paste },
        { id: 'file.delete', label: 'Delete…', hint: 'd', run: actions.remove },
      ],
    },
    {
      id: 'git',
      label: 'Git',
      children: [
        // The only way in: it opens the source-control panel on this file, which
        // is where the cursor pages through every other change.
        { id: 'git.diffFile', label: 'Diff current file', run: actions.gitDiffFile },
        // What the whole editor compares against — the panel names the branch
        // while one is picked, so the pair reads as a mode you are in or out of.
        { id: 'git.diffBase', label: 'Compare against branch…', run: actions.gitDiffBase },
        {
          id: 'git.diffBaseReset',
          label: 'Compare against HEAD',
          run: actions.gitDiffBaseReset,
        },
        {
          id: 'git.compare',
          label: 'Compare branches',
          hint: 'B in source control',
          run: actions.gitCompareBranches,
        },
        {
          id: 'git.panelView',
          label: 'Changes as tree / flat list',
          run: actions.gitTogglePanelView,
        },
        { id: 'git.commit', label: 'Commit…', run: actions.gitCommit },
        { id: 'git.undo', label: 'Undo last commit', run: actions.gitUndoCommit },
        { id: 'git.push', label: 'Push', run: actions.gitPush },
        { id: 'git.fetch', label: 'Fetch', run: actions.gitFetch },
        { id: 'git.pull', label: 'Pull (fast-forward only)', run: actions.gitPull },
        { id: 'git.stash', label: 'Stash changes', run: actions.gitStash },
        { id: 'git.stashPop', label: 'Stash pop', run: actions.gitStashPop },
        {
          id: 'git.branch',
          label: 'Branch',
          children: [
            {
              id: 'git.branch.switch',
              label: 'Switch branch…',
              hint: 'b in source control',
              run: actions.gitSwitchBranch,
            },
            { id: 'git.branch.new', label: 'New branch…', run: actions.gitNewBranch },
            { id: 'git.branch.newFrom', label: 'New branch from…', run: actions.gitNewBranchFrom },
            {
              id: 'git.branch.merge',
              label: 'Merge branch into current…',
              run: actions.gitMergeBranch,
            },
            { id: 'git.branch.rename', label: 'Rename branch…', run: actions.gitRenameBranch },
            { id: 'git.branch.delete', label: 'Delete branch…', run: actions.gitDeleteBranch },
            {
              id: 'git.branch.deleteForce',
              label: 'Delete branch (force)…',
              run: actions.gitDeleteBranchForce,
            },
          ],
        },
      ],
    },
    {
      id: 'problems',
      label: 'Problems',
      children: [
        { id: 'problems.list', label: 'List problems', run: actions.problemsList },
        { id: 'problems.next', label: 'Next problem', run: actions.problemsNext },
        { id: 'problems.prev', label: 'Previous problem', run: actions.problemsPrev },
      ],
    },
    {
      id: 'tabs',
      label: 'Tabs',
      children: [
        { id: 'tabs.switch', label: 'Switch to…', hint: 'Ctrl+T', run: actions.switchTab },
        { id: 'tabs.close', label: 'Close tab', hint: 'Ctrl+W', run: actions.closeTab },
        {
          id: 'tabs.reopen',
          label: 'Reopen closed tab',
          hint: `Ctrl+${ALT}+T`,
          run: actions.reopenTab,
        },
        { id: 'tabs.closeOthers', label: 'Close other tabs', run: actions.closeOthers },
        { id: 'tabs.closeAll', label: 'Close all tabs', run: actions.closeAll },
        { id: 'tabs.next', label: 'Next tab', hint: `Ctrl+${ALT}+→`, run: actions.nextTab },
        { id: 'tabs.prev', label: 'Previous tab', hint: `Ctrl+${ALT}+←`, run: actions.prevTab },
      ],
    },
    {
      id: 'view',
      label: 'View',
      children: [
        {
          id: 'view.sidebar',
          label: 'Toggle sidebar',
          hint: 'Ctrl+B',
          run: actions.toggleSidebar,
        },
        {
          id: 'view.git',
          label: 'Source control (commit / push)',
          hint: `Ctrl+${ALT}+G`,
          run: actions.toggleGitView,
        },
        {
          id: 'view.focus',
          label: 'Focus tree / editor',
          hint: 'Tab in · Esc out',
          run: actions.toggleFocus,
        },
      ],
    },
    {
      id: 'themes',
      label: 'Themes',
      children: [
        {
          id: 'themes.sync',
          label: `${check(ctx.themeSync)}Follow OS appearance`,
          hint: 'light / dark themes in Settings',
          run: actions.toggleThemeSync,
        },
        ...(Object.keys(THEMES) as ThemeName[]).map(name => ({
          id: `themes.${name}`,
          label: `${check(ctx.activeTheme === name)}${themeLabels[name]}`,
          run: () => actions.setTheme(name),
        })),
      ],
    },
    {
      id: 'editor',
      label: 'Editor',
      children: [
        // Also commands because the chords are not always sendable: some layouts
        // have no byte for Ctrl+/ at all.
        {
          id: 'editor.comment',
          label: 'Toggle comment',
          hint: 'Ctrl+/ · Ctrl+L',
          run: () => actions.lineOp('comment'),
        },
        {
          id: 'editor.lineUp',
          label: 'Move line up',
          hint: `${ALT}+↑`,
          run: () => actions.lineOp('up'),
        },
        {
          id: 'editor.lineDown',
          label: 'Move line down',
          hint: `${ALT}+↓`,
          run: () => actions.lineOp('down'),
        },
        {
          id: 'editor.duplicate',
          label: 'Duplicate line',
          hint: `${ALT}+Shift+↓`,
          run: () => actions.lineOp('duplicate'),
        },
        {
          id: 'editor.complete',
          label: 'Trigger autocomplete',
          hint: 'Ctrl+Space',
          run: actions.triggerCompletion,
        },
      ],
    },
    // Vim, tab size, trim, auto-save and the rest live on the settings page —
    // the palette carries features, not configuration. Themes stay above for
    // the arrow-through live preview.
    { id: 'settings', label: 'Settings', run: actions.openSettings },
    { id: 'help', label: 'Keyboard shortcuts', run: actions.showHelp },
    { id: 'quit', label: 'Quit', hint: 'Ctrl+Q', run: actions.quit },
  ]
}

export interface FlatCommand {
  command: Command
  /** Breadcrumb of ancestor labels, e.g. ["Themes"]. */
  trail: string[]
}

/** Every runnable leaf, with its path — used while filtering. */
export function flattenCommands(commands: Command[], trail: string[] = []): FlatCommand[] {
  return commands.flatMap(command =>
    command.children
      ? flattenCommands(command.children, [...trail, command.label])
      : [{ command, trail }],
  )
}

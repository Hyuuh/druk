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
  setTheme: (name: ThemeName) => void
  lineOp: (op: 'comment' | 'up' | 'down' | 'duplicate') => void
  openSettings: () => void
  gitDiffFile: () => void
  gitDiffAll: () => void
  gitCommit: () => void
  gitUndoCommit: () => void
  gitPush: () => void
  gitFetch: () => void
  gitPull: () => void
  gitStash: () => void
  gitStashPop: () => void
  showHelp: () => void
  quit: () => void
}

export interface CommandContext {
  activeTheme: ThemeName
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
        { id: 'git.diffFile', label: 'Diff current file', run: actions.gitDiffFile },
        { id: 'git.diffAll', label: 'Diff all changes', run: actions.gitDiffAll },
        { id: 'git.commit', label: 'Commit…', run: actions.gitCommit },
        { id: 'git.undo', label: 'Undo last commit', run: actions.gitUndoCommit },
        { id: 'git.push', label: 'Push', run: actions.gitPush },
        { id: 'git.fetch', label: 'Fetch', run: actions.gitFetch },
        { id: 'git.pull', label: 'Pull (fast-forward only)', run: actions.gitPull },
        { id: 'git.stash', label: 'Stash changes', run: actions.gitStash },
        { id: 'git.stashPop', label: 'Stash pop', run: actions.gitStashPop },
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
      children: (Object.keys(THEMES) as ThemeName[]).map(name => ({
        id: `themes.${name}`,
        label: `${check(ctx.activeTheme === name)}${themeLabels[name]}`,
        run: () => actions.setTheme(name),
      })),
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

/**
 * Every keybinding druk advertises, in one table. The status-bar hints, the
 * help overlay and the Ctrl+K peek strip all render from here — a key added
 * anywhere else is a key one of them will not know about. The real handlers
 * live in App and EditorPane; `test/hotkeys.test.tsx` sweeps the two together.
 *
 * Entries sit grouped by `section`, which is what the help overlay renders
 * under headings — a new entry belongs beside its section mates, not at the end.
 */

type Pane = 'tree' | 'editor'

/** The panes plus the sidebar's other view: the source-control panel replaces the
 * tree's keys while it shows, so the peek strip has to tell the two apart. */
export type KeyScope = Pane | 'git'

/** What the key next to the space bar is called on this machine's keyboard. */
export const ALT = process.platform === 'darwin' ? 'Opt' : 'Alt'

export interface KeyInfo {
  key: string
  label: string
  /** Heading the help overlay files this under. */
  section: string
  /** Pane(s) the key is alive in; 'help' rows show in the help table only. */
  where: KeyScope | 'all' | 'help'
  /** Footer advertisement: which pane shows it, as what, in what order.
   * `key` overrides the display key where the full spelling is too wide. */
  hint?: { pane: Pane | 'all'; label: string; rank: number; key?: string }
  /** Row on the empty-editor welcome screen. Same `key` override as `hint`. */
  welcome?: { label: string; rank: number; key?: string }
}

export const KEYS: KeyInfo[] = [
  {
    // Ctrl+Shift+P reaches only kitty-protocol terminals; the Opt spelling and
    // F1 are what work everywhere, so F1 is the one the hint advertises.
    key: `F1 · Ctrl+${ALT}+P`,
    label: 'Command palette (+ themes)',
    section: 'General',
    where: 'all',
    hint: { pane: 'all', label: 'commands', rank: 0, key: 'F1' },
    welcome: { label: 'Run any command', rank: 2, key: 'F1' },
  },
  {
    key: 'Ctrl+K',
    label: 'Peek at every key for this pane',
    section: 'General',
    where: 'all',
    hint: { pane: 'all', label: 'keys', rank: 1 },
    welcome: { label: 'Peek at every key', rank: 5 },
  },
  {
    key: 'Ctrl+P · Ctrl+O',
    label: 'Open file (fuzzy)',
    section: 'General',
    where: 'all',
    welcome: { label: 'Open a file by name', rank: 1, key: 'Ctrl+P' },
  },
  { key: 'Ctrl+G', label: 'Go to line', section: 'General', where: 'all' },
  { key: 'Ctrl+Q', label: 'Quit', section: 'General', where: 'all' },
  { key: 'Mouse', label: 'Click tabs, tree rows, editor', section: 'General', where: 'help' },

  { key: 'Ctrl+S', label: 'Save file', section: 'Editing', where: 'editor' },
  { key: 'Ctrl+Z / Ctrl+Y', label: 'Undo / redo', section: 'Editing', where: 'editor' },
  { key: 'Ctrl+A', label: 'Select all', section: 'Editing', where: 'editor' },
  { key: 'Ctrl+C', label: 'Copy selection — quits if none', section: 'Editing', where: 'all' },
  { key: 'Ctrl+X / Ctrl+V', label: 'Cut / paste', section: 'Editing', where: 'editor' },
  { key: 'Ctrl+/ · Ctrl+L', label: 'Toggle comment', section: 'Editing', where: 'editor' },
  { key: `${ALT}+↑ / ↓`, label: 'Move line or selection', section: 'Editing', where: 'editor' },
  {
    key: `${ALT}+Shift+↑ / ↓`,
    label: 'Duplicate line or selection',
    section: 'Editing',
    where: 'editor',
  },
  { key: 'Shift+Tab', label: 'Outdent', section: 'Editing', where: 'editor' },

  {
    key: 'Ctrl+F',
    label: 'Find in file (Tab to replace)',
    section: 'Search & replace',
    where: 'editor',
  },
  {
    key: 'Ctrl+R',
    label: 'Find in project',
    section: 'Search & replace',
    where: 'all',
    welcome: { label: 'Search the project', rank: 3 },
  },
  {
    key: 'Enter / Ctrl+A',
    label: 'Replace this match / all (in replace)',
    section: 'Search & replace',
    where: 'help',
  },
  {
    key: `Ctrl+C / W / R`,
    label: 'Case / whole word / regex (in search)',
    section: 'Search & replace',
    where: 'help',
  },

  { key: 'Ctrl+N', label: 'New file', section: 'Files & tabs', where: 'all' },
  { key: `Ctrl+${ALT}+N`, label: 'New folder', section: 'Files & tabs', where: 'all' },
  { key: 'Ctrl+W', label: 'Close tab', section: 'Files & tabs', where: 'all' },
  { key: `Ctrl+${ALT}+T`, label: 'Reopen closed tab', section: 'Files & tabs', where: 'all' },
  { key: 'Ctrl+T', label: 'Switch to open tab', section: 'Files & tabs', where: 'all' },
  { key: `Ctrl+${ALT}+← / →`, label: 'Previous / next tab', section: 'Files & tabs', where: 'all' },

  {
    key: 'Enter',
    label: 'Open file / toggle folder',
    section: 'File tree',
    where: 'tree',
    welcome: { label: 'Open what the tree has selected', rank: 0 },
  },
  { key: '↑↓', label: 'Move in tree / popup', section: 'File tree', where: 'tree' },
  { key: 'Shift+↑ / ↓', label: 'Select a range (in tree)', section: 'File tree', where: 'tree' },
  { key: '→ / ←', label: 'Expand / collapse folder', section: 'File tree', where: 'tree' },
  {
    key: 'h j k l',
    label: 'Move / collapse / expand (vim mode)',
    section: 'File tree',
    where: 'tree',
  },
  { key: 'a / A', label: 'New file / folder (in tree)', section: 'File tree', where: 'tree' },
  { key: 'r / d', label: 'Rename / delete (in tree)', section: 'File tree', where: 'tree' },
  {
    key: 'x / c / p',
    label: 'Cut / copy / paste here (in tree)',
    section: 'File tree',
    where: 'tree',
  },
  { key: '[ / ]', label: 'Narrow / widen sidebar (in tree)', section: 'File tree', where: 'tree' },

  {
    key: `Ctrl+${ALT}+G`,
    label: 'Source control panel (git)',
    section: 'Source control',
    where: 'all',
    welcome: { label: 'Review changes and commit', rank: 4 },
  },
  // Short labels on purpose: a label that wraps costs the help table a second row,
  // and the table only just fits a 60-row terminal — `test/help-scroll.test.tsx`
  // measures exactly that.
  {
    key: '↑↓ · Enter · →←',
    label: 'Diff a change · fold a folder',
    section: 'Source control',
    where: 'git',
  },
  {
    key: 'c · p · b · Esc',
    label: 'Commit / push / branch / back',
    section: 'Source control',
    where: 'git',
  },

  {
    key: 'Ctrl+B',
    label: 'Show / hide sidebar',
    section: 'View',
    where: 'all',
  },
  // One row, not two: the help table only just fits a 60-row terminal, and
  // `test/help-scroll.test.tsx` measures exactly that.
  {
    key: 'Tab / Shift+Tab',
    label: 'Tree → editor · Files ↔ Git',
    section: 'View',
    where: 'all',
  },
  { key: 'Esc', label: 'Editor → tree', section: 'View', where: 'editor' },
]

/** The help table: every row, key and long label. */
export const ROWS: [string, string][] = KEYS.map(info => [info.key, info.label])

export interface HelpSection {
  title: string
  rows: [string, string][]
}

/** The table split at its section boundaries, for the help overlay's headings. */
export const SECTIONS: HelpSection[] = KEYS.reduce<HelpSection[]>((out, info) => {
  if (out.at(-1)?.title !== info.section) out.push({ title: info.section, rows: [] })
  out.at(-1)!.rows.push([info.key, info.label])
  return out
}, [])

/** Footer hints for `pane`, most useful first. */
export function hintsFor(pane: Pane): ReadonlyArray<readonly [string, string]> {
  return KEYS.filter(info => info.hint && (info.hint.pane === pane || info.hint.pane === 'all'))
    .toSorted((a, b) => a.hint!.rank - b.hint!.rank)
    .map(info => [info.hint!.key ?? info.key, info.hint!.label] as const)
}

/** Rows for the welcome screen, most useful first. */
export function welcomeKeys(): ReadonlyArray<readonly [string, string]> {
  return KEYS.filter(info => info.welcome)
    .toSorted((a, b) => a.welcome!.rank - b.welcome!.rank)
    .map(info => [info.welcome!.key ?? info.key, info.welcome!.label] as const)
}

/** Everything alive in `pane`, for the peek strip. */
export function keysFor(pane: KeyScope): KeyInfo[] {
  return KEYS.filter(info => info.where === pane || info.where === 'all')
}

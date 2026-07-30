/**
 * Settings in two layers, as VS Code has them: the user's own, persisted at
 * `$XDG_CONFIG_HOME/druk/config.json` (default `~/.config/druk/config.json`),
 * and per-project overrides in `<project>/.druk/settings.json`.
 *
 * To add a setting: add the field to `Config`, give it a value in `DEFAULTS`,
 * and validate it in `VALIDATORS`. Anything missing or invalid falls back to the
 * default, so a hand-edited config can never break startup.
 *
 * A missing key means different things in the two files, and that is the whole
 * reason validation is a per-key table rather than one `parse`. The user file
 * holds every setting and is rewritten whole; the project file holds only what it
 * overrides, so `parsePartial` has to leave an unmentioned key *absent* instead of
 * filling in the default — the user's value is what fills that gap, in
 * `resolveConfig`.
 */
import fs from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'

import { isThemeName } from '../themes'
import type { ThemeName } from '../themes'

export const CONFIG_FILE = join(
  process.env.XDG_CONFIG_HOME ?? join(os.homedir(), '.config'),
  'druk',
  'config.json',
)

/** Which of the two files a setting is read from or written to. */
export type ConfigScope = 'user' | 'project'

/** Project overrides live beside the project, the way `.vscode/` does. */
export const PROJECT_CONFIG_DIR = '.druk'

export const projectConfigFile = (rootDir: string): string =>
  join(rootDir, PROJECT_CONFIG_DIR, 'settings.json')

/** Narrow enough to still show a name, wide enough to leave the editor usable. */
export const SIDEBAR_MIN = 15
export const SIDEBAR_MAX = 80

/**
 * `'auto'`: this share of the terminal, within these bounds. The floor is what an
 * 80-column window gets, so the automatic width only ever grows from what a fixed
 * default gave — a flat 30 columns is fine there and cramped at 200, where two
 * columns per nesting level leave a deep path almost nothing for its name.
 */
const AUTO_SHARE = 0.25
const AUTO_MIN = 30
const AUTO_MAX = 60

export function sidebarColumns(width: number | 'auto', terminalWidth: number): number {
  if (width !== 'auto') return width
  return Math.max(AUTO_MIN, Math.min(AUTO_MAX, Math.round(terminalWidth * AUTO_SHARE)))
}

export interface Config {
  /** Color scheme id — see src/themes. */
  theme: ThemeName
  /**
   * Follow the OS light/dark appearance: `themeLight` and `themeDark` take over
   * and `theme` becomes whichever of the two is on screen. Picking a theme by
   * hand turns this off, since the poll would otherwise undo the pick.
   */
  themeSync: boolean
  /** Theme used while the OS is light and `themeSync` is on. */
  themeLight: ThemeName
  /** Theme used while the OS is dark and `themeSync` is on. */
  themeDark: ThemeName
  /**
   * Leave the editor, tab strip and sidebar backgrounds unpainted, so a
   * translucent terminal shows through them. Floating panels — the palette, the
   * modals, the settings page — stay painted whatever this says: the editor
   * would otherwise read straight through them.
   */
  transparent: boolean
  /** Modal editing (normal / insert / visual). */
  vim: boolean
  /**
   * Columns per indent level for space indentation — the Tab key and the guides.
   * A literal tab is two columns whatever this says: OpenTUI's renderer fixes that
   * width and exposes no setting for it.
   */
  tabSize: number
  /**
   * Columns the file tree occupies, or `'auto'` for a share of the terminal —
   * a fixed default is either cramped on a wide screen or greedy on a narrow one.
   * Resizing with `[` / `]` or by dragging the divider pins an explicit number.
   */
  sidebarWidth: number | 'auto'
  /** Version whose update notice was dismissed; suppresses the banner for it. */
  skipUpdate: string
  /** On save: strip trailing spaces and end the file with one newline. */
  trimOnSave: boolean
  /** On save: run the matching `formatters` command over the file just written. */
  formatOnSave: boolean
  /**
   * Formatter commands keyed by comma-separated extensions (`"ts,tsx"`), or `"*"`
   * for any file. The saved file's path is appended, and the command must rewrite
   * the file in place — `["prettier", "--write"]`, `["eslint", "--fix"]`,
   * `["oxfmt"]`. An empty array disables its entry.
   */
  formatters: Record<string, string[]>
  /** Save every dirty buffer when the terminal window loses focus. */
  autoSaveOnBlur: boolean
  /** How the diff view renders: one column of +/- rows, or two side by side. */
  diffView: 'inline' | 'split'
  /** Source-control panel: changed files nested under folders, or one flat list
   * of paths. */
  gitPanelView: 'tree' | 'list'
  /** Whether the tree lists dotfiles. The default tells the filesystem's truth. */
  showDotfiles: boolean
  /** Hide git-ignored files from the tree. Off by default for the same reason. */
  respectGitignore: boolean
  /** Language servers: spawn one per language as matching files open. */
  lsp: boolean
  /** Draw the worst problem's message after the end of its line. */
  lspInline: boolean
  /** Completion menu while typing (and on Ctrl+Space). Needs `lsp` on too. */
  lspCompletion: boolean
  /**
   * Offer to install a missing server (the npm ones) when a file that wants it
   * opens. Off means the status bar prints the install line and nothing else;
   * on still asks before anything is downloaded.
   */
  lspAutoInstall: boolean
  /**
   * Which TypeScript the typescript server should drive — a path to a
   * `tsserver.js`, to a `lib` folder, or to a typescript package directory.
   * Empty leaves the choice to the server, which prefers the open project's own
   * copy and falls back to whatever druk installed.
   */
  typescriptTsdk: string
  /**
   * Per-server command override, keyed by server id — see src/lsp/servers.ts
   * for the ids and defaults. An empty array disables that server.
   */
  lspServers: Record<string, string[]>
  /**
   * Custom shortcuts: command id → the one chord that runs it, replacing whatever
   * it had by default (`"Ctrl+Opt+K"`). An empty value, or `"none"`, leaves the
   * command with no key at all. The bindable ids and their defaults are in
   * src/app/keymap.ts, and the settings page edits this without the ids.
   */
  keybindings: Record<string, string>
}

export const DEFAULTS: Config = {
  theme: 'dark',
  themeSync: true,
  themeLight: 'light',
  themeDark: 'dark',
  transparent: false,
  vim: false,
  tabSize: 2,
  sidebarWidth: 'auto',
  skipUpdate: '',
  trimOnSave: false,
  formatOnSave: false,
  formatters: {},
  autoSaveOnBlur: true,
  diffView: 'inline',
  gitPanelView: 'tree',
  showDotfiles: true,
  respectGitignore: false,
  lsp: true,
  lspInline: true,
  lspCompletion: true,
  lspAutoInstall: true,
  typescriptTsdk: '',
  lspServers: {},
  keybindings: {},
}

/** Reads one setting out of parsed JSON; `undefined` for absent or invalid. */
type Validator<K extends keyof Config> = (raw: unknown) => Config[K] | undefined

const bool = (raw: unknown) => (typeof raw === 'boolean' ? raw : undefined)
const theme = (raw: unknown) => (isThemeName(raw) ? raw : undefined)
const text = (raw: unknown) => (typeof raw === 'string' ? raw : undefined)

/** One of a fixed set of strings — the settings whose type is a small union. */
const among =
  <T extends string>(...values: T[]) =>
  (raw: unknown): T | undefined =>
    typeof raw === 'string' ? values.find(value => value === raw) : undefined

/** A key → command-array map (`lspServers`, `formatters`). Only well-formed
 * entries survive; a malformed one must not break startup. */
const commands = (raw: unknown): Record<string, string[]> | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const parsed: Record<string, string[]> = {}
  for (const [id, command] of Object.entries(raw)) {
    if (Array.isArray(command) && command.every(part => typeof part === 'string')) {
      parsed[id] = command
    }
  }
  return parsed
}

/** A key → text map (`keybindings`). Malformed entries are dropped, not fatal. */
const strings = (raw: unknown): Record<string, string> | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const parsed: Record<string, string> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === 'string') parsed[id] = value
  }
  return parsed
}

const VALIDATORS: { [K in keyof Config]: Validator<K> } = {
  theme,
  themeSync: bool,
  themeLight: theme,
  themeDark: theme,
  transparent: bool,
  vim: bool,
  tabSize: raw => (typeof raw === 'number' && raw >= 1 && raw <= 16 ? Math.floor(raw) : undefined),
  sidebarWidth: raw => {
    if (raw === 'auto') return 'auto'
    return typeof raw === 'number' && raw >= SIDEBAR_MIN && raw <= SIDEBAR_MAX
      ? Math.floor(raw)
      : undefined
  },
  skipUpdate: text,
  trimOnSave: bool,
  formatOnSave: bool,
  formatters: commands,
  autoSaveOnBlur: bool,
  diffView: among('inline', 'split'),
  gitPanelView: among('tree', 'list'),
  showDotfiles: bool,
  respectGitignore: bool,
  lsp: bool,
  lspInline: bool,
  lspCompletion: bool,
  lspAutoInstall: bool,
  typescriptTsdk: text,
  lspServers: commands,
  keybindings: strings,
}

const isConfigKey = (key: string): key is keyof Config => key in VALIDATORS

/** Only the settings the JSON actually carries — the shape the project file has. */
export function parsePartial(raw: unknown): Partial<Config> {
  const config: Partial<Config> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return config
  for (const [key, value] of Object.entries(raw)) {
    if (!isConfigKey(key)) continue
    const parsed = VALIDATORS[key](value)
    if (parsed !== undefined) Object.assign(config, { [key]: parsed })
  }
  return config
}

const parse = (raw: unknown): Config => ({ ...DEFAULTS, ...parsePartial(raw) })

/**
 * The config the editor runs on: the user's, with the project's overrides on top.
 * A key the project leaves out keeps the user's value — and a key the settings
 * page has just reset is still present, holding `undefined`, so one spread is not
 * enough to drop it.
 */
export function resolveConfig(user: Config, project: Partial<Config>): Config {
  const config = { ...user }
  for (const [key, value] of Object.entries(project)) {
    if (value !== undefined) Object.assign(config, { [key]: value })
  }
  return config
}

/** Read the config file, falling back to defaults on any error or bad value. */
export function loadConfig(): Config {
  try {
    return parse(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')))
  } catch {
    return { ...DEFAULTS }
  }
}

/** The project's own overrides — nothing at all when it has no settings file. */
export function loadProjectConfig(rootDir: string): Partial<Config> {
  try {
    return parsePartial(JSON.parse(fs.readFileSync(projectConfigFile(rootDir), 'utf8')))
  } catch {
    return {}
  }
}

export function saveUserConfig(config: Config): void {
  try {
    fs.mkdirSync(dirname(CONFIG_FILE), { recursive: true })
    fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  } catch {
    // best-effort — running without a writable home just means no persistence
  }
}

/**
 * Write the project file with the overridden keys and nothing else. Writing a
 * whole `Config` here would pin every setting on everyone who opens the project,
 * which is the one thing this file must not do.
 */
export function saveProjectConfig(rootDir: string, overrides: Partial<Config>): void {
  const kept = Object.entries(overrides).filter(([, value]) => value !== undefined)
  try {
    const file = projectConfigFile(rootDir)
    fs.mkdirSync(dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(Object.fromEntries(kept), null, 2)}\n`, 'utf8')
  } catch {
    // best-effort — a read-only project just means no project-level persistence
  }
}

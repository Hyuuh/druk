import { createStore, unwrap } from 'solid-js/store'

import { APPEARANCE_ENV, detectAppearance } from '../core/appearance'
import type { Appearance } from '../core/appearance'
import { saveConfig, sidebarColumns, SIDEBAR_MIN, SIDEBAR_MAX } from '../core/config'
import type { Config } from '../core/config'
import { invalidateSyntaxStyle } from '../languages/highlight'
import { DEFAULT_SERVERS } from '../lsp/servers'
import { setTheme, setTransparency, themeLabels, THEMES } from '../themes'
import type { ThemeName } from '../themes'
import type { SettingEdit, SettingRow } from '../ui/SettingsView'
import type { EditorBridge } from './editor'
import type { Status } from './status'

/** Columns the editor keeps for itself, whatever width the sidebar was saved at. */
const EDITOR_MIN = 20

const TAB_SIZES = [2, 4, 8]
const THEME_NAMES = Object.keys(THEMES) as ThemeName[]

/** The entry `dir` steps to, wrapping at both ends. */
const step = <T>(list: readonly T[], current: T, dir: 1 | -1): T =>
  list[(list.indexOf(current) + dir + list.length) % list.length]!

const onOff = (value: boolean) => (value ? 'on' : 'off')

/** The config store and every action that edits and persists it. */
export function createSettings(deps: {
  initial: Config
  status: Status
  editor: EditorBridge
  dimensions: () => { width: number; height: number }
}) {
  const { status, editor, dimensions } = deps
  const [config, setConfig] = createStore<Config>({ ...deps.initial })

  // Here rather than beside the `setTheme` in main.tsx: the theme store outlives
  // any one app instance, so a launch whose config says otherwise has to undo
  // what the last one left behind.
  setTransparency(config.transparent)

  const patchConfig = (patch: Partial<Config>) => {
    setConfig(patch)
    saveConfig(unwrap(config))
  }

  /** Paint a theme, without touching which theme the config says to use. */
  const paintTheme = (name: ThemeName) => {
    setTheme(name)
    invalidateSyntaxStyle()
  }

  /**
   * A theme picked by hand. It has to outlive the next appearance poll, so the
   * pick turns the sync off — and says so, since the user did not ask for that
   * and the settings page is the only other place the change shows.
   */
  const applyTheme = (name: ThemeName) => {
    const wasSyncing = config.themeSync
    paintTheme(name)
    patchConfig({ theme: name, themeSync: false })
    status.say(
      wasSyncing
        ? `Theme: ${themeLabels[name]} — no longer following the OS appearance`
        : `Theme: ${themeLabels[name]}`,
    )
  }

  /** The OS said light or dark: paint that side's theme, quietly. */
  const applyAppearance = (appearance: Appearance) => {
    const name = appearance === 'dark' ? config.themeDark : config.themeLight
    if (name === config.theme) return
    paintTheme(name)
    patchConfig({ theme: name })
  }

  const applySideTheme = (side: 'themeLight' | 'themeDark', name: ThemeName) => {
    patchConfig(side === 'themeDark' ? { themeDark: name } : { themeLight: name })
    status.say(`${side === 'themeDark' ? 'Dark' : 'Light'} theme: ${themeLabels[name]}`)
    if (config.themeSync) applyAppearance(detectAppearance() ?? 'dark')
  }

  const toggleThemeSync = () => {
    const enabled = !config.themeSync
    patchConfig({ themeSync: enabled })
    if (!enabled) {
      status.say('Follow OS appearance off')
      return
    }
    const appearance = detectAppearance()
    if (!appearance) {
      status.say(`Follow OS appearance on — this system reports none, set ${APPEARANCE_ENV}`)
      return
    }
    applyAppearance(appearance)
    status.say(`Following OS appearance (${appearance})`)
  }

  const toggleTransparent = () => {
    const enabled = !config.transparent
    patchConfig({ transparent: enabled })
    setTransparency(enabled)
    status.say(`Transparent background ${onOff(enabled)}`)
  }

  const applyTabSize = (size: number) => {
    patchConfig({ tabSize: size })
    status.say(`Tab size: ${size}`)
  }

  const applyVim = (enabled: boolean) => {
    editor.setVimMode(enabled ? 'normal' : null)
    patchConfig({ vim: enabled })
    status.say(`Vim mode ${enabled ? 'on' : 'off'}`)
  }

  const toggleTrim = () => {
    patchConfig({ trimOnSave: !config.trimOnSave })
    status.say(`Trim on save ${config.trimOnSave ? 'on' : 'off'}`)
  }

  const toggleFormatOnSave = () => {
    patchConfig({ formatOnSave: !config.formatOnSave })
    // Turning it on with nothing configured would silently do nothing on save.
    status.say(
      config.formatOnSave && Object.keys(config.formatters).length === 0
        ? 'Format on save on — add a command on the Formatters row'
        : `Format on save ${onOff(config.formatOnSave)}`,
    )
  }

  /**
   * One formatter entry as the page's one-line syntax: `ts,tsx = prettier --write`.
   * `previous` names the entry being edited, or null when adding; an empty value
   * removes the entry, and rewriting the extensions moves it rather than fork it.
   */
  const setFormatter = (previous: string | null, value: string) => {
    const formatters = { ...config.formatters }
    if (previous !== null && value.trim() === '') {
      delete formatters[previous]
      patchConfig({ formatters })
      return status.say(`Formatter for "${previous}" removed`)
    }
    const at = value.indexOf('=')
    const key = at < 0 ? '' : value.slice(0, at).trim()
    const command =
      at < 0
        ? []
        : value
            .slice(at + 1)
            .trim()
            .split(/\s+/)
            .filter(Boolean)
    if (!key || command.length === 0) {
      return status.say(
        'Formatter syntax: extensions = command, e.g. ts,tsx = prettier --write',
        'warn',
      )
    }
    if (previous !== null && previous !== key) delete formatters[previous]
    formatters[key] = command
    patchConfig({ formatters })
    status.say(`Formatter: ${key} = ${command.join(' ')}`)
  }

  /** The edit a formatter pick opens — entry `at`, or "add" past the end. */
  const formatterEdit = (at: number): SettingEdit => {
    const keys = Object.keys(config.formatters)
    const key = keys[at] ?? null
    return {
      title: key ? `Formatter — ${key}` : 'Add formatter',
      initial: key ? `${key} = ${config.formatters[key]!.join(' ')}` : '',
      placeholder: 'ts,tsx = prettier --write',
      hint: 'extensions = command ("*" any file) · empty removes · Enter apply · Esc cancel',
      apply: value => setFormatter(key, value),
    }
  }

  /** Custom command for one server; empty restores the default. Disabling stays
   * on the Servers row — an empty command already means "off" there. */
  const setServerCommand = (id: string, value: string) => {
    const overrides = { ...config.lspServers }
    const command = value.trim().split(/\s+/).filter(Boolean)
    if (command.length === 0) delete overrides[id]
    else overrides[id] = command
    patchConfig({ lspServers: overrides })
    status.say(
      command.length === 0
        ? `LSP server "${id}" back on its default command`
        : `LSP server "${id}": ${command.join(' ')}`,
    )
  }

  const toggleDiffView = () => {
    const next = config.diffView === 'inline' ? 'split' : 'inline'
    patchConfig({ diffView: next })
  }

  const toggleGitPanelView = () => {
    const next = config.gitPanelView === 'tree' ? 'list' : 'tree'
    patchConfig({ gitPanelView: next })
    status.say(`Changed files as ${next === 'tree' ? 'a tree' : 'a flat list'}`)
  }

  const toggleAutoSave = () => {
    patchConfig({ autoSaveOnBlur: !config.autoSaveOnBlur })
    status.say(`Auto-save ${config.autoSaveOnBlur ? 'on' : 'off'}`)
  }

  const toggleLsp = () => {
    patchConfig({ lsp: !config.lsp })
    status.say(`LSP diagnostics ${config.lsp ? 'on' : 'off'}`)
  }

  const toggleLspInline = () => {
    patchConfig({ lspInline: !config.lspInline })
    status.say(`Inline problem text ${config.lspInline ? 'on' : 'off'}`)
  }

  const toggleLspCompletion = () => {
    patchConfig({ lspCompletion: !config.lspCompletion })
    status.say(`Autocomplete ${config.lspCompletion ? 'on' : 'off'}`)
  }

  /**
   * Flip one server between enabled and disabled. Disabling writes the empty
   * command; re-enabling removes the override entirely, so a custom command set
   * by hand in the config file is not resurrected wrongly — the file is where
   * custom commands live, and the page only turns servers on and off.
   */
  const toggleServer = (id: string) => {
    const overrides = { ...config.lspServers }
    const disabled = overrides[id]?.length === 0
    if (disabled) delete overrides[id]
    else overrides[id] = []
    patchConfig({ lspServers: overrides })
    status.say(`LSP server "${id}" ${disabled ? 'enabled' : 'disabled'}`)
  }

  /** The page's one-line summary of a server: state, id, and the command it runs. */
  const serverLabel = (id: string, command: string[]) => {
    const override = config.lspServers[id]
    const enabled = override === undefined || override.length > 0
    const shown = override && override.length > 0 ? override : command
    return `${enabled ? '✓' : '✗'} ${id} — ${shown.join(' ')}`
  }

  const toggleDotfiles = () => {
    patchConfig({ showDotfiles: !config.showDotfiles })
    status.say(`Dotfiles ${config.showDotfiles ? 'shown' : 'hidden'}`)
  }

  const toggleGitignored = () => {
    patchConfig({ respectGitignore: !config.respectGitignore })
    status.say(`Git-ignored files ${config.respectGitignore ? 'hidden' : 'shown'}`)
  }

  /**
   * `'auto'` resolved against the terminal, then clamped against it again: a width
   * saved on a wide screen must not swallow the editor when the window is smaller
   * next time. The second clamp wins outright — below `SIDEBAR_MIN + EDITOR_MIN`
   * columns the tree gives up its minimum rather than leave the editor unusable.
   * The config value is untouched, so a saved width returns in full on a wide screen.
   */
  const treeWidth = () =>
    Math.max(
      0,
      Math.min(
        sidebarColumns(config.sidebarWidth, dimensions().width),
        dimensions().width - EDITOR_MIN,
      ),
    )

  const resizeSidebar = (width: number) => {
    const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(width)))
    if (next !== config.sidebarWidth) patchConfig({ sidebarWidth: next })
  }

  /**
   * Step the width by `delta`, from what is on screen rather than from the config.
   * On a window too narrow to honour a large saved width that does discard it — but
   * the alternative is a key that visibly does nothing while quietly counting down.
   */
  const nudgeSidebar = (delta: number) => resizeSidebar(treeWidth() + delta)

  /** The typed width: a column count (clamped as `[`/`]` are) or `auto`. */
  const applySidebarWidth = (value: string) => {
    const trimmed = value.trim().toLowerCase()
    if (trimmed === '' || trimmed === 'auto') {
      patchConfig({ sidebarWidth: 'auto' })
      return status.say('Sidebar width: auto')
    }
    const width = Number(trimmed)
    if (!Number.isFinite(width)) {
      return status.say(`Sidebar width is a number of columns, or "auto"`, 'warn')
    }
    resizeSidebar(width)
    status.say(`Sidebar width: ${config.sidebarWidth}`)
  }

  /** The settings page's rows: current values plus their step actions, in display order. */
  const rows = (): SettingRow[] => [
    {
      section: 'Appearance',
      label: 'Theme',
      value: themeLabels[config.theme],
      cycle: dir => applyTheme(step(THEME_NAMES, config.theme, dir)),
      select: {
        options: THEME_NAMES.map(name => themeLabels[name]),
        pick: at => applyTheme(THEME_NAMES[at]!),
      },
    },
    {
      section: 'Appearance',
      label: 'Follow OS appearance',
      value: onOff(config.themeSync),
      cycle: toggleThemeSync,
    },
    {
      section: 'Appearance',
      label: 'Light theme',
      value: themeLabels[config.themeLight],
      cycle: dir => applySideTheme('themeLight', step(THEME_NAMES, config.themeLight, dir)),
      select: {
        options: THEME_NAMES.map(name => themeLabels[name]),
        pick: at => applySideTheme('themeLight', THEME_NAMES[at]!),
      },
    },
    {
      section: 'Appearance',
      label: 'Dark theme',
      value: themeLabels[config.themeDark],
      cycle: dir => applySideTheme('themeDark', step(THEME_NAMES, config.themeDark, dir)),
      select: {
        options: THEME_NAMES.map(name => themeLabels[name]),
        pick: at => applySideTheme('themeDark', THEME_NAMES[at]!),
      },
    },
    {
      section: 'Appearance',
      label: 'Transparent background',
      value: onOff(config.transparent),
      cycle: toggleTransparent,
    },
    {
      section: 'Editor',
      label: 'Vim mode',
      value: onOff(config.vim),
      cycle: () => applyVim(!config.vim),
    },
    {
      section: 'Editor',
      label: 'Tab size',
      value: String(config.tabSize),
      cycle: dir => applyTabSize(step(TAB_SIZES, config.tabSize, dir)),
      select: {
        options: TAB_SIZES.map(String),
        pick: at => applyTabSize(TAB_SIZES[at]!),
      },
    },
    {
      section: 'Editor',
      label: 'Trim trailing whitespace on save',
      value: onOff(config.trimOnSave),
      cycle: toggleTrim,
    },
    {
      section: 'Editor',
      label: 'Format on save',
      value: onOff(config.formatOnSave),
      cycle: toggleFormatOnSave,
    },
    {
      // Enter lists the configured entries plus an "add" row; picking one opens
      // a text field, since a command is no pick-a-value setting.
      section: 'Editor',
      label: 'Formatters',
      value: `${Object.keys(config.formatters).length} configured`,
      cycle: () => status.say('Enter opens the formatter list'),
      select: {
        options: [
          ...Object.entries(config.formatters).map(([key, cmd]) => `${key} = ${cmd.join(' ')}`),
          '+ Add formatter…',
        ],
        pick: formatterEdit,
      },
    },
    {
      section: 'Editor',
      label: 'Auto-save on tab switch and terminal blur',
      value: onOff(config.autoSaveOnBlur),
      cycle: toggleAutoSave,
    },
    {
      section: 'Files',
      label: 'Show dotfiles',
      value: onOff(config.showDotfiles),
      cycle: toggleDotfiles,
    },
    {
      section: 'Files',
      label: 'Hide git-ignored files',
      value: onOff(config.respectGitignore),
      cycle: toggleGitignored,
    },
    {
      section: 'Files',
      label: 'Sidebar width',
      value: config.sidebarWidth === 'auto' ? 'auto' : String(config.sidebarWidth),
      cycle: dir => nudgeSidebar(dir),
      edit: {
        title: 'Sidebar width',
        initial: config.sidebarWidth === 'auto' ? 'auto' : String(config.sidebarWidth),
        placeholder: `auto, or ${SIDEBAR_MIN}–${SIDEBAR_MAX}`,
        hint: '"auto" sizes to the terminal · Enter apply · Esc cancel',
        apply: applySidebarWidth,
      },
    },
    {
      // Two values: a list to choose between them is more ceremony than the
      // flip is worth, so this stays a step like the booleans above.
      section: 'Git',
      label: 'Diff layout',
      value: config.diffView === 'inline' ? 'inline' : 'side-by-side',
      cycle: toggleDiffView,
    },
    {
      section: 'Git',
      label: 'Changed files',
      value: config.gitPanelView === 'tree' ? 'tree' : 'flat list',
      cycle: toggleGitPanelView,
    },
    {
      section: 'Language servers',
      label: 'LSP diagnostics',
      value: onOff(config.lsp),
      cycle: toggleLsp,
    },
    {
      section: 'Language servers',
      label: 'Inline problem text',
      value: onOff(config.lspInline),
      cycle: toggleLspInline,
    },
    {
      section: 'Language servers',
      label: 'Autocomplete',
      value: onOff(config.lspCompletion),
      cycle: toggleLspCompletion,
    },
    {
      // One row, not fourteen: Enter lists every known server and picking one
      // flips it. Custom commands live on the row below.
      section: 'Language servers',
      label: 'Servers',
      value: `${DEFAULT_SERVERS.filter(s => (config.lspServers[s.id]?.length ?? 1) > 0).length}/${DEFAULT_SERVERS.length} enabled`,
      cycle: () => status.say('Enter opens the server list'),
      select: {
        options: DEFAULT_SERVERS.map(spec => serverLabel(spec.id, spec.command)),
        pick: at => toggleServer(DEFAULT_SERVERS[at]!.id),
      },
    },
    {
      section: 'Language servers',
      label: 'Server commands',
      value: `${Object.values(config.lspServers).filter(cmd => cmd.length > 0).length} custom`,
      cycle: () => status.say('Enter opens the server list'),
      select: {
        options: DEFAULT_SERVERS.map(spec => serverLabel(spec.id, spec.command)),
        pick: at => {
          const spec = DEFAULT_SERVERS[at]!
          const override = config.lspServers[spec.id]
          return {
            title: `Command — ${spec.id}`,
            initial: (override && override.length > 0 ? override : spec.command).join(' '),
            hint: 'empty restores the default · Enter apply · Esc cancel',
            apply: (value: string) => setServerCommand(spec.id, value),
          }
        },
      },
    },
  ]

  return {
    config,
    patchConfig,
    applyTheme,
    applyAppearance,
    toggleThemeSync,
    toggleTransparent,
    applyTabSize,
    applyVim,
    toggleTrim,
    toggleFormatOnSave,
    toggleAutoSave,
    toggleDiffView,
    toggleGitPanelView,
    toggleDotfiles,
    toggleGitignored,
    toggleLsp,
    toggleLspInline,
    toggleLspCompletion,
    toggleServer,
    setFormatter,
    setServerCommand,
    applySidebarWidth,
    rows,
    treeWidth,
    resizeSidebar,
    nudgeSidebar,
  }
}

export type Settings = ReturnType<typeof createSettings>

import { createStore, unwrap } from 'solid-js/store'

import { saveConfig, sidebarColumns, SIDEBAR_MIN, SIDEBAR_MAX } from '../core/config'
import type { Config } from '../core/config'
import { invalidateSyntaxStyle } from '../languages/highlight'
import { setTheme, themeLabels, THEMES } from '../themes'
import type { ThemeName } from '../themes'
import type { SettingRow } from '../ui/SettingsView'
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

  const patchConfig = (patch: Partial<Config>) => {
    setConfig(patch)
    saveConfig(unwrap(config))
  }

  const applyTheme = (name: ThemeName) => {
    setTheme(name)
    invalidateSyntaxStyle()
    patchConfig({ theme: name })
    status.say(`Theme: ${themeLabels[name]}`)
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

  const toggleDiffView = () => {
    const next = config.diffView === 'inline' ? 'split' : 'inline'
    patchConfig({ diffView: next })
  }

  const toggleAutoSave = () => {
    patchConfig({ autoSaveOnBlur: !config.autoSaveOnBlur })
    status.say(`Auto-save ${config.autoSaveOnBlur ? 'on' : 'off'}`)
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
      // Two values: a list to choose between them is more ceremony than the
      // flip is worth, so this stays a step like the booleans above.
      section: 'Git',
      label: 'Diff layout',
      value: config.diffView === 'inline' ? 'inline' : 'side-by-side',
      cycle: toggleDiffView,
    },
  ]

  return {
    config,
    patchConfig,
    applyTheme,
    applyTabSize,
    applyVim,
    toggleTrim,
    toggleAutoSave,
    toggleDiffView,
    toggleDotfiles,
    toggleGitignored,
    rows,
    treeWidth,
    resizeSidebar,
    nudgeSidebar,
  }
}

export type Settings = ReturnType<typeof createSettings>

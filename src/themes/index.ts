/**
 * Theme registry — the single place to add a color scheme.
 *
 * To add one: copy `github-dark.ts`, adjust the colors, then register it in
 * `THEMES` below. It shows up in the command palette automatically.
 */
import type { StyleDefinitionInput } from '@opentui/core'
import { createStore } from 'solid-js/store'

import { ayuDark } from './ayu-dark'
import { ayuLight } from './ayu-light'
import { ayuMirage } from './ayu-mirage'
import { catppuccinFrappe } from './catppuccin-frappe'
import { catppuccinLatte } from './catppuccin-latte'
import { catppuccinMacchiato } from './catppuccin-macchiato'
import { catppuccinMocha } from './catppuccin-mocha'
import { dracula } from './dracula'
import { everforestDark } from './everforest-dark'
import { everforestLight } from './everforest-light'
import { githubDark } from './github-dark'
import { githubLight } from './github-light'
import { gruvboxDark } from './gruvbox-dark'
import { gruvboxLight } from './gruvbox-light'
import { kanagawaDragon } from './kanagawa-dragon'
import { kanagawaLotus } from './kanagawa-lotus'
import { kanagawaWave } from './kanagawa-wave'
import { nord } from './nord'
import { oneDark } from './one-dark'
import { rosePine } from './rose-pine'
import { rosePineDawn } from './rose-pine-dawn'
import { rosePineMoon } from './rose-pine-moon'
import { solarizedDark } from './solarized-dark'
import { solarizedLight } from './solarized-light'
import { tokyoNight } from './tokyo-night'
import type { Theme, ThemeUi, UiColors } from './types'
import { vesper } from './vesper'

export type { Theme, ThemeUi, UiColors }

// Mocha before Macchiato: the palette matches a query in order, so the flavor
// whose name is a prefix of the other's search hits must come first.
export const THEMES = {
  'dark': githubDark,
  'light': githubLight,
  'ayu-dark': ayuDark,
  'ayu-mirage': ayuMirage,
  'ayu-light': ayuLight,
  'catppuccin-mocha': catppuccinMocha,
  'catppuccin-macchiato': catppuccinMacchiato,
  'catppuccin-frappe': catppuccinFrappe,
  'catppuccin-latte': catppuccinLatte,
  dracula,
  'everforest-dark': everforestDark,
  'everforest-light': everforestLight,
  'gruvbox': gruvboxDark,
  'gruvbox-light': gruvboxLight,
  'kanagawa-wave': kanagawaWave,
  'kanagawa-dragon': kanagawaDragon,
  'kanagawa-lotus': kanagawaLotus,
  nord,
  'one-dark': oneDark,
  'rose-pine': rosePine,
  'rose-pine-moon': rosePineMoon,
  'rose-pine-dawn': rosePineDawn,
  'solarized-dark': solarizedDark,
  'solarized-light': solarizedLight,
  'tokyo-night': tokyoNight,
  vesper,
}

export type ThemeName = keyof typeof THEMES

export const themeLabels = Object.fromEntries(
  Object.entries(THEMES).map(([id, theme]) => [id, theme.name]),
) as Record<ThemeName, string>

const DEFAULT: ThemeName = 'dark'

/** Whether the app paints its own background at all — the `transparent` setting. */
let seeThrough = false
let painted: ThemeName = DEFAULT

/** The store's contents for a theme, with `transparent` applied or not. */
function colorsFor(name: ThemeName, transparent: boolean): UiColors {
  const theme = THEMES[name].ui
  return {
    ...theme,
    sidebarBg: transparent ? 'transparent' : theme.panelBg,
    solidBg: theme.bg,
    solidBarBg: theme.barBg,
    ...(transparent ? { bg: 'transparent', barBg: 'transparent' } : null),
  }
}

// `ui` is a store, not a plain object: Solid components never re-render, so a
// mutated object would leave every color on screen stale after a theme switch.
// Reading `ui.bg` inside JSX subscribes that spot to the change.
const [ui, setUi] = createStore<UiColors>(colorsFor(DEFAULT, seeThrough))
export { ui }

// Read imperatively when the syntax style table is rebuilt, so a plain object is fine.
export const syntaxTheme: Record<string, StyleDefinitionInput> = { ...THEMES[DEFAULT].syntax }

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && value in THEMES
}

export function setTheme(name: ThemeName): void {
  painted = name
  setUi(colorsFor(name, seeThrough))
  // Replace, never merge: a group the new theme omits would otherwise keep the
  // previous theme's color and render invisible when light/dark flips.
  for (const group of Object.keys(syntaxTheme)) delete syntaxTheme[group]
  Object.assign(syntaxTheme, THEMES[name].syntax)
}

/** Paint the app's own background, or leave the terminal's showing through. */
export function setTransparency(on: boolean): void {
  seeThrough = on
  setUi(colorsFor(painted, on))
}

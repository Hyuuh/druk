/**
 * Theme registry — the single place to add a color scheme.
 *
 * To add one: copy `github-dark.ts`, adjust the colors, then register it in
 * `THEMES` below. It shows up in the command palette automatically.
 *
 * A plugin adds one at runtime through `registerTheme`, so every lookup goes
 * through `registry` rather than through `THEMES` itself — `THEMES` is the
 * built-in table, `registry` is what is actually on offer.
 */
import type { StyleDefinitionInput } from '@opentui/core'
import { createSignal } from 'solid-js'
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

/**
 * A theme id. Not `keyof typeof THEMES`: a plugin's theme is as real as a
 * built-in one and its id is not known at compile time. `isThemeName` is what
 * says an id is registered, and the config validator runs it.
 */
export type ThemeName = string

/**
 * The shipped themes, keyed loosely so an id computed at runtime can reach them.
 * Kept beside the registry because a plugin may register *over* a built-in id —
 * dropping that plugin has to put the shipped theme back rather than leave a
 * hole where `dark` used to be.
 */
const BUILTIN: Record<string, Theme> = { ...THEMES }

/** Every theme on offer — the built-ins, plus whatever plugins registered. */
const registry: Record<string, Theme> = { ...THEMES }

/** Registered by a plugin, and dropped again when plugins reload. */
const fromPlugins = new Set<string>()

// A signal, not `Object.keys(registry)` on demand: the palette's command tree and
// the settings page's theme lists are built inside reactive scopes, and a plugin
// reload that only mutated the object would leave both showing the old set.
const [names, setNames] = createSignal<ThemeName[]>(Object.keys(registry))

export function registerTheme(id: string, theme: Theme): void {
  registry[id] = theme
  fromPlugins.add(id)
  setNames(Object.keys(registry))
}

export function clearPluginThemes(): void {
  for (const id of fromPlugins) {
    const shipped = BUILTIN[id]
    if (shipped) registry[id] = shipped
    else delete registry[id]
  }
  fromPlugins.clear()
  setNames(Object.keys(registry))
}

export const themeNames = (): ThemeName[] => names()

const DEFAULT: ThemeName = 'dark'

/**
 * The theme `name` stands for, falling back to the default: a plugin can be
 * uninstalled while the config still names one of its themes, and every reader
 * here has to end up with colors rather than with a hole.
 */
export const themeFor = (name: ThemeName): Theme => registry[name] ?? registry[DEFAULT]!

export const themeLabel = (name: ThemeName): string => registry[name]?.name ?? name

/** Whether the app paints its own background at all — the `transparent` setting. */
let seeThrough = false

/**
 * Mix two `#rrggbb` colors. Here rather than from `languages/highlight`, whose
 * own mixer reads `ui` — importing it back would close the cycle.
 */
function mix(base: string, tint: string, amount: number): string {
  const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16)
  if (!/^#[0-9a-f]{6}$/i.test(base) || !/^#[0-9a-f]{6}$/i.test(tint)) return base
  const to = (at: number) =>
    Math.round(channel(base, at) + (channel(tint, at) - channel(base, at)) * amount)
      .toString(16)
      .padStart(2, '0')
  return `#${to(1)}${to(3)}${to(5)}`
}

/** The store's contents for a theme, with `transparent` applied or not. */
function colorsFor(name: ThemeName, transparent: boolean): UiColors {
  const theme = themeFor(name).ui
  return {
    ...theme,
    sidebarBg: transparent ? 'transparent' : theme.panelBg,
    solidBg: theme.bg,
    solidBarBg: theme.barBg,
    // Derived, not per-theme: 26 palettes would each need a hand-picked rule, and
    // a hairline is the same idea in all of them — the bar colour pushed a little
    // further from the background it sits on.
    border: mix(theme.barBg, theme.dim, 0.35),
    ...(transparent ? { bg: 'transparent', barBg: 'transparent' } : null),
  }
}

// `ui` is a store, not a plain object: Solid components never re-render, so a
// mutated object would leave every color on screen stale after a theme switch.
// Reading `ui.bg` inside JSX subscribes that spot to the change.
const [ui, setUi] = createStore<UiColors>(colorsFor(DEFAULT, seeThrough))
export { ui }

// The theme currently on screen — including a live preview that has not been
// written to config. The editor keys its syntax table off this, not off the
// config value: a preview that only updated `ui` left the buffer on the old
// style ids until the next keystroke.
const [paintedTheme, setPaintedTheme] = createSignal<ThemeName>(DEFAULT)
export { paintedTheme }

// Read imperatively when the syntax style table is rebuilt, so a plain object is fine.
export const syntaxTheme: Record<string, StyleDefinitionInput> = { ...themeFor(DEFAULT).syntax }

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && value in registry
}

export function setTheme(name: ThemeName): void {
  // What is really on screen, which is the default when the config names a
  // theme no plugin is registering any more.
  const painted = name in registry ? name : DEFAULT
  // Replace, never merge: a group the new theme omits would otherwise keep the
  // previous theme's color and render invisible when light/dark flips.
  // Data before the signal: reactive readers of `paintedTheme` rebuild the
  // syntax table, and must see this theme's colors when they do.
  for (const group of Object.keys(syntaxTheme)) delete syntaxTheme[group]
  Object.assign(syntaxTheme, themeFor(painted).syntax)
  setUi(colorsFor(painted, seeThrough))
  setPaintedTheme(painted)
}

/** Paint the app's own background, or leave the terminal's showing through. */
export function setTransparency(on: boolean): void {
  seeThrough = on
  setUi(colorsFor(paintedTheme(), on))
}

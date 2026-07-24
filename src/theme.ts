import type { StyleDefinitionInput } from '@opentui/core'

export interface ThemeUi {
  bg: string
  panelBg: string
  barBg: string
  statusBg: string
  statusFg: string
  text: string
  dim: string
  faint: string
  accent: string
  activeTabBg: string
  activeTabFg: string
  inactiveTabBg: string
  inactiveTabFg: string
  treeSelectedBg: string
  treeFocusBg: string
  dirty: string
  error: string
  folder: string
}

export interface Theme {
  ui: ThemeUi
  syntax: Record<string, StyleDefinitionInput>
}

const githubDark: Theme = {
  ui: {
    bg: '#0d1117',
    panelBg: '#161b22',
    barBg: '#010409',
    statusBg: '#1f6feb',
    statusFg: '#ffffff',
    text: '#e6edf3',
    dim: '#8b949e',
    faint: '#6e7681',
    accent: '#58a6ff',
    activeTabBg: '#0d1117',
    activeTabFg: '#e6edf3',
    inactiveTabBg: '#010409',
    inactiveTabFg: '#8b949e',
    treeSelectedBg: '#193356',
    treeFocusBg: '#21262d',
    dirty: '#d29922',
    error: '#f85149',
    folder: '#58a6ff',
  },
  syntax: {
    'comment': { fg: '#8b949e', italic: true },
    'keyword': { fg: '#ff7b72' },
    'keyword.operator': { fg: '#ff7b72' },
    'operator': { fg: '#ff7b72' },
    'string': { fg: '#a5d6ff' },
    'escape': { fg: '#79c0ff' },
    'number': { fg: '#79c0ff' },
    'boolean': { fg: '#79c0ff' },
    'constant': { fg: '#79c0ff' },
    'function': { fg: '#d2a8ff' },
    'constructor': { fg: '#d2a8ff' },
    'type': { fg: '#ff7b72' },
    'namespace': { fg: '#79c0ff' },
    'variable': { fg: '#ffa657' },
    'variable.builtin': { fg: '#79c0ff' },
    'variable.member': { fg: '#e6edf3' },
    'property': { fg: '#79c0ff' },
    'attribute': { fg: '#79c0ff' },
    'tag': { fg: '#7ee787' },
    'label': { fg: '#ff7b72' },
    'punctuation': { fg: '#8b949e' },
    'punctuation.special': { fg: '#79c0ff' },
    'embedded': { fg: '#e6edf3' },
    'error': { fg: '#f85149' },
    'markup.heading': { fg: '#79c0ff', bold: true },
    'markup.strong': { fg: '#e6edf3', bold: true },
    'markup.italic': { fg: '#e6edf3', italic: true },
    'markup.raw': { fg: '#a5d6ff' },
    'markup.link': { fg: '#a5d6ff' },
    'markup.link.label': { fg: '#79c0ff' },
    'markup.link.url': { fg: '#a5d6ff', underline: true },
    'markup.list': { fg: '#ff7b72' },
    'markup.quote': { fg: '#8b949e', italic: true },
  },
}

const githubLight: Theme = {
  ui: {
    bg: '#ffffff',
    panelBg: '#f6f8fa',
    barBg: '#eaeef2',
    statusBg: '#0969da',
    statusFg: '#ffffff',
    text: '#1f2328',
    dim: '#656d76',
    faint: '#8c959f',
    accent: '#0969da',
    activeTabBg: '#ffffff',
    activeTabFg: '#1f2328',
    inactiveTabBg: '#eaeef2',
    inactiveTabFg: '#656d76',
    treeSelectedBg: '#ddf4ff',
    treeFocusBg: '#eaeef2',
    dirty: '#9a6700',
    error: '#cf222e',
    folder: '#0969da',
  },
  syntax: {
    'comment': { fg: '#6e7781', italic: true },
    'keyword': { fg: '#cf222e' },
    'keyword.operator': { fg: '#cf222e' },
    'operator': { fg: '#cf222e' },
    'string': { fg: '#0a3069' },
    'escape': { fg: '#0550ae' },
    'number': { fg: '#0550ae' },
    'boolean': { fg: '#0550ae' },
    'constant': { fg: '#0550ae' },
    'function': { fg: '#8250df' },
    'constructor': { fg: '#8250df' },
    'type': { fg: '#cf222e' },
    'namespace': { fg: '#0550ae' },
    'variable': { fg: '#953800' },
    'variable.builtin': { fg: '#0550ae' },
    'variable.member': { fg: '#1f2328' },
    'property': { fg: '#0550ae' },
    'attribute': { fg: '#0550ae' },
    'tag': { fg: '#116329' },
    'label': { fg: '#cf222e' },
    'punctuation': { fg: '#6e7781' },
    'punctuation.special': { fg: '#0550ae' },
    'embedded': { fg: '#1f2328' },
    'error': { fg: '#cf222e' },
    'markup.heading': { fg: '#0550ae', bold: true },
    'markup.strong': { fg: '#1f2328', bold: true },
    'markup.italic': { fg: '#1f2328', italic: true },
    'markup.raw': { fg: '#0a3069' },
    'markup.link': { fg: '#0a3069' },
    'markup.link.label': { fg: '#0550ae' },
    'markup.link.url': { fg: '#0a3069', underline: true },
    'markup.list': { fg: '#cf222e' },
    'markup.quote': { fg: '#6e7781', italic: true },
  },
}

export const themes = { dark: githubDark, light: githubLight }
export type ThemeName = keyof typeof themes
export const themeLabels: Record<ThemeName, string> = {
  dark: 'GitHub Dark',
  light: 'GitHub Light',
}

// Stable objects whose contents setTheme() overwrites. Importers keep the same
// reference; a React re-render (triggered by App's theme state) repaints every
// component with the active theme's colors. Both themes share the same keys.
export const ui: ThemeUi = { ...githubDark.ui }
export const syntaxTheme: Record<string, StyleDefinitionInput> = { ...githubDark.syntax }

export function setTheme(name: ThemeName): void {
  Object.assign(ui, themes[name].ui)
  Object.assign(syntaxTheme, themes[name].syntax)
}

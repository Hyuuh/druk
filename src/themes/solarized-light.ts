import type { Theme } from './types'

/**
 * Solarized Light. Palette from https://github.com/altercation/solarized; the
 * capture groups follow that repository's own vim colorscheme — Statement is
 * green, Constant cyan, Identifier blue, Type yellow, Special red.
 *
 * Solarized keeps the accents and flips only the monotones, so the greys here
 * are the dark theme's read from the other end: body text is base00, not base0.
 */
export const solarizedLight: Theme = {
  name: 'Solarized Light',
  ui: {
    bg: '#fdf6e3',
    panelBg: '#fdf6e3',
    barBg: '#eee8d5',
    statusBg: '#268bd2',
    statusFg: '#fdf6e3',
    text: '#657b83',
    dim: '#839496',
    faint: '#93a1a1',
    accent: '#268bd2',
    activeTabFg: '#586e75',
    inactiveTabFg: '#839496',
    treeSelectedBg: '#eee8d5',
    treeFocusBg: '#f6efdc',
    dirty: '#b58900',
    error: '#dc322f',
    folder: '#657b83',
    cursor: '#657b83',
    scrollbar: '#93a1a1',
    gutter: '#93a1a1',
    currentLine: '#eee8d5',
    indentGuide: '#f6efdc',
    gitAdded: '#859900',
    gitModified: '#b58900',
    gitDeleted: '#dc322f',
  },
  syntax: {
    'comment': { fg: '#93a1a1', italic: true },
    'keyword': { fg: '#859900' },
    'string': { fg: '#2aa198' },
    'number': { fg: '#2aa198' },
    'boolean': { fg: '#2aa198' },
    'constant': { fg: '#2aa198' },
    'function': { fg: '#268bd2' },
    'type': { fg: '#b58900' },
    'variable': { fg: '#657b83' },
    'property': { fg: '#268bd2' },
    'tag': { fg: '#dc322f' },
    'operator': { fg: '#859900' },
    'punctuation': { fg: '#657b83' },
    'label': { fg: '#859900' },
    'escape': { fg: '#dc322f' },
    'embedded': { fg: '#657b83' },
    'error': { fg: '#dc322f' },
    'markup.heading': { fg: '#268bd2', bold: true },
    'markup.strong': { fg: '#657b83', bold: true },
    'markup.italic': { fg: '#657b83', italic: true },
    'markup.raw': { fg: '#2aa198' },
    'markup.link': { fg: '#2aa198' },
    'markup.link.url': { fg: '#2aa198', underline: true },
    'markup.list': { fg: '#859900' },
    'markup.quote': { fg: '#93a1a1', italic: true },
  },
}

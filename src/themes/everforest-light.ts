import type { Theme } from './types'

/**
 * Everforest Light, medium contrast. Palette and highlight semantics from
 * https://github.com/sainnhe/everforest/blob/master/palette.md — the syntax
 * colors follow that table's Treesitter notes, which differ from the Vim ones
 * (strings are aqua, not green; fields are blue).
 */
export const everforestLight: Theme = {
  name: 'Everforest Light',
  ui: {
    bg: '#fdf6e3',
    panelBg: '#efebd4',
    barBg: '#e6e2cc',
    statusBg: '#93b259',
    statusFg: '#fdf6e3',
    text: '#5c6a72',
    dim: '#829181',
    faint: '#a6b0a0',
    accent: '#8da101',
    activeTabFg: '#5c6a72',
    inactiveTabFg: '#939f91',
    treeSelectedBg: '#e6e2cc',
    treeFocusBg: '#f4f0d9',
    dirty: '#dfa000',
    error: '#f85552',
    folder: '#5c6a72',
    cursor: '#5c6a72',
    scrollbar: '#bdc3af',
    gutter: '#a6b0a0',
    currentLine: '#f4f0d9',
    indentGuide: '#f2ecd8',
    gitAdded: '#8da101',
    gitModified: '#3a94c5',
    gitDeleted: '#f85552',
  },
  syntax: {
    'comment': { fg: '#939f91', italic: true },
    'keyword': { fg: '#f85552' },
    'string': { fg: '#35a77c' },
    'number': { fg: '#df69ba' },
    'boolean': { fg: '#df69ba' },
    'constant': { fg: '#5c6a72' },
    'function': { fg: '#8da101' },
    'type': { fg: '#dfa000' },
    'variable': { fg: '#5c6a72' },
    'property': { fg: '#3a94c5' },
    'tag': { fg: '#f57d26' },
    'operator': { fg: '#f57d26' },
    'punctuation': { fg: '#939f91' },
    'label': { fg: '#f57d26' },
    'escape': { fg: '#8da101' },
    'embedded': { fg: '#5c6a72' },
    'error': { fg: '#f85552' },
    'markup.heading': { fg: '#f57d26', bold: true },
    'markup.strong': { fg: '#5c6a72', bold: true },
    'markup.italic': { fg: '#5c6a72', italic: true },
    'markup.raw': { fg: '#35a77c' },
    'markup.link': { fg: '#35a77c' },
    'markup.link.url': { fg: '#35a77c', underline: true },
    'markup.list': { fg: '#f85552' },
    'markup.quote': { fg: '#939f91', italic: true },
  },
}

import type { Theme } from './types'

/**
 * Everforest Dark, medium contrast. Palette and highlight semantics from
 * https://github.com/sainnhe/everforest/blob/master/palette.md — the syntax
 * colors follow that table's Treesitter notes, which differ from the Vim ones
 * (strings are aqua, not green; fields are blue).
 */
export const everforestDark: Theme = {
  name: 'Everforest Dark',
  ui: {
    bg: '#2d353b',
    panelBg: '#232a2e',
    barBg: '#1e2326',
    statusBg: '#a7c080',
    statusFg: '#2d353b',
    text: '#d3c6aa',
    dim: '#9da9a0',
    faint: '#7a8478',
    accent: '#a7c080',
    activeTabFg: '#d3c6aa',
    inactiveTabFg: '#859289',
    treeSelectedBg: '#475258',
    treeFocusBg: '#343f44',
    dirty: '#dbbc7f',
    error: '#e67e80',
    folder: '#d3c6aa',
    cursor: '#d3c6aa',
    scrollbar: '#4f585e',
    gutter: '#7a8478',
    currentLine: '#343f44',
    indentGuide: '#353e44',
    gitAdded: '#a7c080',
    gitModified: '#7fbbb3',
    gitDeleted: '#e67e80',
  },
  syntax: {
    'comment': { fg: '#859289', italic: true },
    'keyword': { fg: '#e67e80' },
    'string': { fg: '#83c092' },
    'number': { fg: '#d699b6' },
    'boolean': { fg: '#d699b6' },
    'constant': { fg: '#d3c6aa' },
    'function': { fg: '#a7c080' },
    'type': { fg: '#dbbc7f' },
    'variable': { fg: '#d3c6aa' },
    'property': { fg: '#7fbbb3' },
    'tag': { fg: '#e69875' },
    'operator': { fg: '#e69875' },
    'punctuation': { fg: '#859289' },
    'label': { fg: '#e69875' },
    'escape': { fg: '#a7c080' },
    'embedded': { fg: '#d3c6aa' },
    'error': { fg: '#e67e80' },
    'markup.heading': { fg: '#e69875', bold: true },
    'markup.strong': { fg: '#d3c6aa', bold: true },
    'markup.italic': { fg: '#d3c6aa', italic: true },
    'markup.raw': { fg: '#83c092' },
    'markup.link': { fg: '#83c092' },
    'markup.link.url': { fg: '#83c092', underline: true },
    'markup.list': { fg: '#e67e80' },
    'markup.quote': { fg: '#859289', italic: true },
  },
}

import type { Theme } from './types'

/**
 * Rosé Pine Dawn. Palette from https://github.com/rose-pine/neovim
 * (`lua/rose-pine/palette.lua`); the capture groups and UI slots follow the
 * official VS Code port, https://github.com/rose-pine/vscode, whose text tone
 * (`#575279`) is the one the palette page publishes.
 */
export const rosePineDawn: Theme = {
  name: 'Rosé Pine Dawn',
  ui: {
    bg: '#faf4ed',
    panelBg: '#fffaf3',
    barBg: '#f8f0e7',
    statusBg: '#907aa9',
    statusFg: '#faf4ed',
    text: '#575279',
    dim: '#797593',
    faint: '#9893a5',
    accent: '#907aa9',
    activeTabFg: '#575279',
    inactiveTabFg: '#797593',
    treeSelectedBg: '#dfdad9',
    treeFocusBg: '#f2e9e1',
    dirty: '#ea9d34',
    error: '#b4637a',
    folder: '#575279',
    cursor: '#9893a5',
    scrollbar: '#cecacd',
    gutter: '#797593',
    currentLine: '#f4ede8',
    indentGuide: '#f0eae6',
    gitAdded: '#56949f',
    gitModified: '#d7827e',
    gitDeleted: '#b4637a',
  },
  syntax: {
    'comment': { fg: '#9893a5', italic: true },
    'keyword': { fg: '#286983' },
    'string': { fg: '#ea9d34' },
    'number': { fg: '#d7827e' },
    'boolean': { fg: '#d7827e' },
    'constant': { fg: '#d7827e' },
    'function': { fg: '#d7827e' },
    'type': { fg: '#56949f' },
    'variable': { fg: '#575279' },
    'property': { fg: '#56949f' },
    'tag': { fg: '#56949f' },
    'operator': { fg: '#286983' },
    'punctuation': { fg: '#797593' },
    'label': { fg: '#907aa9' },
    'escape': { fg: '#286983' },
    'embedded': { fg: '#575279' },
    'error': { fg: '#b4637a' },
    'markup.heading': { fg: '#907aa9', bold: true },
    'markup.strong': { fg: '#575279', bold: true },
    'markup.italic': { fg: '#575279', italic: true },
    'markup.raw': { fg: '#ea9d34' },
    'markup.link': { fg: '#56949f' },
    'markup.link.url': { fg: '#56949f', underline: true },
    'markup.list': { fg: '#286983' },
    'markup.quote': { fg: '#9893a5', italic: true },
  },
}

import { expect, test } from 'bun:test'

import { buildCommands } from '../src/app/commands'
import type { CommandActions } from '../src/app/commands'
import { THEMES, themeLabels } from '../src/themes'
import type { ThemeName } from '../src/themes'

const noop = () => {}

function makeActions(preview: (name: ThemeName) => void, restore: () => void): CommandActions {
  return {
    save: noop,
    openFile: noop,
    switchTab: noop,
    closeOthers: noop,
    closeAll: noop,
    gotoLine: noop,
    undo: noop,
    redo: noop,
    findInFile: noop,
    findInProject: noop,
    replaceInFile: noop,
    newFile: noop,
    newFolder: noop,
    rename: noop,
    remove: noop,
    cutForMove: noop,
    copyForPaste: noop,
    paste: noop,
    closeTab: noop,
    reopenTab: noop,
    nextTab: noop,
    prevTab: noop,
    toggleFocus: noop,
    toggleSidebar: noop,
    toggleGitView: noop,
    toggleMarkdown: noop,
    setTheme: noop,
    previewTheme: preview,
    restoreTheme: restore,
    lineOp: noop,
    triggerCompletion: noop,
    openSettings: noop,
    openProjectSettings: noop,
    problemsList: noop,
    problemsNext: noop,
    problemsPrev: noop,
    showDiff: noop,
    gitCompareBranches: noop,
    gitMoveTo: noop,
    gitActivateRow: noop,
    gitDiffFile: noop,
    refreshDiff: noop,
    gitDiffBase: noop,
    gitDiffBaseReset: noop,
    gitCommit: noop,
    gitUndoCommit: noop,
    gitPush: noop,
    gitFetch: noop,
    gitPull: noop,
    gitStash: noop,
    gitStashPop: noop,
    gitSwitchBranch: noop,
    gitNewBranch: noop,
    gitNewBranchFrom: noop,
    gitMergeBranch: noop,
    gitRenameBranch: noop,
    gitDeleteBranch: noop,
    gitDeleteBranchForce: noop,
    showHelp: noop,
    quit: noop,
  }
}

test('palette theme commands carry preview and cancel hooks', () => {
  const previewed: string[] = []
  const restored: string[] = []
  const actions = makeActions(
    name => previewed.push(name),
    () => restored.push('restore'),
  )
  const commands = buildCommands(actions, { activeTheme: 'nord' })
  const themes = commands.find(c => c.id === 'themes')?.children ?? []
  const leaves = themes.filter(c => Object.keys(THEMES).includes(c.id.replace('themes.', '')))
  const labels = leaves.map(c => c.label.trim())

  expect(leaves.length).toBe(Object.keys(THEMES).length)
  expect(labels).toContain(`* ${themeLabels.nord}`)

  const nordLeaf = leaves.find(c => c.id === 'themes.nord')
  const lightLeaf = leaves.find(c => c.id === 'themes.light')
  expect(nordLeaf?.preview).toBeTypeOf('function')
  expect(nordLeaf?.cancel).toBeTypeOf('function')

  if (lightLeaf?.preview) lightLeaf.preview()
  expect(previewed).toEqual(['light'])
  if (lightLeaf?.cancel) lightLeaf.cancel()
  expect(restored).toEqual(['restore'])
})

import { describe, expect, test } from 'bun:test'

import { duplicateLines, moveLines, toggleComment, trimTrailing } from '../src/editor/lines'

describe('toggleComment', () => {
  test('comments a line and uncomments it back', () => {
    const once = toggleComment('const a = 1\n', 0, 0, '//')
    expect(once).toBe('// const a = 1\n')
    expect(toggleComment(once, 0, 0, '//')).toBe('const a = 1\n')
  })

  test('a block comments at its shallowest indent', () => {
    const text = '  if (x) {\n    y()\n  }\n'
    expect(toggleComment(text, 0, 2, '//')).toBe('  // if (x) {\n  //   y()\n  // }\n')
  })

  test('a mixed block gets commented, not toggled line by line', () => {
    const text = '// done\ntodo\n'
    expect(toggleComment(text, 0, 1, '//')).toBe('// // done\n// todo\n')
  })

  test('blank lines are skipped, and an all-blank range is untouched', () => {
    expect(toggleComment('a\n\nb\n', 0, 2, '#')).toBe('# a\n\n# b\n')
    expect(toggleComment('\n\n', 0, 1, '#')).toBe('\n\n')
  })

  test('uncommenting eats one space after the prefix, not the indent', () => {
    expect(toggleComment('  # x\n', 0, 0, '#')).toBe('  x\n')
    expect(toggleComment('  #x\n', 0, 0, '#')).toBe('  x\n')
  })
})

describe('moveLines', () => {
  test('moves a line down and back up', () => {
    expect(moveLines('a\nb\nc\n', 0, 0, 1)).toBe('b\na\nc\n')
    expect(moveLines('a\nb\nc\n', 1, 1, -1)).toBe('b\na\nc\n')
  })

  test('moves a block as one unit', () => {
    expect(moveLines('a\nb\nc\nd\n', 0, 1, 1)).toBe('c\na\nb\nd\n')
  })

  test('refuses to move past either edge', () => {
    expect(moveLines('a\nb\n', 0, 0, -1)).toBeNull()
    expect(moveLines('a\nb\n', 1, 1, 1)).toBeNull()
  })
})

describe('duplicateLines', () => {
  test('copies the line below itself', () => {
    expect(duplicateLines('a\nb\n', 0, 0)).toBe('a\na\nb\n')
  })

  test('copies a block below the block', () => {
    expect(duplicateLines('a\nb\nc\n', 0, 1)).toBe('a\nb\na\nb\nc\n')
  })
})

describe('trimTrailing', () => {
  test('strips trailing spaces and tabs from every line', () => {
    expect(trimTrailing('a  \nb\t\nc\n')).toBe('a\nb\nc\n')
  })

  test('adds the final newline when missing, and only then', () => {
    expect(trimTrailing('a')).toBe('a\n')
    expect(trimTrailing('a\n')).toBe('a\n')
  })

  test('leaves leading indentation alone', () => {
    expect(trimTrailing('  a \n')).toBe('  a\n')
  })
})

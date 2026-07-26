import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULTS } from '../src/core/config'
import { fixture, launch, press, pressEscape } from './helpers'

/** Open the only file with vim mode on, from a project whose sidebar is showing. */
async function vimEditor(content = 'one\ntwo\nthree\n') {
  const dir = fixture({ 'a.ts': content })
  const t = await launch(dir, { ...DEFAULTS, vim: true })
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  return { t, dir, file: join(dir, 'a.ts') }
}

describe('vim mode', () => {
  test('starts in normal mode and says so', async () => {
    const { t } = await vimEditor()
    expect(t.captureCharFrame()).toContain('NORMAL')
  })

  test('i enters insert mode and Esc leaves it, with the sidebar showing', async () => {
    // Esc is also "leave the editor for the tree". App's handler runs first and
    // focus moves synchronously, so without a vim guard the mode never changes
    // and the next key is a tree command — `d` would offer to delete the file.
    const { t } = await vimEditor()
    await press(t, i => i.pressKey('i'))
    expect(t.captureCharFrame()).toContain('INSERT')

    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('NORMAL')
    expect(t.captureCharFrame()).not.toContain('Delete')
  })

  test('normal mode swallows unknown keys instead of typing them', async () => {
    const { t, file } = await vimEditor()
    await press(t, i => void i.typeText('zzz')) // no such command — must not reach the buffer
    await press(t, i => i.pressKey('i'))
    await press(t, i => void i.typeText('X'))
    await press(t, i => i.pressKey('s', { ctrl: true }))

    expect(readFileSync(file, 'utf8')).toBe('Xone\ntwo\nthree\n')
  })

  test('dd deletes a line and p puts it back', async () => {
    const { t, file } = await vimEditor()
    await press(t, i => void i.typeText('dd'))
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(file, 'utf8')).toBe('two\nthree\n')

    await press(t, i => void i.typeText('p'))
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(file, 'utf8')).toBe('two\none\nthree\n')
  })

  test('a count applies to the operator that follows it', async () => {
    const { t, file } = await vimEditor('a\nb\nc\nd\n')
    await press(t, i => void i.typeText('2dd'))
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(file, 'utf8')).toBe('c\nd\n')
  })

  test('a count is not carried into the next command', async () => {
    const { t, file } = await vimEditor('a\nb\nc\nd\n')
    await press(t, i => void i.typeText('2j')) // move, consuming the 2
    await press(t, i => void i.typeText('dd')) // deletes one line, not two
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(file, 'utf8')).toBe('a\nb\nd\n')
  })
})

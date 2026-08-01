import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { latinKey } from '../src/core/keylayout'
import { fixture, launch, openFile, press, settle } from './helpers'

describe('a non-Latin layout', () => {
  test('a Cyrillic character names the US key it sits on', () => {
    expect(latinKey({ name: 'ф' })).toBe('a')
    expect(latinKey({ name: 'і' })).toBe('s')
    expect(latinKey({ name: 'ы' })).toBe('s')
    expect(latinKey({ name: 'з' })).toBe('p')
    // Shift is a separate flag, so the uppercase form is the same key.
    expect(latinKey({ name: 'Ф' })).toBe('a')
  })

  test('a base code from the kitty protocol wins over the table', () => {
    // Layouts the table knows nothing about are covered by this alone.
    expect(latinKey({ name: 'ф', baseCode: 115 })).toBe('s')
    expect(latinKey({ name: 'α', baseCode: 97 })).toBe('a')
    expect(latinKey({ name: 'α' })).toBe('α')
  })

  test('a Latin key keeps its own name', () => {
    expect(latinKey({ name: 's' })).toBe('s')
    expect(latinKey({ name: 'escape' })).toBe('escape')
    expect(latinKey({ name: '.' })).toBe('.')
  })

  test('Ctrl+<Cyrillic> runs the shortcut the key holds', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, {}, { kittyKeyboard: true })
    // Ctrl+з — з is the Ukrainian key at P, so this is Ctrl+P.
    await press(t, i => i.pressKey('з', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('Open file')
  })

  test('Ctrl+<Cyrillic> saves, the way Ctrl+S does', async () => {
    const dir = fixture({ 'a.ts': 'const a = 1\n' })
    const t = await launch(dir, {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.ts')
    await press(t, i => i.pressKey('x'))
    // і is the Ukrainian key at S.
    await press(t, i => i.pressKey('і', { ctrl: true }))
    await settle(t, 100)
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toContain('x')
  })

  test('typing Cyrillic still types it', async () => {
    const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), {}, {}, { kittyKeyboard: true })
    await openFile(t, 'a.ts')
    await press(t, i => i.pressKey('ф'))
    expect(t.captureCharFrame()).toContain('ф')
  })
})

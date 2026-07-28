import { describe, expect, test } from 'bun:test'

import { parseKeypress } from '@opentui/core'

/**
 * Bytes a terminal actually puts on the wire in raw mode. A chord that cannot be
 * told apart from another one here is unbindable, however good it looks in a menu.
 */
const seq = (bytes: string) => {
  const key = parseKeypress(bytes)
  return {
    name: key?.name,
    ctrl: key?.ctrl ?? false,
    shift: key?.shift ?? false,
    meta: key?.meta ?? false,
    option: key?.option ?? false,
  }
}

const ESC = '\u001B'
/** The control byte a terminal sends for Ctrl+<letter>. */
const ctrl = (letter: string) => String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64)
/** Terminal.app and iTerm2 prefix Esc for the Opt modifier. */
const withOpt = (bytes: string) => `${ESC}${bytes}`

describe('what terminals can encode', () => {
  test('Ctrl+Shift+letter is indistinguishable from Ctrl+letter', () => {
    // Both chords send the same byte outside the kitty keyboard protocol, which
    // is why the project search is not bound to one.
    expect(seq(ctrl('f')).shift).toBe(false)
    expect(seq(ctrl('n')).shift).toBe(false)
  })

  test('Ctrl+Opt+letter arrives as ctrl+meta, not ctrl+option', () => {
    // This is why `chord()` in App.tsx accepts meta as well as option.
    expect(seq(withOpt(ctrl('f')))).toMatchObject({ name: 'f', ctrl: true, meta: true })
    expect(seq(withOpt(ctrl('f'))).option).toBe(false)
    expect(seq(withOpt(ctrl('n')))).toMatchObject({ name: 'n', ctrl: true, meta: true })
  })

  test('every plain Ctrl binding survives the wire', () => {
    for (const letter of 'poszqtgfrwnbdycxv'.split('')) {
      expect(seq(ctrl(letter))).toMatchObject({ name: letter, ctrl: true })
    }
  })

  test('the tab and page chords keep their names', () => {
    expect(seq(`${ESC}[5;5~`)).toMatchObject({ name: 'pageup', ctrl: true })
    expect(seq(`${ESC}[6;5~`)).toMatchObject({ name: 'pagedown', ctrl: true })
    // Ctrl+Opt+arrow: the spelling macOS does not swallow for Mission Control.
    expect(seq(`${ESC}[1;7D`)).toMatchObject({ name: 'left', ctrl: true })
    expect(seq(`${ESC}[1;7C`)).toMatchObject({ name: 'right', ctrl: true })
  })
})

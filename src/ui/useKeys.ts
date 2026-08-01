import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'

import { latinKey } from '../core/keylayout'

/**
 * Every key handler in druk subscribes through here rather than OpenTUI's
 * `useKeyboard`, so a shortcut is the key's place on the keyboard and not the
 * letter the current layout prints — see `core/keylayout.ts`.
 *
 * The event is renamed in place, which the listeners after this one (and the
 * textarea's own handling) see as well: the translation is idempotent, so it
 * does not matter which handler gets there first. Only while Ctrl is held —
 * without it the character is the one being typed, and every chord the keymap
 * can hold has Ctrl or is a function key anyway (`bindingProblem`).
 */
export function useKeys(handler: (key: KeyEvent) => void) {
  useKeyboard((key: KeyEvent) => {
    if (key.ctrl) key.name = latinKey(key)
    handler(key)
  })
}

/**
 * Key chords as text: parsing what the `keybindings` setting holds, spelling one
 * back for a menu, and matching one against a key event.
 *
 * Only what a terminal actually puts on the wire is bindable — `test/hotkeys.test.ts`
 * pins the encodings. Two of them shape everything here: Ctrl+Shift+<letter> is
 * byte-identical to Ctrl+<letter>, and the Opt modifier arrives as meta on
 * Terminal.app but as option on iTerm2. So there is one modifier slot beside Ctrl
 * rather than three, and every spelling of it — Opt, Alt, Option, Meta, Cmd,
 * Shift — parses to that one flag.
 */
import type { KeyEvent } from '@opentui/core'

export interface Chord {
  ctrl: boolean
  /** The second modifier, however this terminal spells it. */
  alt: boolean
  /** OpenTUI's key name: a letter, `f1`, `left`, `pageup`, … */
  key: string
}

const MODIFIERS: Record<string, 'ctrl' | 'alt'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  opt: 'alt',
  option: 'alt',
  meta: 'alt',
  cmd: 'alt',
  command: 'alt',
  super: 'alt',
  shift: 'alt',
}

/** Spellings a user may reasonably type for a named key. */
const ALIASES: Record<string, string> = {
  '←': 'left',
  '→': 'right',
  '↑': 'up',
  '↓': 'down',
  'arrowleft': 'left',
  'arrowright': 'right',
  'arrowup': 'up',
  'arrowdown': 'down',
  'esc': 'escape',
  'enter': 'return',
  'ret': 'return',
  'pgup': 'pageup',
  'pgdn': 'pagedown',
  'pgdown': 'pagedown',
  'bksp': 'backspace',
  'backsp': 'backspace',
  'del': 'delete',
  'spc': 'space',
  'ins': 'insert',
}

const FUNCTION_KEY = /^f([1-9]|1[0-2])$/

const NAMED = new Set([
  'left',
  'right',
  'up',
  'down',
  'pageup',
  'pagedown',
  'home',
  'end',
  'tab',
  'space',
  'return',
  'escape',
  'backspace',
  'delete',
  'insert',
])

/** How a chord is written back out — the spelling a menu shows. */
const DISPLAY: Record<string, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  home: 'Home',
  end: 'End',
  tab: 'Tab',
  space: 'Space',
  return: 'Enter',
  escape: 'Esc',
  backspace: 'Bksp',
  delete: 'Del',
  insert: 'Ins',
}

/**
 * Chords a global binding may not have, because the byte belongs to something
 * else: the terminal sends the same one for Ctrl+I and Tab, and taking it would
 * cost the editor a key nothing else provides.
 */
const RESERVED: Record<string, string> = {
  'c': 'Ctrl+C copies the selection, or quits when there is none',
  'i': 'Ctrl+I is the Tab byte',
  'm': 'Ctrl+M is Enter',
  'j': 'Ctrl+J is a newline',
  'h': 'Ctrl+H is Backspace',
  '[': 'Ctrl+[ is Escape',
  'space': 'Ctrl+Space triggers autocomplete',
}

const isKeyName = (key: string) =>
  NAMED.has(key) || FUNCTION_KEY.test(key) || (key.length === 1 && key >= '!' && key <= '~')

/** A chord out of `Ctrl+Opt+K` and its spellings, or null for anything else. */
export function parseChord(spelling: string): Chord | null {
  const parts = spelling
    .split('+')
    .map(part => part.trim())
    .filter(part => part.length > 0)
  if (parts.length === 0) return null
  const chord: Chord = { ctrl: false, alt: false, key: '' }
  for (const [at, part] of parts.entries()) {
    const lower = part.toLowerCase()
    const last = at === parts.length - 1
    const modifier = MODIFIERS[lower]
    // A modifier name only counts as one ahead of the key: "Ctrl+Shift" is no chord,
    // and neither is a chord that names its key first.
    if (modifier && !last) {
      chord[modifier] = true
      continue
    }
    if (!last) return null
    const key = ALIASES[lower] ?? lower
    if (!isKeyName(key)) return null
    chord.key = key
  }
  return chord.key ? chord : null
}

/** `altLabel` is what the key beside the space bar is called here — Opt or Alt. */
export function formatChord(chord: Chord, altLabel: string): string {
  const key = DISPLAY[chord.key] ?? (FUNCTION_KEY.test(chord.key) ? chord.key.toUpperCase() : null)
  const parts = [
    ...(chord.ctrl ? ['Ctrl'] : []),
    ...(chord.alt ? [altLabel] : []),
    key ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key),
  ]
  return parts.join('+')
}

/** Identity for a chord, so two of them can be compared as map keys. */
export const chordId = (chord: Chord): string =>
  `${chord.ctrl ? 'c' : ''}${chord.alt ? 'a' : ''}:${chord.key}`

/**
 * The second modifier as the terminal reports it: meta on Terminal.app, option on
 * iTerm2, and shift for the letters where Ctrl+Shift and Ctrl are the same byte.
 */
export const secondary = (key: KeyEvent) => Boolean(key.option || key.meta || key.shift)

export function matchesChord(chord: Chord, key: KeyEvent): boolean {
  // Enter reports under either name depending on the terminal; one chord covers both.
  const name = key.name === 'enter' ? 'return' : key.name
  return name === chord.key && Boolean(key.ctrl) === chord.ctrl && secondary(key) === chord.alt
}

/**
 * Why `chord` cannot be a global shortcut, or null when it can be one. A chord
 * without Ctrl is refused outright: the global keymap runs ahead of the textarea,
 * so a bare — or merely Opt-shifted — letter would be typing the editor never sees.
 */
export function bindingProblem(chord: Chord): string | null {
  if (!chord.ctrl) {
    return FUNCTION_KEY.test(chord.key) ? null : 'A shortcut needs Ctrl or a function key'
  }
  if (!chord.alt) {
    const reserved = RESERVED[chord.key]
    if (reserved) return reserved
  }
  return null
}

import type { KeyEvent, TextareaRenderable } from '@opentui/core'

export type VimMode = 'normal' | 'insert' | 'visual'

export const MODE_LABELS: Record<VimMode, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
}

/** Mutable state a vim session carries between keystrokes. */
export interface VimState {
  mode: VimMode
  pending: string // partial operator, e.g. "d" waiting for a motion, or "g"
  count: string // numeric prefix, e.g. "12" in 12j
  register: string // last yanked/deleted text
  registerLinewise: boolean
}

export function initialVimState(): VimState {
  return { mode: 'normal', pending: '', count: '', register: '', registerLinewise: false }
}

type Editor = TextareaRenderable

const isSelecting = (state: VimState) => state.mode === 'visual'

/** Motions shared by normal and visual mode. Returns true if `k` was a motion. */
function motion(editor: Editor, k: string, state: VimState, count: number): boolean {
  const select = isSelecting(state)
  const repeat = (fn: () => void) => {
    for (let i = 0; i < count; i++) fn()
  }

  switch (k) {
    case 'h':
    case 'left':
      repeat(() => editor.moveCursorLeft({ select }))
      return true
    case 'l':
    case 'right':
      repeat(() => editor.moveCursorRight({ select }))
      return true
    case 'j':
    case 'down':
      repeat(() => editor.moveCursorDown({ select }))
      return true
    case 'k':
    case 'up':
      repeat(() => editor.moveCursorUp({ select }))
      return true
    case 'w':
      repeat(() => editor.moveWordForward({ select }))
      return true
    case 'b':
      repeat(() => editor.moveWordBackward({ select }))
      return true
    case '0':
      editor.gotoLineHome({ select })
      return true
    case '$':
      editor.gotoLineEnd({ select })
      return true
    case 'G':
      editor.gotoBufferEnd({ select })
      return true
    default:
      return false
  }
}

function yankSelection(editor: Editor, state: VimState): void {
  const text = editor.getSelectedText()
  if (text) {
    state.register = text
    state.registerLinewise = false
  }
}

/**
 * Copy `count` whole lines from the cursor into the register (yy, and the first
 * half of dd). The trailing newline is load-bearing — `paste` strips it back off.
 */
function yankLines(editor: Editor, state: VimState, count: number): void {
  const { row } = editor.logicalCursor
  state.register = `${editor.plainText
    .split('\n')
    .slice(row, row + count)
    .join('\n')}\n`
  state.registerLinewise = true
}

function deleteLine(editor: Editor, state: VimState, count: number): void {
  yankLines(editor, state, count)
  for (let i = 0; i < count; i++) editor.deleteLine()
}

/** What `d` and `c` delete, by the key that follows the operator. */
const OPERATOR_TARGETS: Record<string, (editor: Editor, count: number) => void> = {
  w: (e, n) => {
    for (let i = 0; i < n; i++) e.deleteWordForward()
  },
  b: (e, n) => {
    for (let i = 0; i < n; i++) e.deleteWordBackward()
  },
  $: e => e.deleteToLineEnd(),
  0: e => e.deleteToLineStart(),
}

function paste(editor: Editor, state: VimState, before: boolean): void {
  if (!state.register) return
  if (state.registerLinewise) {
    if (before) editor.gotoLineStart()
    else {
      editor.gotoLineEnd()
      editor.newLine()
    }
    // The register already ends in a newline; drop it so we don't add a blank line.
    editor.insertText(state.register.replace(/\n$/, ''))
    if (before) {
      editor.newLine()
      editor.moveCursorUp()
    }
  } else {
    if (!before) editor.moveCursorRight()
    editor.insertText(state.register)
  }
}

/**
 * Handle one key in vim mode. Returns true when the key was consumed (the
 * caller should `preventDefault()` so the textarea never sees it).
 */
export function handleVimKey(editor: Editor, key: KeyEvent, state: VimState): boolean {
  // Shifted letters arrive as the lowercase name plus `shift`, so restore the
  // uppercase form the commands below are written against (A, O, G, …).
  const k = key.shift && /^[a-z]$/.test(key.name) ? key.name.toUpperCase() : key.name
  if (state.mode === 'insert') {
    if (k === 'escape') {
      state.mode = 'normal'
      editor.moveCursorLeft()
      return true
    }
    return false
  }

  if (key.ctrl) {
    if (k === 'r') {
      editor.redo()
      return true
    }
    if (k === 'd' || k === 'u') {
      for (let i = 0; i < 10; i++) {
        if (k === 'd') editor.moveCursorDown()
        else editor.moveCursorUp()
      }
      return true
    }
    return false
  }

  // A leading "0" is the line-start motion, not the start of a count.
  if (/^\d$/.test(k) && !(k === '0' && state.count === '')) {
    state.count += k
    return true
  }
  // Every path below consumes the count; only the operator setter puts it back,
  // so that `3dd` still reaches the operator with its 3.
  const digits = state.count
  state.count = ''
  const count = Math.max(1, Number.parseInt(digits || '1', 10))

  if (state.pending) {
    const op = state.pending
    state.pending = ''
    if (op === 'g') {
      if (k === 'g') editor.gotoBufferHome({ select: isSelecting(state) })
      return true
    }
    if (k === op) {
      // dd / yy / cc — linewise
      if (op === 'd') deleteLine(editor, state, count)
      else if (op === 'y') yankLines(editor, state, count)
      else if (op === 'c') {
        editor.gotoLineStart()
        editor.deleteToLineEnd()
        state.mode = 'insert'
      }
      return true
    }
    if (op === 'd' || op === 'c') {
      const cut = OPERATOR_TARGETS[k]
      if (cut) {
        cut(editor, count)
        if (op === 'c') state.mode = 'insert'
      }
    }
    return true // an unknown operator target is swallowed, never passed on
  }

  // Motions run before the mode switches below so visual mode extends the selection.
  if (motion(editor, k, state, count)) return true

  if (state.mode === 'visual') {
    switch (k) {
      case 'escape':
        editor.clearSelection()
        state.mode = 'normal'
        break
      case 'd':
      case 'x':
        yankSelection(editor, state)
        editor.deleteSelection()
        state.mode = 'normal'
        break
      case 'y':
        yankSelection(editor, state)
        editor.clearSelection()
        state.mode = 'normal'
        break
      case 'c':
        yankSelection(editor, state)
        editor.deleteSelection()
        state.mode = 'insert'
        break
    }
    return true
  }

  switch (k) {
    case 'i':
      state.mode = 'insert'
      break
    case 'a':
      editor.moveCursorRight()
      state.mode = 'insert'
      break
    case 'I':
      editor.gotoLineStart()
      state.mode = 'insert'
      break
    case 'A':
      editor.gotoLineEnd()
      state.mode = 'insert'
      break
    case 'o':
      editor.gotoLineEnd()
      editor.newLine()
      state.mode = 'insert'
      break
    case 'O':
      editor.gotoLineStart()
      editor.newLine()
      editor.moveCursorUp()
      state.mode = 'insert'
      break
    case 'v':
      state.mode = 'visual'
      break
    case 'x':
      for (let i = 0; i < count; i++) editor.deleteChar()
      break
    case 'D':
      editor.deleteToLineEnd()
      break
    case 'C':
      editor.deleteToLineEnd()
      state.mode = 'insert'
      break
    case 'u':
      for (let i = 0; i < count; i++) editor.undo()
      break
    case 'p':
      paste(editor, state, false)
      break
    case 'P':
      paste(editor, state, true)
      break
    case 'd':
    case 'c':
    case 'y':
    case 'g':
      state.pending = k
      state.count = digits // the motion after the operator still needs it
      return true
    case 'escape':
      break
    default:
      return true // swallow unknown keys so they never reach the buffer
  }
  return true
}

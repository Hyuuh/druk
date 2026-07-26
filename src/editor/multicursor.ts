import type { TextareaRenderable } from '@opentui/core'

const WORD = /[A-Za-z0-9_$]/

/** Half-open `[start, end)` over the buffer text. `start === end` is a bare caret. */
export interface Range {
  start: number
  end: number
}

/** The word around `at`, or null when the cursor is not inside one. */
export function wordRangeAt(text: string, at: number): Range | null {
  // Sitting just past a word's last character still counts as being inside it.
  const inside = WORD.test(text[at] ?? '')
    ? at
    : at > 0 && WORD.test(text[at - 1] ?? '')
      ? at - 1
      : -1
  if (inside < 0) return null

  let start = inside
  let end = inside
  while (start > 0 && WORD.test(text[start - 1] ?? '')) start--
  while (end < text.length && WORD.test(text[end] ?? '')) end++
  return { start, end }
}

/** The next occurrence of `word` at or after `from`, wrapping once. */
export function nextMatch(text: string, word: string, from: number): Range | null {
  const found = text.indexOf(word, from)
  const at = found >= 0 ? found : text.indexOf(word)
  if (at < 0) return null
  return { start: at, end: at + word.length }
}

const ascending = (ranges: Range[]) => [...ranges].toSorted((a, b) => a.start - b.start)

/**
 * Replace every range with `text`, editing from the last one backwards so the
 * earlier offsets stay valid. Returns the carets left behind, in document order.
 */
export function replaceRanges(editor: TextareaRenderable, ranges: Range[], text: string): Range[] {
  const ordered = ascending(ranges)
  for (const range of [...ordered].reverse()) {
    if (range.end > range.start) {
      editor.setSelection(range.start, range.end)
      editor.deleteSelection()
    }
    editor.cursorOffset = range.start
    if (text) editor.insertText(text)
  }

  let shift = 0
  const carets: Range[] = []
  for (const range of ordered) {
    const at = range.start + shift + text.length
    carets.push({ start: at, end: at })
    shift += text.length - (range.end - range.start)
  }
  return carets
}

/**
 * Backspace at every range: a selection is deleted whole, a bare caret eats the
 * character before it.
 */
export function deleteRanges(editor: TextareaRenderable, ranges: Range[]): Range[] {
  const ordered = ascending(ranges)
  for (const range of [...ordered].reverse()) {
    if (range.end > range.start) {
      editor.setSelection(range.start, range.end)
      editor.deleteSelection()
    } else if (range.start > 0) {
      editor.cursorOffset = range.start
      editor.deleteCharBackward()
    }
  }

  let shift = 0
  const carets: Range[] = []
  for (const range of ordered) {
    const selection = range.end - range.start
    const removed = selection > 0 ? selection : range.start > 0 ? 1 : 0
    const at = range.start + shift - (selection > 0 ? 0 : removed)
    carets.push({ start: at, end: at })
    shift -= removed
  }
  return carets
}

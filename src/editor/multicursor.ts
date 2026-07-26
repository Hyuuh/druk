import type { TextareaRenderable } from '@opentui/core'

const WORD = /[A-Za-z0-9_$]/

/** The word (or existing selection) under the primary cursor. */
export function wordAtCursor(editor: TextareaRenderable): string | null {
  const selected = editor.getSelectedText()
  if (selected) return selected

  const text = editor.plainText
  const at = editor.cursorOffset
  if (!WORD.test(text[at] ?? '')) return null
  let start = at
  let end = at
  while (start > 0 && WORD.test(text[start - 1] ?? '')) start--
  while (end < text.length && WORD.test(text[end] ?? '')) end++
  return text.slice(start, end)
}

/** Offset of the next occurrence of `word` after `from`, wrapping once. */
export function nextOccurrence(text: string, word: string, from: number): number | null {
  const found = text.indexOf(word, from)
  if (found >= 0) return found
  const wrapped = text.indexOf(word)
  return wrapped >= 0 && wrapped < from ? wrapped : null
}

/**
 * Apply `edit` at every cursor. Edits run from the last offset backwards so the
 * earlier offsets stay valid, and each cursor is moved by `delta` characters.
 */
export function editAtCursors(
  editor: TextareaRenderable,
  offsets: number[],
  edit: (editor: TextareaRenderable) => void,
  delta: number,
): number[] {
  const ordered = [...new Set(offsets)].toSorted((a, b) => b - a)
  for (const offset of ordered) {
    editor.cursorOffset = offset
    edit(editor)
  }
  // Every cursor shifts by the edits made before it.
  const ascending = [...new Set(offsets)].toSorted((a, b) => a - b)
  return ascending.map((offset, index) => offset + delta * index)
}

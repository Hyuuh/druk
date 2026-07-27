import type { KeyEvent, TextareaRenderable } from '@opentui/core'

const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  "'": "'",
  '"': '"',
  '`': '`',
}
const CLOSERS = new Set(Object.values(PAIRS))

const lineAt = (editor: TextareaRenderable, row: number) => editor.plainText.split('\n')[row] ?? ''

const indentOf = (line: string) => line.slice(0, line.length - line.trimStart().length)

/**
 * Editing conveniences OpenTUI's buffer does not provide: bracket/quote pairing,
 * indentation that carries to the next line, and Tab itself — the textarea binds
 * no Tab at all and has no indent action, so without this the key does nothing.
 *
 * Returns true when the key was consumed.
 */
export function handleTyping(editor: TextareaRenderable, key: KeyEvent, tabSize: number): boolean {
  const { row, col } = editor.logicalCursor
  const line = lineAt(editor, row)
  const next = line[col] ?? ''

  if (key.name === 'tab') {
    if (key.shift) {
      // Outdent: take up to one level off the front of the line, wherever the
      // caret happens to sit, and keep the caret over the same character.
      const lead = indentOf(line).length
      const drop = Math.min(lead, tabSize)
      if (drop === 0) return true
      editor.setCursor(row, drop)
      for (let i = 0; i < drop; i++) editor.deleteCharBackward()
      editor.setCursor(row, Math.max(0, col - drop))
      return true
    }
    // Align to the next tab stop rather than always inserting a full width, so
    // Tab from column 3 with tabSize 4 lands on 4.
    editor.insertText(' '.repeat(tabSize - (col % tabSize)))
    return true
  }

  if (key.name === 'return' || key.name === 'enter') {
    const indent = indentOf(line)
    const opensBlock = /[([{]$/.test(line.slice(0, col).trimEnd())
    editor.insertText(`\n${indent}${opensBlock ? ' '.repeat(tabSize) : ''}`)
    // A closing brace right after the cursor gets its own line, one level out.
    if (opensBlock && /^[)\]}]/.test(next)) {
      const at = editor.logicalCursor
      editor.insertText(`\n${indent}`)
      editor.setCursor(at.row, at.col)
    }
    return true
  }

  const typed = key.sequence
  if (!typed || typed.length !== 1 || key.ctrl || key.meta) return false

  // Typing the closer that was auto-inserted just steps over it.
  if (CLOSERS.has(typed) && next === typed) {
    editor.setCursor(row, col + 1)
    return true
  }

  const closer = PAIRS[typed]
  if (!closer) return false
  // Only pair when the cursor is at a boundary, never mid-word.
  if (next && !/[\s)\]}>,;]/.test(next)) return false
  // Quotes are also apostrophes; skip pairing right after a word character.
  if (closer === typed && /[\w'"`]$/.test(line.slice(0, col))) return false

  editor.insertText(typed + closer)
  editor.setCursor(row, col + 1)
  return true
}

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
 * Editing conveniences OpenTUI's buffer does not provide: bracket/quote pairing
 * and indentation that carries to the next line.
 *
 * Returns true when the key was consumed.
 */
export function handleTyping(editor: TextareaRenderable, key: KeyEvent, tabSize: number): boolean {
  const { row, col } = editor.logicalCursor
  const line = lineAt(editor, row)
  const next = line[col] ?? ''

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

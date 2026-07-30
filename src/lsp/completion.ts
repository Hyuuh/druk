/**
 * Everything about completion that is pure computation: normalizing the server's
 * reply, fuzzy-filtering it against what the user typed, and turning the chosen
 * item into a new document. No Solid, no OpenTUI — `test/completion.test.ts`
 * exercises this file directly.
 */
import type { CompletionItem, CompletionList, Position } from './protocol'

export interface CompletionReply {
  items: CompletionItem[]
  /** The server wants to be asked again as the prefix grows. */
  isIncomplete: boolean
}

/** The wire result is `CompletionItem[] | CompletionList | null`; make it one shape. */
export function normalizeCompletion(result: unknown): CompletionReply | null {
  if (result == null) return null
  if (Array.isArray(result)) return { items: result as CompletionItem[], isIncomplete: false }
  const list = result as CompletionList
  if (!Array.isArray(list.items)) return null
  return { items: list.items, isIncomplete: list.isIncomplete === true }
}

/** Characters that make up the word being completed — the prefix the menu filters on. */
const WORD_CHAR = /[A-Za-z0-9_$]/

/**
 * Typing one of these asks the server for members/paths right away, prefix or
 * not. A fixed set rather than the server's advertised `triggerCharacters`:
 * the useful ones are common to every language, and quote/space triggers fire
 * in prose far too often for a popup that sits over the text.
 */
export const TRIGGER_CHARS = new Set(['.', ':', '/', '@'])

export function isWordChar(char: string): boolean {
  return WORD_CHAR.test(char)
}

/** Start column of the word ending at `col`, so `col - wordStart` is the prefix. */
export function wordStart(lineText: string, col: number): number {
  let at = col
  while (at > 0 && WORD_CHAR.test(lineText[at - 1]!)) at--
  return at
}

export interface Match {
  item: CompletionItem
  score: number
  /** Indexes into the label that matched, for highlighting. */
  positions: number[]
}

/**
 * Subsequence match of `query` in `text`, scored the editor-completion way:
 * consecutive hits and word-boundary hits (start, after `_`/`.`, camelCase hump)
 * are worth the most, exact-case a little more, and every skipped character
 * costs. Returns null when `query` is not a subsequence at all.
 */
export function fuzzyMatch(
  query: string,
  text: string,
): { score: number; positions: number[] } | null {
  if (query.length === 0) return { score: 0, positions: [] }
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const positions: number[] = []
  let score = 0
  let at = 0
  for (let q = 0; q < lowerQuery.length; q++) {
    const found = lowerText.indexOf(lowerQuery[q]!, at)
    if (found < 0) return null
    const prev = text[found - 1]
    const boundary =
      found === 0 ||
      prev === '_' ||
      prev === '.' ||
      prev === '-' ||
      (text[found]! >= 'A' && text[found]! <= 'Z' && prev! >= 'a' && prev! <= 'z')
    if (boundary) score += 8
    if (positions.length > 0 && found === positions.at(-1)! + 1) score += 6
    if (text[found] === query[q]) score += 1
    score -= found - at // skipped characters push the item down
    positions.push(found)
    at = found + 1
  }
  // Shorter candidates win ties: `map` before `mapValues` for the query "map".
  return { score: score - Math.floor(text.length / 8), positions }
}

/**
 * Filter and rank the server's items against the typed prefix. The text matched
 * is `filterText ?? label` (the spec's rule), but the positions returned are
 * label indexes — when the two differ the highlight is dropped rather than lied
 * about. Ties fall back to the server's own `sortText` ordering.
 */
export function filterCompletions(items: CompletionItem[], prefix: string): Match[] {
  const matches: Match[] = []
  for (const item of items) {
    const target = item.filterText ?? item.label
    const match = fuzzyMatch(prefix, target)
    if (!match) continue
    matches.push({
      item,
      score: match.score,
      positions: target === item.label ? match.positions : [],
    })
  }
  return matches.toSorted(
    (a, b) =>
      b.score - a.score ||
      (a.item.sortText ?? a.item.label).localeCompare(b.item.sortText ?? b.item.label) ||
      a.item.label.length - b.item.label.length,
  )
}

/**
 * Flatten snippet syntax to plain text: `${1:name}` keeps its placeholder text,
 * `$1`/`${1}` vanish, `${1|a,b|}` keeps the first choice. `caret` is where the
 * first tab stop sat, so accepting `foo(${1})` can land the cursor inside the
 * parentheses; null when the snippet named no stop.
 */
export function stripSnippet(text: string): { text: string; caret: number | null } {
  let caret: number | null = null
  let out = ''
  let at = 0
  const snippet = /\$(?:(\d+)|\{(\d+)(?::((?:[^{}]|\{[^}]*\})*))?(?:\|([^,|]*)[^}]*)?\})/g
  for (let hit = snippet.exec(text); hit; hit = snippet.exec(text)) {
    out += text.slice(at, hit.index)
    if (caret === null) caret = out.length
    out += hit[3] ?? hit[4] ?? ''
    at = hit.index + hit[0].length
  }
  out += text.slice(at)
  return { text: out, caret: caret === out.length ? null : caret }
}

/** Absolute offset of a `Position`, clamped to the document. */
function offsetOf(content: string, position: Position): number {
  let at = 0
  for (let line = 0; line < position.line; line++) {
    const next = content.indexOf('\n', at)
    if (next < 0) return content.length
    at = next + 1
  }
  const lineEnd = content.indexOf('\n', at)
  return Math.min(at + position.character, lineEnd < 0 ? content.length : lineEnd)
}

function positionOf(content: string, offset: number): Position {
  let line = 0
  let lineStart = 0
  for (let at = content.indexOf('\n'); at >= 0 && at < offset; at = content.indexOf('\n', at + 1)) {
    line++
    lineStart = at + 1
  }
  return { line, character: offset - lineStart }
}

/**
 * Apply `item` to the document: the primary edit replaces the server's range —
 * or, without one, the word from `anchorCol` to the cursor — and every
 * `additionalTextEdit` (auto-imports) lands too. All ranges address the
 * document as it was before any of them, per the spec, so the edits are applied
 * back-to-front. Returns the new text and where the cursor belongs.
 */
export function applyCompletion(
  content: string,
  cursor: Position,
  anchorCol: number,
  item: CompletionItem,
): { content: string; cursor: Position } {
  const raw = item.textEdit?.newText ?? item.insertText ?? item.label
  const { text: inserted, caret } =
    item.insertTextFormat === 2 || raw.includes('$')
      ? stripSnippet(raw)
      : { text: raw, caret: null }

  let primaryRange =
    item.textEdit && 'range' in item.textEdit
      ? item.textEdit.range
      : item.textEdit
        ? item.textEdit.replace
        : {
            start: { line: cursor.line, character: anchorCol },
            end: cursor,
          }
  // The server measured its range when the request went out; characters typed
  // during the round trip sit past its end and would survive the replacement
  // ("consolele"). The menu only stays open while the cursor extends the same
  // word, so pulling the end forward to the cursor is always the right repair.
  if (
    primaryRange.start.line === cursor.line &&
    primaryRange.end.line === cursor.line &&
    primaryRange.end.character < cursor.character
  ) {
    primaryRange = { start: primaryRange.start, end: cursor }
  }

  const edits: { start: number; end: number; text: string; primary: boolean }[] = [
    {
      start: offsetOf(content, primaryRange.start),
      end: offsetOf(content, primaryRange.end),
      text: inserted,
      primary: true,
    },
  ]
  for (const edit of item.additionalTextEdits ?? []) {
    edits.push({
      start: offsetOf(content, edit.range.start),
      end: offsetOf(content, edit.range.end),
      text: edit.newText,
      primary: false,
    })
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end)

  let next = content
  for (const edit of edits) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end)

  const primary = edits.find(edit => edit.primary)!
  let delta = 0
  for (const edit of edits) {
    if (!edit.primary && edit.end <= primary.start)
      delta += edit.text.length - (edit.end - edit.start)
  }
  const cursorOffset = primary.start + delta + (caret ?? inserted.length)
  return { content: next, cursor: positionOf(next, cursorOffset) }
}

/** How the menu draws a kind: one glyph, and a palette group the UI maps to a color. */
export type KindGroup = 'fn' | 'var' | 'type' | 'module' | 'keyword' | 'text'

const KIND_GROUPS: Record<number, { glyph: string; group: KindGroup }> = {
  1: { glyph: '·', group: 'text' }, // Text
  2: { glyph: 'ƒ', group: 'fn' }, // Method
  3: { glyph: 'ƒ', group: 'fn' }, // Function
  4: { glyph: 'ƒ', group: 'fn' }, // Constructor
  5: { glyph: '◦', group: 'var' }, // Field
  6: { glyph: 'ν', group: 'var' }, // Variable
  7: { glyph: '◆', group: 'type' }, // Class
  8: { glyph: '◇', group: 'type' }, // Interface
  9: { glyph: '⧉', group: 'module' }, // Module
  10: { glyph: '◦', group: 'var' }, // Property
  11: { glyph: '#', group: 'var' }, // Unit
  12: { glyph: 'π', group: 'var' }, // Value
  13: { glyph: 'Σ', group: 'type' }, // Enum
  14: { glyph: 'κ', group: 'keyword' }, // Keyword
  15: { glyph: '⌗', group: 'text' }, // Snippet
  16: { glyph: '□', group: 'var' }, // Color
  17: { glyph: '⧉', group: 'module' }, // File
  18: { glyph: '→', group: 'module' }, // Reference
  19: { glyph: '⧉', group: 'module' }, // Folder
  20: { glyph: 'Σ', group: 'var' }, // EnumMember
  21: { glyph: 'π', group: 'var' }, // Constant
  22: { glyph: '◆', group: 'type' }, // Struct
  23: { glyph: '⚡︎', group: 'fn' }, // Event
  24: { glyph: '±', group: 'fn' }, // Operator
  25: { glyph: 'τ', group: 'type' }, // TypeParameter
}

export function kindInfo(kind: number | undefined): { glyph: string; group: KindGroup } {
  return KIND_GROUPS[kind ?? 1] ?? { glyph: '·', group: 'text' }
}

/** `label` cut into runs for the menu: matched runs draw in the accent color. */
export function matchRuns(label: string, positions: number[]): { text: string; hit: boolean }[] {
  if (positions.length === 0) return [{ text: label, hit: false }]
  const runs: { text: string; hit: boolean }[] = []
  const hits = new Set(positions)
  let start = 0
  for (let at = 1; at <= label.length; at++) {
    if (at === label.length || hits.has(at) !== hits.has(start)) {
      runs.push({ text: label.slice(start, at), hit: hits.has(start) })
      start = at
    }
  }
  return runs
}

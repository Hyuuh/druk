import '../core/assets'
import { getTreeSitterClient, pathToFiletype, SyntaxStyle } from '@opentui/core'
import type { TreeSitterClient } from '@opentui/core'

import { syntaxTheme, ui } from '../themes'
import { languageFor, VENDORED_LANGUAGES } from './index'
import type { Language } from './index'

/** Two dots so it outranks any syntax capture on the same whitespace. */
const INDENT_GUIDE = 'indent.guide'

let clientDead = false
let initPromise: Promise<TreeSitterClient | null> | null = null
let syntaxStyle: SyntaxStyle | null = null

function registerVendoredParsers(client: TreeSitterClient): void {
  for (const lang of VENDORED_LANGUAGES) {
    try {
      client.addFiletypeParser({
        filetype: lang.id,
        wasm: lang.wasm!,
        queries: { highlights: [lang.query!] },
      })
    } catch {
      // best-effort: the language just stays unhighlighted
    }
  }
}

/** Shared style table used by every editor buffer (built from the active theme). */
export function getSyntaxStyle(): SyntaxStyle {
  if (!syntaxStyle) {
    syntaxStyle = SyntaxStyle.fromStyles({
      ...syntaxTheme,
      [INDENT_GUIDE]: { bg: ui.indentGuide },
    })
  }
  return syntaxStyle
}

export function invalidateSyntaxStyle(): void {
  syntaxStyle = null
}

/**
 * `.env`, `.env.local`, `.env.production.sample`, `staging.env` — OpenTUI maps
 * none of them, and the extension is not where the name is.
 */
const DOTENV = /^\.env(?:\.[\w.-]+)?$|\.env$/

/**
 * Files whose name says what they are while their extension does not. `bun.lock`
 * is JSON with comments and trailing commas; the json grammar reads it happily
 * enough to be worth far more than no colour at all.
 */
const BY_NAME: Record<string, string> = {
  'bun.lock': 'json',
}

/** Map a file path to a tree-sitter filetype ("foo.ts" -> "typescript"), if known. */
export function filetypeForPath(path: string): string | undefined {
  // Both separators: druk ships for Windows, where nothing after the last `/`
  // is the file name.
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  if (BY_NAME[name]) return BY_NAME[name]
  if (DOTENV.test(name)) return 'dotenv'
  return pathToFiletype(path) ?? undefined
}

async function ensureClient(): Promise<TreeSitterClient | null> {
  if (clientDead) return null
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const c = getTreeSitterClient()
        await c.initialize()
        registerVendoredParsers(c)
        return c
      } catch {
        clientDead = true // highlighting is best-effort; editor still works
        return null
      }
    })()
  }
  return initPromise
}

/**
 * Resolve a capture group to a style id, walking from the most specific scope
 * ("type.builtin") to the least ("type").
 */
export function styleIdForGroup(group: string): number | null {
  const ss = getSyntaxStyle()
  let g = group
  while (g.length > 0) {
    const id = ss.getStyleId(g)
    if (id != null) return id
    const dot = g.lastIndexOf('.')
    if (dot < 0) break
    g = g.slice(0, dot)
  }
  return null
}

export interface Segment {
  /** Column within the line, not an offset into the document. */
  start: number
  end: number
  styleId: number
  /** 0-based line. Highlights are stored per line so scrolling can be incremental. */
  line: number
}

/** More dots = more specific scope: "type.builtin" (2) beats "type" (1). */
function specificity(group: string): number {
  return group.split('.').length
}

function lineStarts(content: string): number[] {
  const starts = [0]
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

type RawHighlight = readonly [number, number, string]

/** One tinted column at every indent stop inside a line's leading whitespace. */
function indentGuides(content: string, tabSize: number): RawHighlight[] {
  const guides: RawHighlight[] = []
  let offset = 0
  for (const line of content.split('\n')) {
    const indent = line.length - line.trimStart().length
    for (let column = 0; column < indent; column += tabSize) {
      guides.push([offset + column, offset + column + 1, INDENT_GUIDE])
    }
    offset += line.length + 1
  }
  return guides
}

function highlightWithPatterns(content: string, patterns: NonNullable<Language['patterns']>) {
  const out: RawHighlight[] = []
  for (const { group, re } of patterns) {
    for (const match of content.matchAll(re)) {
      if (match.index !== undefined) out.push([match.index, match.index + match[0].length, group])
    }
  }
  return out
}

/** Answered instead of segments when `isStale` says the text moved on. */
export const STALE = Symbol('stale')

interface Capture {
  start: number
  end: number
  group: string
}

/**
 * A parsed document, prepared for windowed segmentation. Neither field is derived
 * per window: both `lineStarts` (O(characters)) and the sort (O(captures log n))
 * used to run on every call, which put a floor of ~2ms under segmenting a *single*
 * line of a 20 000-line file — more than painting the whole viewport costs.
 */
export interface Highlighted {
  content: string
  /** Offset each line starts at, so a line range maps to a slice of the text. */
  starts: number[]
  /**
   * Captures least-specific-first, so the most specific one wins each character.
   * `toSorted` is stable, which is what leaves equal-specificity captures in the
   * order tree-sitter reported them — the tie-break the painter relies on.
   */
  ordered: Capture[]
}

function prepare(
  content: string,
  raw: ReadonlyArray<readonly [number, number, string, ...unknown[]]>,
): Highlighted {
  const ordered = raw
    .map(([start, end, group]) => ({ start, end, group }))
    .filter(h => h.end > h.start)
    .toSorted((a, b) => specificity(a.group) - specificity(b.group))
  return { content, starts: lineStarts(content), ordered }
}

export async function computeHighlights(
  content: string,
  filetype: string | undefined,
  tabSize = 2,
  isStale?: () => boolean,
): Promise<Highlighted | typeof STALE> {
  const guides = indentGuides(content, tabSize)
  const patterns = filetype ? languageFor(filetype)?.patterns : undefined
  if (patterns) {
    return prepare(content, [...highlightWithPatterns(content, patterns), ...guides])
  }

  const client = filetype ? await ensureClient() : null
  if (!client) return prepare(content, guides)
  try {
    const res = await client.highlightOnce(content, filetype!)
    if (isStale?.()) return STALE
    return prepare(content, [...(res.highlights ?? []), ...guides])
  } catch {
    return prepare(content, guides)
  }
}

/**
 * Non-overlapping segments for lines `from`..`to` (inclusive) of a parsed document.
 *
 * Two steps:
 *   1. Paint each capture's style onto a per-character array. The captures arrive
 *      least specific first, so the most specific one wins each character — the
 *      same rule OpenTUI's own renderer uses.
 *   2. Merge runs of equal style into segments.
 *
 * Coordinates are per line: the buffer stores highlights against a line index,
 * which lets the editor add and drop them a line at a time while scrolling. Both
 * steps are O(characters in the range), which is why only the viewport is done.
 */
export function segmentsIn(parsed: Highlighted, from: number, to: number): Segment[] {
  const { content, starts, ordered } = parsed
  const first = Math.max(0, Math.min(from, starts.length - 1))
  const last = Math.max(first, Math.min(to, starts.length - 1))
  const sliceStart = starts[first]!
  const sliceEnd = last + 1 < starts.length ? starts[last + 1]! - 1 : content.length

  const styleAt = new Int32Array(Math.max(0, sliceEnd - sliceStart)).fill(-1)
  for (const h of ordered) {
    // Skipped before resolving the group: the style lookup is the expensive part,
    // and most of a file's captures are outside any one window.
    if (h.end <= sliceStart || h.start >= sliceEnd) continue
    const styleId = styleIdForGroup(h.group)
    if (styleId == null) continue
    const start = Math.max(h.start, sliceStart)
    const end = Math.min(h.end, sliceEnd)
    for (let i = start; i < end; i++) styleAt[i - sliceStart] = styleId
  }

  const segments: Segment[] = []
  let column = 0
  let line = first
  let run: Segment | null = null
  for (let i = sliceStart; i < sliceEnd; i++) {
    if (content.charCodeAt(i) === 10) {
      run = null // a segment never spans a line break
      line++
      column = 0
      continue
    }
    const styleId = styleAt[i - sliceStart]!
    if (styleId < 0) {
      run = null
    } else if (run && run.styleId === styleId) {
      run.end = column + 1
    } else {
      run = { start: column, end: column + 1, styleId, line }
      segments.push(run)
    }
    column++
  }
  return segments
}

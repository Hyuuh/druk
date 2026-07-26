import '../core/assets'
import { fileURLToPath } from 'node:url'

import { getTreeSitterClient, pathToFiletype, SyntaxStyle } from '@opentui/core'
import type { TreeSitterClient } from '@opentui/core'

import { syntaxTheme, ui } from '../themes'
import { languageFor, VENDORED_LANGUAGES } from './index'
import type { Language } from './index'

/** Two dots so it outranks any syntax capture on the same whitespace. */
const INDENT_GUIDE = 'indent.guide'

/** Extra multi-cursor carets, drawn as inverted cells. */
export const CURSOR_MARK = 'druk.cursor'

let clientDead = false
let initPromise: Promise<TreeSitterClient | null> | null = null
let syntaxStyle: SyntaxStyle | null = null

/** Register the grammars we vendor ourselves (see ./index.ts for the list). */
function registerVendoredParsers(client: TreeSitterClient): void {
  for (const lang of VENDORED_LANGUAGES) {
    try {
      client.addFiletypeParser({
        filetype: lang.id,
        wasm: fileURLToPath(import.meta.resolve(lang.wasm!)),
        queries: {
          highlights: [fileURLToPath(new URL(`./queries/${lang.query}`, import.meta.url))],
        },
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
      [CURSOR_MARK]: { bg: ui.cursor, fg: ui.bg },
    })
  }
  return syntaxStyle
}

/** Drop the cached style table so the next getSyntaxStyle() rebuilds it (theme switch). */
export function invalidateSyntaxStyle(): void {
  syntaxStyle = null
}

/** Map a file path to a tree-sitter filetype ("foo.ts" -> "typescript"), if known. */
export function filetypeForPath(path: string): string | undefined {
  return pathToFiletype(path) ?? undefined
}

/** Lazily start the tree-sitter worker. Returns null if it can't be initialized. */
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

/**
 * Turn tree-sitter's overlapping captures into flat, non-overlapping segments.
 *
 * Two steps:
 *   1. Paint each capture's style onto a per-character array. Painting the least
 *      specific captures first means the most specific one wins each character —
 *      the same rule OpenTUI's own renderer uses.
 *   2. Merge runs of equal style into segments.
 *
 * Coordinates are per line: the buffer stores highlights against a line index,
 * which lets the editor add and drop them a line at a time while scrolling.
 */
function segmentsFromHighlights(
  content: string,
  highlights: ReadonlyArray<readonly [number, number, string, ...unknown[]]>,
): Segment[] {
  const styleAt = new Int32Array(content.length).fill(-1)
  const ordered = highlights
    .map(([start, end, group], index) => ({ start, end, group, index }))
    .filter(h => h.end > h.start)
    .toSorted((a, b) => specificity(a.group) - specificity(b.group) || a.index - b.index)

  for (const h of ordered) {
    const styleId = styleIdForGroup(h.group)
    if (styleId == null) continue
    for (let i = h.start; i < h.end; i++) styleAt[i] = styleId
  }

  const segments: Segment[] = []
  let column = 0
  let line = 0
  let run: Segment | null = null
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      run = null // a segment never spans a line break
      line++
      column = 0
      continue
    }
    const styleId = styleAt[i]!
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

/** Compute non-overlapping highlight segments for `content`. Null when unavailable. */
export async function computeSegments(
  content: string,
  filetype: string | undefined,
  tabSize = 2,
): Promise<Segment[] | null> {
  const guides = indentGuides(content, tabSize)
  const patterns = filetype ? languageFor(filetype)?.patterns : undefined
  if (patterns) {
    return segmentsFromHighlights(content, [...highlightWithPatterns(content, patterns), ...guides])
  }

  const client = filetype ? await ensureClient() : null
  if (!client) return segmentsFromHighlights(content, guides)
  try {
    const res = await client.highlightOnce(content, filetype!)
    return segmentsFromHighlights(content, [...(res.highlights ?? []), ...guides])
  } catch {
    return segmentsFromHighlights(content, guides)
  }
}

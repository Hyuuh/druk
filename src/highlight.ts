import './assets'
import { fileURLToPath } from 'node:url'

import { getTreeSitterClient, pathToFiletype, SyntaxStyle } from '@opentui/core'
import type { TreeSitterClient } from '@opentui/core'

import { syntaxTheme } from './theme'

let clientDead = false
let initPromise: Promise<TreeSitterClient | null> | null = null
let syntaxStyle: SyntaxStyle | null = null

// JavaScript, TypeScript, Markdown and Zig grammars ship with OpenTUI. These do
// not, so register vendored grammars (tree-sitter-wasms) + queries (./grammars).
const EXTRA_GRAMMARS = [
  { filetype: 'json', wasm: 'tree-sitter-wasms/out/tree-sitter-json.wasm', query: 'json.scm' },
  { filetype: 'html', wasm: 'tree-sitter-wasms/out/tree-sitter-html.wasm', query: 'html.scm' },
]

function registerExtraParsers(client: TreeSitterClient): void {
  for (const g of EXTRA_GRAMMARS) {
    try {
      client.addFiletypeParser({
        filetype: g.filetype,
        wasm: fileURLToPath(import.meta.resolve(g.wasm)),
        queries: { highlights: [fileURLToPath(new URL(`./grammars/${g.query}`, import.meta.url))] },
      })
    } catch {
      // best-effort: the language just stays unhighlighted
    }
  }
}

/** Shared style table used by every editor buffer (built from the active theme). */
export function getSyntaxStyle(): SyntaxStyle {
  if (!syntaxStyle) syntaxStyle = SyntaxStyle.fromStyles(syntaxTheme)
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
        registerExtraParsers(c)
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
  start: number
  end: number
  styleId: number
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
 * Columns skip newlines because the edit buffer's `addHighlightByCharRange`
 * indexes text with "\n" removed (OpenTUI's `offsetExcludingNewlines`); without
 * this every line's highlights would drift right by the number of lines above.
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
  let run: Segment | null = null
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      run = null // a segment never spans a line break
      continue
    }
    const styleId = styleAt[i]!
    if (styleId < 0) {
      run = null
    } else if (run && run.styleId === styleId) {
      run.end = column + 1
    } else {
      run = { start: column, end: column + 1, styleId }
      segments.push(run)
    }
    column++
  }
  return segments
}

/** Compute non-overlapping highlight segments for `content`. Null when unavailable. */
export async function computeSegments(
  content: string,
  filetype: string | undefined,
): Promise<Segment[] | null> {
  if (!filetype) return null
  const c = await ensureClient()
  if (!c) return null
  try {
    const res = await c.highlightOnce(content, filetype)
    if (!res.highlights) return null
    return segmentsFromHighlights(content, res.highlights)
  } catch {
    return null
  }
}

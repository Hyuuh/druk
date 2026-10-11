import type { ComparisonFileStatus, FileStatus } from '../core/git'
import type { Highlighted } from '../languages/highlight'
import { DIFF_FILLER } from '../languages/highlight'
import { MARKS, statusColor } from './FileTree'

export type DiffMode = 'inline' | 'split'
export type DiffFileStatus = FileStatus | ComparisonFileStatus

// Bytes across both sides: one native span edit per capture stalls on a package-lock (#66).
export const DIFF_HIGHLIGHT_LIMIT = 1024 * 1024

export const DIFF_HIGHLIGHT_MAX_LINES = 1000

export const DIFF_MAX_LINES = 10_000

export const HATCH = '╱'

export function diffMark(status: DiffFileStatus): string {
  if (status === 'renamed') {
    return 'R'
  }
  if (status === 'copied') {
    return 'C'
  }
  if (status === 'typeChanged') {
    return 'T'
  }
  return MARKS[status]
}

export function diffStatusLabel(status: DiffFileStatus): string | undefined {
  switch (status) {
    case 'added':
    case 'untracked': {
      return 'new'
    }
    case 'deleted':
    case 'renamed':
    case 'copied': {
      return status
    }
    case 'typeChanged': {
      return 'type'
    }
    default: {
      return undefined
    }
  }
}

export function diffStatusColor(status: DiffFileStatus): string {
  if (
    status === 'added' ||
    status === 'untracked' ||
    status === 'deleted' ||
    status === 'modified'
  ) {
    return statusColor(status)
  }
  return statusColor('modified')
}

export function blend(color: string, base: string, amount: number): string {
  const rgb = (hex: string): number[] | null =>
    /^#[0-9a-f]{6}$/iu.test(hex)
      ? [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
      : null
  const from = rgb(color)
  const to = rgb(base)
  if (!from || !to) {
    return base
  }
  const mix = (i: number) =>
    Math.round(from[i]! * amount + to[i]! * (1 - amount))
      .toString(16)
      .padStart(2, '0')
  return `#${mix(0)}${mix(1)}${mix(2)}`
}

export function isPlainDiff(
  oldText: string,
  newText: string,
  lines: number
): boolean {
  return (
    oldText.length + newText.length > DIFF_HIGHLIGHT_LIMIT ||
    lines > DIFF_HIGHLIGHT_MAX_LINES
  )
}

/** The new-side line a reader landing in this file wants: the first one that differs. */
export function firstChangedLine(oldText: string, newText: string): number {
  const old = oldText.split('\n')
  const now = newText.split('\n')
  let at = 0
  while (at < old.length && at < now.length && old[at] === now[at]) {
    at += 1
  }
  return Math.min(at, Math.max(0, now.length - 1))
}

export interface LineRef {
  side: 'old' | 'new'
  line: number
}

export type PaneView = 'unified' | 'split'

// Replays how the `<diff>` renderable assembles its panes; a null is split's padding row.
export function paneLines(
  patch: string,
  view: PaneView
): { left: (LineRef | null)[]; right: (LineRef | null)[] } {
  const left: (LineRef | null)[] = []
  const right: (LineRef | null)[] = []
  const lines = patch.split('\n')
  let at = 0
  while (at < lines.length) {
    const header = /^@@ -(\d+),\d+ \+(\d+),\d+ @@/u.exec(lines[at]!)
    at += 1
    if (!header) {
      continue
    }
    let oldLine = Math.max(0, Number(header[1]) - 1)
    let newLine = Math.max(0, Number(header[2]) - 1)
    while (at < lines.length && !lines[at]!.startsWith('@@')) {
      const [mark] = lines[at]!
      if (mark === ' ') {
        if (view === 'split') {
          left.push({ line: oldLine, side: 'old' })
          right.push({ line: newLine, side: 'new' })
        } else {
          left.push({ line: newLine, side: 'new' })
        }
        oldLine += 1
        newLine += 1
        at += 1
      } else if (mark === '-' || mark === '+') {
        const dels: LineRef[] = []
        const adds: LineRef[] = []
        while (
          at < lines.length &&
          (lines[at]![0] === '-' || lines[at]![0] === '+')
        ) {
          if (lines[at]![0] === '-') {
            dels.push({ line: oldLine, side: 'old' })
            oldLine += 1
          } else {
            adds.push({ line: newLine, side: 'new' })
            newLine += 1
          }
          at += 1
        }
        if (view === 'split') {
          for (let i = 0; i < Math.max(dels.length, adds.length); i += 1) {
            left.push(dels[i] ?? null)
            right.push(adds[i] ?? null)
          }
        } else {
          left.push(...dels, ...adds)
        }
      } else {
        // `\ No newline at end of file`: the renderable draws no row for it, so it takes no slot.
        at += 1
      }
    }
  }
  return { left, right }
}

// `[startOffset, endOffset, captureGroup]` in the pane document's coordinates.
export type PaneHighlight = [number, number, string]

interface Capture {
  start: number
  end: number
  group: string
  ord: number
}

// Fragment parses lose captures to error recovery: whole documents are highlighted and remapped.
export function paneHighlights(
  refs: (LineRef | null)[],
  content: string,
  docs: { old: Highlighted | null; new: Highlighted | null }
): PaneHighlight[] {
  const starts = [0]
  for (let i = 0; i < content.length; i += 1) {
    if (content.codePointAt(i) === 10) {
      starts.push(i + 1)
    }
  }
  const bySource = {
    new: new Map<number, number[]>(),
    old: new Map<number, number[]>(),
  }
  const out: PaneHighlight[] = []
  for (const [row, ref] of refs.entries()) {
    if (ref) {
      const rows = bySource[ref.side].get(ref.line)
      if (rows) {
        rows.push(row)
      } else {
        bySource[ref.side].set(ref.line, [row])
      }
      continue
    }
    const from = starts[row]
    if (from === undefined) {
      continue
    }
    const to = row + 1 < starts.length ? starts[row + 1]! - 1 : content.length
    if (to > from) {
      out.push([from, to, DIFF_FILLER])
    }
  }

  const paint = (
    capture: Capture,
    lineStart: number,
    lineEnd: number,
    rows: number[]
  ) => {
    // Guides carry a background fill that would stamp over the diff's.
    if (capture.group === 'indent.guide') {
      return
    }
    const from = Math.max(capture.start, lineStart)
    const to = Math.min(capture.end, lineEnd)
    if (to <= from) {
      return
    }
    for (const row of rows) {
      const base = starts[row]
      if (base !== undefined) {
        out.push([
          base + (from - lineStart),
          base + (to - lineStart),
          capture.group,
        ])
      }
    }
  }

  // Per-line buckets: a small change in a big file is a few rows against 10^5 captures.
  for (const side of ['old', 'new'] as const) {
    const doc = docs[side]
    if (!doc) {
      continue
    }
    for (const [line, rows] of bySource[side]) {
      if (line >= doc.starts.length) {
        continue
      }
      const lineStart = doc.starts[line]!
      const lineEnd =
        line + 1 < doc.starts.length
          ? doc.starts[line + 1]! - 1
          : doc.content.length
      const bucket = doc.byLine[line] ?? []
      const wides = doc.wide.filter(
        (wide) => wide.start < lineEnd && wide.end > lineStart
      )
      // Both lists are in painter's order; merging keeps a wide capture under the narrow ones.
      let b = 0
      let w = 0
      while (b < bucket.length || w < wides.length) {
        const takeWide =
          b >= bucket.length ||
          (w < wides.length && wides[w]!.ord < bucket[b]!.ord)
        const next = takeWide ? wides[w]! : bucket[b]!
        if (takeWide) {
          w += 1
        } else {
          b += 1
        }
        paint(next, lineStart, lineEnd, rows)
      }
    }
  }
  return out
}

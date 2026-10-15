import { editScript } from './diff'

export type LineKind = 'same' | 'del' | 'add'

// Line indexes are 0-based into the side's lines; null where the line has no such side.
export interface HunkLine {
  kind: LineKind
  old: number | null
  new: number | null
}

// End-exclusive, 0-based.
export interface Hunk {
  oldStart: number
  oldEnd: number
  newStart: number
  newEnd: number
  lines: HunkLine[]
}

export type Range = readonly [number, number]

export interface Gap {
  oldStart: number
  newStart: number
  count: number
}

export interface LineRow {
  kind: 'line'
  type: LineKind
  side: 'old' | 'new'
  line: number
  moved: boolean
  // Character ranges of the line that differ from the line it was paired with.
  words: readonly Range[]
  hunk: number
}

export interface GapRow {
  kind: 'gap'
  gap: number
  count: number
  scope: string | null
}

export interface PadRow {
  kind: 'pad'
  hunk: number
}

export type PaneRow = LineRow | GapRow | PadRow

export interface DiffLayout {
  left: PaneRow[]
  right: PaneRow[] | null
  // Indexed as `GapRow.gap`: one before each hunk, then the trailing one.
  gaps: (Gap | null)[]
  // Per hunk: the row a hunk walk lands on — its gap's row while that is folded.
  hunkRows: number[]
}

export function splitLines(text: string): string[] {
  if (text.length === 0) {
    return []
  }
  const lines = text.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u

// An empty side's header names the line *before* it, so its start is not shifted.
const startOf = (line: string, count: string | undefined) => {
  const at = Number(line)
  return count === '0' ? at : Math.max(0, at - 1)
}

export function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = []
  let current: Hunk | null = null
  for (const row of patch.split('\n')) {
    const header = HEADER.exec(row)
    if (header) {
      const oldStart = startOf(header[1]!, header[2])
      const newStart = startOf(header[3]!, header[4])
      current = {
        lines: [],
        newEnd: newStart,
        newStart,
        oldEnd: oldStart,
        oldStart,
      }
      hunks.push(current)
      continue
    }
    if (!current) {
      continue
    }
    const [mark] = row
    if (mark === ' ') {
      current.lines.push({
        kind: 'same',
        new: current.newEnd,
        old: current.oldEnd,
      })
      current.oldEnd += 1
      current.newEnd += 1
    } else if (mark === '-') {
      current.lines.push({ kind: 'del', new: null, old: current.oldEnd })
      current.oldEnd += 1
    } else if (mark === '+') {
      current.lines.push({ kind: 'add', new: current.newEnd, old: null })
      current.newEnd += 1
    }
  }
  return hunks
}

// Unchanged stretches between hunks; a trailing one only for a patch that covers the file.
export function diffGaps(
  hunks: readonly Hunk[],
  oldCount: number,
  newCount: number,
  complete: boolean
): (Gap | null)[] {
  const out: (Gap | null)[] = []
  let oldEnd = 0
  let newEnd = 0
  for (const hunk of hunks) {
    const count = Math.min(hunk.oldStart - oldEnd, hunk.newStart - newEnd)
    out.push(count > 0 ? { count, newStart: newEnd, oldStart: oldEnd } : null)
    ;({ oldEnd, newEnd } = hunk)
  }
  const rest = newCount - newEnd
  out.push(
    complete && hunks.length > 0 && rest > 0 && rest === oldCount - oldEnd
      ? { count: rest, newStart: newEnd, oldStart: oldEnd }
      : null
  )
  return out
}

const indentOf = (line: string) => line.length - line.trimStart().length

const NOT_A_SCOPE = /^\s*(?:[)\]}]|\/\/|\/\*|\*|#|--|$)/u

const SCOPE_SCAN = 4000

// Indentation, not a grammar: the fold rule, so it holds for every language druk paints.
export function enclosingScope(
  lines: readonly string[],
  at: number
): string | null {
  let base = -1
  for (let i = at; i < Math.min(lines.length, at + 8); i += 1) {
    if (lines[i]!.trim() !== '') {
      base = indentOf(lines[i]!)
      break
    }
  }
  if (base <= 0) {
    return null
  }
  for (let i = at - 1; i >= Math.max(0, at - SCOPE_SCAN); i -= 1) {
    const line = lines[i]!
    if (NOT_A_SCOPE.test(line) || indentOf(line) >= base) {
      continue
    }
    return line.trim()
  }
  return null
}

const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu

const WORD_DIFF_MAX = 1000

// Below this share of shared text the lines are unrelated and the row tint already says so.
const WORD_DIFF_SIMILARITY = 0.35

const solid = (text: string) => text.replaceAll(/\s+/gu, '').length

function changedRanges(
  tokens: readonly string[],
  changed: readonly boolean[]
): Range[] {
  const out: [number, number][] = []
  let at = 0
  let pendingSpace: [number, number] | null = null
  for (const [i, token] of tokens.entries()) {
    const end = at + token.length
    if (changed[i]) {
      const last = out.at(-1)
      if (last && (last[1] === at || pendingSpace?.[0] === last[1])) {
        last[1] = end
      } else {
        out.push([at, end])
      }
      pendingSpace = null
    } else if (/^\s+$/u.test(token) && out.at(-1)?.[1] === at) {
      pendingSpace = [at, end]
    } else {
      pendingSpace = null
    }
    at = end
  }
  return out
}

export function wordRanges(
  a: string,
  b: string
): { old: Range[]; new: Range[] } | null {
  if (a.length > WORD_DIFF_MAX || b.length > WORD_DIFF_MAX || a === b) {
    return null
  }
  const left = a.match(TOKEN) ?? []
  const right = b.match(TOKEN) ?? []
  const edits = editScript(left, right)
  if (!edits) {
    return null
  }
  const leftChanged = left.map(() => true)
  const rightChanged = right.map(() => true)
  let shared = 0
  for (const edit of edits) {
    if (edit.kind === 'same') {
      leftChanged[edit.oldIndex] = false
      rightChanged[edit.newIndex] = false
      shared += solid(left[edit.oldIndex]!)
    }
  }
  const total = Math.max(solid(a), solid(b))
  if (total === 0 || shared / total < WORD_DIFF_SIMILARITY) {
    return null
  }
  return {
    new: changedRanges(right, rightChanged),
    old: changedRanges(left, leftChanged),
  }
}

interface Run {
  side: 'old' | 'new'
  lines: number[]
}

function runsOf(hunks: readonly Hunk[], kind: 'del' | 'add'): Run[] {
  const runs: Run[] = []
  for (const hunk of hunks) {
    let run: number[] | null = null
    for (const line of hunk.lines) {
      if (line.kind !== kind) {
        run = null
        continue
      }
      const at = kind === 'del' ? line.old! : line.new!
      if (run) {
        run.push(at)
      } else {
        run = [at]
        runs.push({ lines: run, side: kind === 'del' ? 'old' : 'new' })
      }
    }
  }
  return runs
}

// git's `--color-moved=zebra` threshold: a block needs this much alphanumeric text to count.
const MOVED_MIN_ALNUM = 20

const MOVED_CANDIDATES = 8

const alnum = (text: string) => text.replaceAll(/[^\p{L}\p{N}]/gu, '').length

export function movedLines(
  hunks: readonly Hunk[],
  oldLines: readonly string[],
  newLines: readonly string[]
): { old: Set<number>; new: Set<number> } {
  const moved = { new: new Set<number>(), old: new Set<number>() }
  const adds = runsOf(hunks, 'add')
  const index = new Map<string, { run: number; at: number }[]>()
  for (const [run, { lines }] of adds.entries()) {
    for (const [at, line] of lines.entries()) {
      const text = newLines[line]!
      if (text.trim() === '') {
        continue
      }
      const list = index.get(text)
      if (!list) {
        index.set(text, [{ at, run }])
      } else if (list.length < MOVED_CANDIDATES) {
        list.push({ at, run })
      }
    }
  }
  for (const { lines } of runsOf(hunks, 'del')) {
    let i = 0
    while (i < lines.length) {
      let best = { at: 0, length: 0, run: -1 }
      for (const candidate of index.get(oldLines[lines[i]!]!) ?? []) {
        const target = adds[candidate.run]!.lines
        let length = 0
        while (
          i + length < lines.length &&
          candidate.at + length < target.length &&
          oldLines[lines[i + length]!] ===
            newLines[target[candidate.at + length]!]
        ) {
          length += 1
        }
        if (length > best.length) {
          best = { at: candidate.at, length, run: candidate.run }
        }
      }
      let weight = 0
      for (let k = 0; k < best.length; k += 1) {
        weight += alnum(oldLines[lines[i + k]!]!)
      }
      if (best.length === 0 || weight < MOVED_MIN_ALNUM) {
        i += 1
        continue
      }
      const target = adds[best.run]!.lines
      for (let k = 0; k < best.length; k += 1) {
        moved.old.add(lines[i + k]!)
        moved.new.add(target[best.at + k]!)
      }
      i += best.length
    }
  }
  return moved
}

export interface LayoutInput {
  oldLines: readonly string[]
  newLines: readonly string[]
  hunks: readonly Hunk[]
  view: 'unified' | 'split'
  // Gap indexes the reader opened.
  expanded: ReadonlySet<number>
  // False for a patch cut short: what follows its last hunk is not known to be unchanged.
  complete: boolean
}

interface Block {
  dels: HunkLine[]
  adds: HunkLine[]
}

const NO_WORDS: readonly Range[] = []

export function layoutDiff(input: LayoutInput): DiffLayout {
  const { oldLines, newLines, hunks, view, expanded } = input
  const gaps = diffGaps(hunks, oldLines.length, newLines.length, input.complete)
  const moved = movedLines(hunks, oldLines, newLines)
  const left: PaneRow[] = []
  const right: PaneRow[] | null = view === 'split' ? [] : null
  const hunkRows: number[] = []

  const lineRow = (
    type: LineKind,
    side: 'old' | 'new',
    line: number,
    hunk: number,
    words: readonly Range[] = NO_WORDS
  ): LineRow => ({
    hunk,
    kind: 'line',
    line,
    moved: type !== 'same' && moved[side].has(line),
    side,
    type,
    words,
  })

  const context = (oldLine: number, newLine: number, hunk: number) => {
    if (right) {
      left.push(lineRow('same', 'old', oldLine, hunk))
      right.push(lineRow('same', 'new', newLine, hunk))
    } else {
      left.push(lineRow('same', 'new', newLine, hunk))
    }
  }

  const gapRows = (at: number, hunk: number) => {
    const gap = gaps[at]
    if (!gap) {
      return
    }
    if (expanded.has(at)) {
      for (let k = 0; k < gap.count; k += 1) {
        context(gap.oldStart + k, gap.newStart + k, hunk)
      }
      return
    }
    const next = hunks[at]
    const scope = next
      ? enclosingScope(newLines, firstChange(next) ?? next.newStart)
      : null
    const row: GapRow = { count: gap.count, gap: at, kind: 'gap', scope }
    left.push(row)
    right?.push(row)
  }

  const flush = (block: Block, hunk: number) => {
    const pairs = Math.min(block.dels.length, block.adds.length)
    const words = new Map<HunkLine, readonly Range[]>()
    for (let i = 0; i < pairs; i += 1) {
      const del = block.dels[i]!
      const add = block.adds[i]!
      const ranges = wordRanges(oldLines[del.old!]!, newLines[add.new!]!)
      if (ranges) {
        words.set(del, ranges.old)
        words.set(add, ranges.new)
      }
    }
    const del = (line: HunkLine) =>
      lineRow('del', 'old', line.old!, hunk, words.get(line))
    const add = (line: HunkLine) =>
      lineRow('add', 'new', line.new!, hunk, words.get(line))
    if (right) {
      const rows = Math.max(block.dels.length, block.adds.length)
      for (let i = 0; i < rows; i += 1) {
        const d = block.dels[i]
        const a = block.adds[i]
        left.push(d ? del(d) : { hunk, kind: 'pad' })
        right.push(a ? add(a) : { hunk, kind: 'pad' })
      }
    } else {
      left.push(...block.dels.map(del), ...block.adds.map(add))
    }
    block.dels = []
    block.adds = []
  }

  for (const [at, hunk] of hunks.entries()) {
    const start = left.length
    gapRows(at, at)
    hunkRows.push(start)
    const block: Block = { adds: [], dels: [] }
    for (const line of hunk.lines) {
      if (line.kind === 'same') {
        flush(block, at)
        context(line.old!, line.new!, at)
      } else if (line.kind === 'del') {
        if (block.adds.length > 0) {
          flush(block, at)
        }
        block.dels.push(line)
      } else {
        block.adds.push(line)
      }
    }
    flush(block, at)
  }
  gapRows(hunks.length, Math.max(0, hunks.length - 1))
  return { gaps, hunkRows, left, right }
}

function firstChange(hunk: Hunk): number | null {
  let deleted = false
  for (const line of hunk.lines) {
    if (line.kind === 'add') {
      return line.new
    }
    if (line.kind === 'del') {
      deleted = true
    } else if (deleted) {
      return line.new
    }
  }
  return deleted ? hunk.newEnd : null
}

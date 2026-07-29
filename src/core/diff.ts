/**
 * Line diff between two texts, emitted as a standard unified patch — the input
 * OpenTUI's `<diff>` renderable parses. Pure string work: git supplies the two
 * texts (HEAD side and buffer/disk side), this module never runs a subprocess,
 * which is what lets unsaved edits diff before they are saved.
 */

export interface UnifiedDiff {
  /** Unified patch text, or '' when the two sides agree. */
  patch: string
  adds: number
  dels: number
}

function splitText(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * Beyond this many edit steps Myers costs more than the answer is worth —
 * a middle that different reads as a rewrite anyway, so it is reported as one.
 */
const MAX_EDIT_DISTANCE = 2000

interface Edit {
  kind: 'same' | 'del' | 'add'
  oldIndex: number
  newIndex: number
}

/**
 * Myers O(ND) shortest edit script over lines, after trimming the common
 * prefix and suffix — which is what keeps a small edit in a large file cheap.
 */
function lineEdits(oldLines: string[], newLines: string[]): Edit[] {
  let start = 0
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++
  }
  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--
    newEnd--
  }

  const edits: Edit[] = []
  for (let i = 0; i < start; i++) edits.push({ kind: 'same', oldIndex: i, newIndex: i })
  edits.push(...myers(oldLines.slice(start, oldEnd), newLines.slice(start, newEnd), start, start))
  for (let i = oldEnd; i < oldLines.length; i++) {
    edits.push({ kind: 'same', oldIndex: i, newIndex: i - oldEnd + newEnd })
  }
  return edits
}

function myers(a: string[], b: string[], oldBase: number, newBase: number): Edit[] {
  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) return []

  const max = Math.min(n + m, MAX_EDIT_DISTANCE)
  const offset = max
  // v[k + offset] = furthest x on diagonal k after d steps; trace keeps a copy
  // per d so the path can be walked back.
  const v = new Int32Array(2 * max + 2)
  const trace: Int32Array[] = []

  let found = -1
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!)
          ? v[k + 1 + offset]!
          : v[k - 1 + offset]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[k + offset] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
  }

  // The texts differ by more than MAX_EDIT_DISTANCE steps: call it a rewrite.
  if (found < 0) {
    const edits: Edit[] = []
    for (let i = 0; i < n; i++) edits.push({ kind: 'del', oldIndex: oldBase + i, newIndex: -1 })
    for (let j = 0; j < m; j++) edits.push({ kind: 'add', oldIndex: -1, newIndex: newBase + j })
    return edits
  }

  // Walk the trace back from the end, collecting edits in reverse.
  const edits: Edit[] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const prev = trace[d]!
    const k = x - y
    const fromK =
      k === -d || (k !== d && prev[k - 1 + offset]! < prev[k + 1 + offset]!) ? k + 1 : k - 1
    const prevX = prev[fromK + offset]!
    const prevY = prevX - fromK
    while (x > prevX && y > prevY) {
      x--
      y--
      edits.push({ kind: 'same', oldIndex: oldBase + x, newIndex: newBase + y })
    }
    if (x === prevX) {
      y--
      edits.push({ kind: 'add', oldIndex: -1, newIndex: newBase + y })
    } else {
      x--
      edits.push({ kind: 'del', oldIndex: oldBase + x, newIndex: -1 })
    }
  }
  while (x > 0 && y > 0) {
    x--
    y--
    edits.push({ kind: 'same', oldIndex: oldBase + x, newIndex: newBase + y })
  }
  return edits.reverse()
}

/** Unchanged lines kept on each side of a change inside a hunk. */
const CONTEXT = 3

/**
 * The unified patch for `rel` between two texts. Hunks carry three lines of
 * context and merge when their context would touch — the same shape `git diff`
 * prints, so any consumer of unified diffs reads it.
 */
export function unifiedDiff(rel: string, oldText: string, newText: string): UnifiedDiff {
  const oldLines = splitText(oldText)
  const newLines = splitText(newText)
  const edits = lineEdits(oldLines, newLines)

  // Hunks as index ranges into `edits`: a gap of more than twice the context
  // between changes splits them, anything closer shares one hunk.
  const hunks: { from: number; to: number }[] = []
  for (let i = 0; i < edits.length; i++) {
    if (edits[i]!.kind === 'same') continue
    const last = hunks.at(-1)
    if (last && i - last.to <= CONTEXT * 2) last.to = i
    else hunks.push({ from: i, to: i })
  }
  if (hunks.length === 0) return { patch: '', adds: 0, dels: 0 }

  let adds = 0
  let dels = 0
  const out = [
    `--- ${oldLines.length === 0 ? '/dev/null' : `a/${rel}`}`,
    `+++ ${newLines.length === 0 ? '/dev/null' : `b/${rel}`}`,
  ]
  // Positions walk forward through the edit list once; each hunk records where
  // it starts and how much of each side it spans.
  let oldPos = 0
  let newPos = 0
  let at = 0
  const advance = (edit: Edit) => {
    if (edit.kind !== 'add') oldPos++
    if (edit.kind !== 'del') newPos++
  }
  for (const hunk of hunks) {
    const from = Math.max(0, hunk.from - CONTEXT)
    const to = Math.min(edits.length - 1, hunk.to + CONTEXT)
    while (at < from) advance(edits[at++]!)
    const oldStart = oldPos
    const newStart = newPos
    let oldCount = 0
    let newCount = 0
    const body: string[] = []
    while (at <= to) {
      const edit = edits[at++]!
      if (edit.kind === 'same') {
        body.push(` ${oldLines[edit.oldIndex]!}`)
        oldCount++
        newCount++
      } else if (edit.kind === 'del') {
        body.push(`-${oldLines[edit.oldIndex]!}`)
        oldCount++
        dels++
      } else {
        body.push(`+${newLines[edit.newIndex]!}`)
        newCount++
        adds++
      }
      advance(edit)
    }
    // An empty side names the line *before* the hunk, unshifted — `-0,0` is how
    // a patch for a brand-new file reads.
    const oldHeader = oldCount === 0 ? oldStart : oldStart + 1
    const newHeader = newCount === 0 ? newStart : newStart + 1
    out.push(`@@ -${oldHeader},${oldCount} +${newHeader},${newCount} @@`, ...body)
  }
  return { patch: `${out.join('\n')}\n`, adds, dels }
}

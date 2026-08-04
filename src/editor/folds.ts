/**
 * Code folding, as far as it goes without help from the buffer.
 *
 * OpenTUI's edit buffer has no notion of a hidden line, so a fold is done by
 * handing the textarea a *different text* — the file's lines with the folded
 * ones taken out — and keeping the file's own text beside it. Every line number
 * therefore lives in one of two spaces, and `FoldView` is the translation:
 * `real` indexes the file, `display` indexes what the buffer holds.
 *
 * Regions come from indentation rather than from the grammar, which is what
 * makes them work for the languages druk highlights with `patterns` and no
 * tree-sitter tree at all. It is also what VS Code falls back to.
 */

/** What a fold command asks the editor for. */
export type FoldOp = 'fold' | 'unfold' | 'foldAll' | 'unfoldAll'

/** A collapsed block: `start` stays on screen, `start+1`…`end` are hidden. */
export interface FoldRegion {
  start: number
  end: number
}

export interface FoldView {
  /** The file's own text — what is saved, highlighted and diffed. */
  source: string
  /** What the buffer holds: `source` minus the hidden lines. */
  text: string
  /** The collapsed regions this view was built from, sorted by start. */
  folds: FoldRegion[]
  /** Real line per display line. */
  real: number[]
  /** Display line per real line; -1 while the line is hidden. */
  display: number[]
  /** Offset of each real line into `source` — what a caret position is measured from. */
  starts: number[]
  /** Lines hidden under each visible anchor, for the note drawn after it. */
  hidden: Map<number, number>
  /**
   * Display rows that stand for no line of the file — the blank gap a review
   * card is drawn in. The gutter draws no number on them, and nothing may be
   * read back out of them: they are not in `source`.
   */
  spacers: ReadonlySet<number>
}

/** A view of `source` with nothing folded and no gap opened — the identity. */
export function plainView(source: string): FoldView {
  return foldView(source, [])
}

/**
 * `view` with `count` blank rows opened after the file's line `line`.
 *
 * This is how a review card hides no code: the rows it is drawn over are rows
 * the buffer does not have text for, so the gutter's numbering carries on
 * across the gap instead of jumping. `real` repeats the anchor's line on them —
 * nothing downstream then has to learn about a row belonging to no line, and
 * `spacers` is what keeps their numbers off the gutter.
 *
 * `source` and `starts` are untouched: the gap is not in the file, so nothing
 * that reads the file back — saving, diffing, highlighting — can see it.
 */
export function spacedView(view: FoldView, line: number, count: number): FoldView {
  const anchor = view.display[line]
  if (count <= 0 || anchor === undefined || anchor < 0) return view
  const after = anchor + 1
  const gap = Array.from({ length: count }, () => '')
  const rows = view.text.split('\n')
  const spacers = new Set<number>()
  for (let n = 0; n < count; n++) spacers.add(after + n)
  return {
    ...view,
    text: [...rows.slice(0, after), ...gap, ...rows.slice(after)].join('\n'),
    real: [...view.real.slice(0, after), ...gap.map(() => line), ...view.real.slice(after)],
    // Only the rows below the gap move; the anchor itself sits above it.
    display: view.display.map(row => (row >= after ? row + count : row)),
    spacers,
  }
}

const isBlank = (line: string): boolean => line.trim() === ''

const indentOf = (line: string, tabSize: number): number => {
  let width = 0
  for (const char of line) {
    if (char === ' ') width++
    else if (char === '\t') width += tabSize - (width % tabSize)
    else break
  }
  return width
}

/**
 * Every block that could be folded, innermost last.
 *
 * A line owns the run of more-indented lines below it, up to the last non-blank
 * one — so `function f() {` owns its body and the closing brace at its own
 * indent stays visible, which is what makes a folded function read as a
 * signature. Blank lines belong to whatever surrounds them rather than ending a
 * block, and a block with nothing under it is not a region at all.
 */
export function foldableRegions(text: string, tabSize: number): FoldRegion[] {
  const lines = text.split('\n')
  const regions: FoldRegion[] = []
  const open: { indent: number; start: number }[] = []
  let lastFilled = -1
  const close = (indent: number) => {
    while (open.length > 0 && open[open.length - 1]!.indent >= indent) {
      const block = open.pop()!
      if (lastFilled > block.start) regions.push({ start: block.start, end: lastFilled })
    }
  }
  for (let line = 0; line < lines.length; line++) {
    if (isBlank(lines[line]!)) continue
    close(indentOf(lines[line]!, tabSize))
    open.push({ indent: indentOf(lines[line]!, tabSize), start: line })
    lastFilled = line
  }
  close(-1)
  return regions.toSorted((a, b) => a.start - b.start || b.end - a.end)
}

/**
 * The indent `text` opens line `from` with, or null when the line is blank —
 * read in place rather than from a split, since the marker column asks this of
 * every line on screen after every keystroke.
 */
function indentAt(text: string, from: number, tabSize: number): number | null {
  let width = 0
  for (let at = from; at < text.length; at++) {
    const char = text[at]
    if (char === ' ') width++
    else if (char === '\t') width += tabSize - (width % tabSize)
    else if (char === '\n') return null
    else return width
  }
  return null
}

/**
 * Whether a block could be folded from `line` — `foldableRegions` asked one
 * line at a time, for the viewport's worth of gutter markers. A line owns what
 * follows it exactly when the next line with anything on it is further in,
 * which is the same rule the whole-file pass applies.
 *
 * `starts` is the offset of each line, which the caller already keeps: splitting
 * a 20 000-line file per keystroke to answer forty questions is the cost this
 * exists to avoid.
 */
export function foldsFrom(
  text: string,
  starts: readonly number[],
  line: number,
  tabSize: number,
): boolean {
  const start = starts[line]
  if (start === undefined) return false
  const own = indentAt(text, start, tabSize)
  if (own === null) return false
  for (let next = line + 1; next < starts.length; next++) {
    const indent = indentAt(text, starts[next]!, tabSize)
    if (indent === null) continue
    return indent > own
  }
  return false
}

/** The tightest region covering `line`, which is what a fold at the cursor means. */
export function innermostRegion(regions: FoldRegion[], line: number): FoldRegion | null {
  let best: FoldRegion | null = null
  for (const region of regions) {
    if (line < region.start || line > region.end) continue
    if (
      !best ||
      region.start > best.start ||
      (region.start === best.start && region.end < best.end)
    ) {
      best = region
    }
  }
  return best
}

/** Drop what a text of `lines` lines can no longer hold, and merge duplicates. */
function normalize(folds: FoldRegion[], lines: number): FoldRegion[] {
  const seen = new Set<number>()
  const kept: FoldRegion[] = []
  for (const fold of folds.toSorted((a, b) => a.start - b.start || b.end - a.end)) {
    const end = Math.min(fold.end, lines - 1)
    if (fold.start < 0 || fold.start >= lines - 1 || end <= fold.start) continue
    if (seen.has(fold.start)) continue
    seen.add(fold.start)
    kept.push({ start: fold.start, end })
  }
  return kept
}

/** Shared, since an ordinary fold view opens no gap and every one would else allocate. */
const EMPTY: ReadonlySet<number> = new Set()

export function foldView(source: string, folds: FoldRegion[]): FoldView {
  const lines = source.split('\n')
  const kept = normalize(folds, lines.length)
  const isHidden = new Uint8Array(lines.length)
  for (const fold of kept) {
    for (let line = fold.start + 1; line <= fold.end; line++) isHidden[line] = 1
  }

  const real: number[] = []
  const display: number[] = Array.from({ length: lines.length }, () => -1)
  const starts: number[] = Array.from({ length: lines.length }, () => 0)
  const shown: string[] = []
  let offset = 0
  for (let line = 0; line < lines.length; line++) {
    starts[line] = offset
    offset += lines[line]!.length + 1
    if (isHidden[line]) continue
    display[line] = real.length
    real.push(line)
    shown.push(lines[line]!)
  }

  const hidden = new Map<number, number>()
  for (const fold of kept) {
    // A region nested inside another collapsed one has no visible anchor to
    // hang a note on; it stays folded and reappears when the outer opens.
    if (display[fold.start]! < 0) continue
    hidden.set(fold.start, fold.end - fold.start)
  }

  return {
    source,
    text: shown.join('\n'),
    folds: kept,
    real,
    display,
    starts,
    hidden,
    spacers: EMPTY,
  }
}

/**
 * The file's text after an edit the *buffer* took — the one direction that is
 * not a lookup, since the edit is expressed in display lines and the file is
 * missing everything they hide.
 *
 * The changed span is found by trimming the common head and tail, then mapped
 * back through `real`. Lines hidden under an anchor inside that span are moved
 * to the end of the replacement rather than deleted with it: `EditorPane`
 * opens a region before letting a key edit its anchor, so this is the net under
 * an edit route that forgot to — and dropping the block there would delete a
 * screenful of a file that shows no sign of holding it.
 */
export function reconcileFolds(
  view: FoldView,
  nextDisplay: string,
): { source: string; folds: FoldRegion[] } {
  if (nextDisplay === view.text) return { source: view.source, folds: view.folds }
  const before = view.text.split('\n')
  const after = nextDisplay.split('\n')

  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tailBefore = before.length
  let tailAfter = after.length
  while (tailBefore > head && tailAfter > head && before[tailBefore - 1] === after[tailAfter - 1]) {
    tailBefore--
    tailAfter--
  }

  const lines = view.source.split('\n')
  const realStart = head < view.real.length ? view.real[head]! : lines.length
  const realEnd = tailBefore < view.real.length ? view.real[tailBefore]! : lines.length

  const rescued: string[] = []
  const kept: FoldRegion[] = []
  for (const fold of view.folds) {
    if (fold.start >= realStart && fold.start < realEnd) {
      rescued.push(...lines.slice(fold.start + 1, Math.min(fold.end, lines.length - 1) + 1))
      continue
    }
    kept.push(fold)
  }

  const replacement = after.slice(head, tailAfter)
  const source = [
    ...lines.slice(0, realStart),
    ...replacement,
    ...rescued,
    ...lines.slice(realEnd),
  ].join('\n')

  const delta = replacement.length + rescued.length - (realEnd - realStart)
  const moved = kept.map(fold =>
    fold.start >= realEnd ? { start: fold.start + delta, end: fold.end + delta } : fold,
  )
  return { source, folds: normalize(moved, source.split('\n').length) }
}

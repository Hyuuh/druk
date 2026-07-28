/**
 * Git changes as a column beside the scrollbar — where the changes are in the
 * whole file, not just the part on screen.
 *
 * One row of the track stands for a run of lines, so a change anywhere in that
 * run puts a mark on it. The gutter already says which line changed; this says
 * whether it is worth scrolling down at all.
 */
import type { LineChange } from '../core/git'

/** Deletions outrank modifications outrank additions when a row holds several. */
const RANK: Record<LineChange, number> = { deleted: 3, modified: 2, added: 1 }

/**
 * A mark per track row, or undefined where nothing changed. `rows` is the track
 * height; `total` the file's line count.
 */
export function changeRows(
  gitLines: Map<number, LineChange>,
  total: number,
  rows: number,
): Array<LineChange | undefined> {
  const marks: Array<LineChange | undefined> = Array.from({ length: Math.max(0, rows) })
  if (rows <= 0 || total <= 0 || gitLines.size === 0) return marks

  for (const [line, change] of gitLines) {
    if (line < 0 || line >= total) continue
    const row = Math.min(rows - 1, Math.floor((line / total) * rows))
    const current = marks[row]
    if (!current || RANK[change] > RANK[current]) marks[row] = change
  }
  return marks
}

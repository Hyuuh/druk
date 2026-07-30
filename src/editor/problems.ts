/**
 * LSP problems as a column beside the git track — where the whole file's errors
 * are, not just the ones on screen.
 *
 * One row stands for a run of lines, as with the git track. The glyph is the
 * gutter's dot rather than git's bar so the two columns never read as one kind
 * of mark in two colors.
 */
import { SEVERITY_RANK } from '../lsp/protocol'
import type { ProblemSeverity } from '../lsp/protocol'

/**
 * Info and hint stay off the track. They land on far more lines than errors do
 * — an unused import on every other line — and a column speckled end to end
 * says nothing about where it is worth scrolling.
 */
const TRACKED: ProblemSeverity[] = ['error', 'warning']

/**
 * A severity per track row, or undefined where the run is clean. `rows` is the
 * track height; `total` the file's line count.
 */
export function problemRows(
  problems: Map<number, { severity: ProblemSeverity }>,
  total: number,
  rows: number,
): Array<ProblemSeverity | undefined> {
  const marks: Array<ProblemSeverity | undefined> = Array.from({ length: Math.max(0, rows) })
  if (rows <= 0 || total <= 0 || problems.size === 0) return marks

  for (const [line, problem] of problems) {
    if (line < 0 || line >= total) continue
    if (!TRACKED.includes(problem.severity)) continue
    const row = Math.min(rows - 1, Math.floor((line / total) * rows))
    const current = marks[row]
    if (!current || SEVERITY_RANK[problem.severity] < SEVERITY_RANK[current]) {
      marks[row] = problem.severity
    }
  }
  return marks
}

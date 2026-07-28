/**
 * Which logical lines a viewport covers.
 *
 * Highlights are addressed by logical line, but a wrapped buffer scrolls in
 * visual rows: a 3 000-line lockfile whose lines wrap four times is 12 000 rows
 * tall. Reading `scrollY` as a line number therefore asked for a window around
 * line 5 970 of a 3 000-line file — nothing was applied and the visible text
 * rendered plain. `lineSources` maps each visual row back to its line.
 */
export interface Window {
  from: number
  to: number
}

/** The line a visual row belongs to. Identity when nothing wraps. */
export function lineAt(lineSources: readonly number[], row: number): number {
  if (lineSources.length === 0) return row
  return lineSources[Math.max(0, Math.min(lineSources.length - 1, row))] ?? row
}

export function logicalWindow(
  scrollY: number,
  height: number,
  /** Logical line per visual row, or empty when nothing wraps. */
  lineSources: readonly number[],
  overscan: number,
): Window {
  return {
    from: Math.max(0, lineAt(lineSources, scrollY) - overscan),
    to: lineAt(lineSources, scrollY + height) + overscan,
  }
}

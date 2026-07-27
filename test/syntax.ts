import { computeHighlights, segmentsIn, STALE } from '../src/languages/highlight'
import type { Highlighted, Segment } from '../src/languages/highlight'

/**
 * Highlight helpers for tests. Kept out of `helpers.tsx` so a unit test can use
 * them without pulling in `<App/>` and the whole renderer.
 */

/** Every line at once, for `segmentsIn`. */
export const WHOLE = Number.POSITIVE_INFINITY

export async function parseHighlights(
  content: string,
  filetype: string,
  tabSize = 2,
): Promise<Highlighted> {
  const parsed = await computeHighlights(content, filetype, tabSize)
  if (parsed === STALE) throw new Error('unexpected STALE')
  return parsed
}

/** Segments for a whole document — what the editor builds one window at a time. */
export async function allSegments(
  content: string,
  filetype: string,
  tabSize = 2,
): Promise<Segment[]> {
  return segmentsIn(await parseHighlights(content, filetype, tabSize), 0, WHOLE)
}

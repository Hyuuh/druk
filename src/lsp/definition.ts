/**
 * The pure half of go-to-definition: one wire reply, whatever of the three
 * shapes the spec allows the server picked, as one place in one file.
 * `test/imports.test.ts` exercises it without a terminal.
 */
import { fileURLToPath } from 'node:url'

import type { Location, LocationLink, Range } from './protocol'

/** Where a jump lands. Both fields 0-based, as every position the bridge speaks. */
export interface Target {
  path: string
  line: number
  col: number
}

/**
 * `Location | Location[] | LocationLink[] | null`, reduced to the first place
 * worth jumping to. First rather than a chooser: a definition query answers with
 * several only for an overloaded or merged declaration, where the rest are the
 * same name a line or two apart.
 */
export function normalizeDefinition(result: unknown): Target | null {
  const first = Array.isArray(result) ? result[0] : result
  if (typeof first !== 'object' || first === null) return null
  const entry = first as Partial<Location> & Partial<LocationLink>
  const uri = entry.targetUri ?? entry.uri
  // The selection range is the name itself; the target range is the whole
  // declaration, whose start is the doc comment on anything documented.
  const range: Range | undefined = entry.targetSelectionRange ?? entry.targetRange ?? entry.range
  if (typeof uri !== 'string' || !range) return null
  try {
    return { path: fileURLToPath(uri), line: range.start.line, col: range.start.character }
  } catch {
    return null // a scheme that is not a file: a jar, a generated buffer, git://
  }
}

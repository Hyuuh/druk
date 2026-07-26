/**
 * Turns a unified diff into rows the viewer can paint.
 *
 * Git's per-file preamble (`diff --git`, `index`, `---`, `+++`) is four lines of
 * mostly-repeated path text, which buries the one thing a reader needs in a
 * multi-file diff: which file they are looking at. Those lines collapse into a
 * single `file` row carrying the path and what happened to it.
 */

export type DiffRowKind = 'file' | 'hunk' | 'added' | 'removed' | 'context'

export interface DiffRow {
  kind: DiffRowKind
  text: string
}

const GIT_HEADER = /^diff --git a\/(.+?) b\/(.+)$/

/** Lines folded into the `file` row above them. */
const isPreamble = (line: string) =>
  line.startsWith('index ') ||
  line.startsWith('--- ') ||
  line.startsWith('+++ ') ||
  line.startsWith('old mode ') ||
  line.startsWith('new mode ') ||
  line.startsWith('similarity ') ||
  line.startsWith('dissimilarity ') ||
  line.startsWith('rename from ') ||
  line.startsWith('rename to ') ||
  line.startsWith('copy from ') ||
  line.startsWith('copy to ')

export function parseDiff(diff: string): DiffRow[] {
  if (!diff.trim()) return []
  const rows: DiffRow[] = []
  let pending: { from: string; to: string; note: string } | null = null

  const flush = () => {
    if (!pending) return
    const renamed = pending.from !== pending.to
    const name = renamed ? `${pending.from} → ${pending.to}` : pending.to
    rows.push({ kind: 'file', text: pending.note ? `${name}  (${pending.note})` : name })
    pending = null
  }

  for (const line of diff.replace(/\n$/, '').split('\n')) {
    const header = GIT_HEADER.exec(line)
    if (header) {
      flush()
      pending = { from: header[1]!, to: header[2]!, note: '' }
      continue
    }
    if (pending) {
      if (line.startsWith('new file')) pending.note = 'new file'
      else if (line.startsWith('deleted file')) pending.note = 'deleted'
      if (isPreamble(line) || line.startsWith('new file') || line.startsWith('deleted file')) {
        continue
      }
      flush()
    }
    if (line.startsWith('@@')) rows.push({ kind: 'hunk', text: line })
    else if (line.startsWith('+')) rows.push({ kind: 'added', text: line })
    else if (line.startsWith('-')) rows.push({ kind: 'removed', text: line })
    else if (line === '\\ No newline at end of file') rows.push({ kind: 'context', text: line })
    else rows.push({ kind: 'context', text: line })
  }
  flush()
  return rows
}

/** Files touched by the diff, for a summary line. */
export function changedFiles(rows: DiffRow[]): number {
  return rows.filter(row => row.kind === 'file').length
}

import type { FileStatus } from './git'

/** One changed file, as the source-control panel lists it. */
export interface Change {
  path: string
  /** Relative to the project root, `/`-separated — what the tree is built from. */
  rel: string
  status: FileStatus
  /**
   * Which index side this row is about. Omitted when the panel is a single list
   * (compare-base review). A partially staged path appears once per side.
   */
  side?: 'staged' | 'unstaged'
}

/**
 * A row of the source-control panel. Folder rows exist only in tree mode; the
 * panel and the keymap both walk this list, so a row's index is what the cursor
 * means — never an index into the changes themselves.
 */
export interface FileRow {
  kind: 'file'
  depth: number
  label: string
  change: Change
}

export interface DirRow {
  kind: 'dir'
  depth: number
  label: string
  /** Path relative to the root — the key `collapsed` holds. */
  rel: string
  collapsed: boolean
  /** Changed files under it, which is what a folded row shows instead of them. */
  files: number
}

export interface SectionRow {
  kind: 'section'
  id: 'staged' | 'changes'
  label: string
  count: number
  /** Always 0 — sections sit at the top of each list, never nested. */
  depth: 0
}

export type ChangeRow = FileRow | DirRow | SectionRow

/** Every folder on the way to `rel`, outermost first: `a/b/c.ts` → `a`, `a/b`. */
export function ancestorDirs(rel: string): string[] {
  const parts = rel.split('/')
  return parts.slice(0, -1).map((_, at) => parts.slice(0, at + 1).join('/'))
}

/**
 * The panel's rows for `changes`, which must already be sorted by `rel`.
 *
 * `list` is one row per change under its full path. `tree` nests them under
 * folder rows and hides the subtree of anything in `collapsed` — a folder's own
 * row stays, so there is something to press to bring it back. Folders with a
 * single child folder are joined into one row (`src/app` rather than two rows),
 * which is what keeps a deep project readable in a 24-column sidebar.
 */
export function changeRows(
  changes: readonly Change[],
  mode: 'list' | 'tree',
  collapsed: ReadonlySet<string> = new Set(),
): ChangeRow[] {
  if (mode === 'list') {
    return changes.map(change => ({ kind: 'file', depth: 0, label: change.rel, change }))
  }

  const rows: ChangeRow[] = []
  /** Folder rows already emitted, by rel path, so a subtree is opened once. */
  const emitted = new Map<string, { depth: number }>()

  for (const change of changes) {
    const dirs = ancestorDirs(change.rel)
    // A collapsed ancestor hides this file, but its folder row still has to be
    // emitted — hence the walk below runs before the skip, not after.
    let hidden = false
    let depth = 0
    for (const dir of dirs) {
      if (hidden) break
      const seen = emitted.get(dir)
      if (seen) {
        depth = seen.depth + 1
      } else {
        const folded = foldable(changes, dir)
        rows.push({
          kind: 'dir',
          depth,
          label: folded.slice(dir.lastIndexOf('/') + 1),
          rel: dir,
          collapsed: collapsed.has(dir),
          files: changes.filter(c => c.rel.startsWith(`${dir}/`)).length,
        })
        // The joined folders count as one row: everything under them sits one
        // level in, whatever their number.
        emitted.set(dir, { depth })
        for (const joined of ancestorsUnder(dir, folded)) emitted.set(joined, { depth })
        depth += 1
      }
      if (collapsed.has(dir)) hidden = true
    }
    if (hidden) continue
    rows.push({
      kind: 'file',
      depth,
      label: change.rel.slice(change.rel.lastIndexOf('/') + 1),
      change,
    })
  }
  return rows
}

/**
 * Staged and unstaged lists as the source-control panel draws them.
 *
 * With nothing staged the panel stays a single list — the everyday case, and the
 * same shape it had before staging existed. Headers appear only while both sides
 * have rows, so a partial stage is readable as two groups; once everything is in
 * the index the empty Changes section is omitted rather than left as a 0.
 */
export function sectionedChangeRows(
  staged: readonly Change[],
  unstaged: readonly Change[],
  mode: 'list' | 'tree',
  collapsed: ReadonlySet<string> = new Set(),
): ChangeRow[] {
  if (staged.length === 0 && unstaged.length === 0) return []
  if (staged.length === 0) return changeRows(unstaged, mode, collapsed)
  if (unstaged.length === 0) {
    return [
      { kind: 'section', id: 'staged', label: 'STAGED', count: staged.length, depth: 0 },
      ...changeRows(staged, mode, collapsed),
    ]
  }
  return [
    { kind: 'section', id: 'staged', label: 'STAGED', count: staged.length, depth: 0 },
    ...changeRows(staged, mode, collapsed),
    { kind: 'section', id: 'changes', label: 'CHANGES', count: unstaged.length, depth: 0 },
    ...changeRows(unstaged, mode, collapsed),
  ]
}

/**
 * `dir` extended through every folder that is its only child: the rel path of the
 * deepest folder that carries all of `dir`'s files.
 */
function foldable(changes: readonly Change[], dir: string): string {
  let at = dir
  for (;;) {
    const under = changes.filter(change => change.rel.startsWith(`${at}/`))
    const next = new Set(under.map(change => change.rel.slice(at.length + 1).split('/')[0]!))
    if (next.size !== 1) return at
    const only = [...next][0]!
    // A file, not a folder: nothing left to join.
    if (under.some(change => change.rel === `${at}/${only}`)) return at
    at = `${at}/${only}`
  }
}

/** The folder rels between `dir` (exclusive) and `folded` (inclusive). */
function ancestorsUnder(dir: string, folded: string): string[] {
  if (folded === dir) return []
  return ancestorDirs(`${folded}/x`).filter(rel => rel.length > dir.length)
}

/** The folder row `rows[at]` sits under, or `at` itself when it is at the top
 * level — ← on a file walks out to it, and there is nowhere further to go. */
export function parentRow(rows: readonly ChangeRow[], at: number): number {
  const depth = rows[at]?.depth ?? 0
  for (let up = at - 1; up >= 0; up--) {
    const row = rows[up]!
    // A section ends the walk: the file belongs to the group below it, not to a
    // folder drawn for the group above.
    if (row.kind === 'section') return at
    if (row.kind === 'dir' && row.depth < depth) return up
  }
  return at
}

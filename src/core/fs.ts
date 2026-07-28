import fs from 'node:fs'
import { basename, dirname, join } from 'node:path'

export interface TreeNode {
  name: string
  path: string
  isDir: boolean
  depth: number
  /** Points elsewhere: shown with a mark, opened as whatever it resolves to. */
  symlink?: boolean
}

/**
 * A version control system's own storage. Not project content: nothing in here is
 * meant to be browsed, searched or edited, and `.git` alone can hold more files than
 * everything else put together. Left out of every listing, and — with the exceptions
 * below — out of the watcher too.
 *
 * Ordinary dotfiles are *not* in this class. `.gitignore`, `.env` and `.github/` are
 * files someone wrote and will want to open.
 */
export const VCS_DIRS = new Set(['.git', '.svn', '.hg', '.jj'])

/**
 * The same list as a path matcher, for the watcher. Reading git status refreshes
 * `.git/index`, so watching all of `.git` closes a loop on itself: status → index
 * write → watcher → status, forever, at whatever rate the debounce allows.
 */
const UNWATCHED = new RegExp(
  // The leading dot has to be escaped, or `.git` would also match `agit`.
  `(?:^|[/\\\\])(?:${[...VCS_DIRS].map(dir => dir.replace('.', '\\.')).join('|')})(?:[/\\\\]|$)`,
)

/** What a debounced burst of events touched. Both can be true for one burst. */
export interface Changed {
  /** A file in the working tree. */
  tree: boolean
  /** `HEAD` or a ref moved: a commit, checkout or reset happened. */
  git: boolean
}

/**
 * Watch `root` and call `onChange` (debounced) on any file event. Returns a stop
 * function. Best-effort — an unwatchable path is simply left unwatched.
 *
 * The two kinds are reported apart because they cost different things to react to.
 * Re-reading ahead/behind is two subprocesses, and only history moving can change
 * it — running that on every keystroke-triggered save would be pure waste.
 */
export function watchTree(root: string, onChange: (changed: Changed) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: Changed = { tree: false, git: false }

  const schedule = (kind: keyof Changed) => {
    pending[kind] = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const changed = pending
      pending = { tree: false, git: false }
      onChange(changed)
    }, 80) // coalesce bursts of events
  }

  const watchers: fs.FSWatcher[] = []
  const watch = (
    path: string,
    kind: keyof Changed,
    options: fs.WatchOptions,
    wanted?: (name: string) => boolean,
  ) => {
    try {
      watchers.push(
        fs.watch(path, options, (_event, filename) => {
          const name = filename?.toString()
          if (wanted && name && !wanted(name)) return
          schedule(kind)
        }),
      )
    } catch {
      // best-effort: this path just goes unwatched
    }
  }

  watch(root, 'tree', { recursive: true }, name => !UNWATCHED.test(name))

  /*
   * Two more watchers, because the recursive one above cannot cover this. A commit
   * or a checkout made in another terminal changes no working-tree file at all, so
   * without these the tree marks, the changed count and the branch sit stale — and
   * the recursive watch is no help: macOS coalesces everything under `.git` down to
   * `.git/index.lock`, which is precisely the file a plain `git status` rewrites, so
   * reacting to it would feed the watcher its own tail forever.
   *
   * Watching HEAD and the refs directly reports a commit, a checkout, a reset and a
   * pack-refs — and, verified, nothing that reading status does.
   */
  const gitDir = join(root, '.git')
  watch(join(gitDir, 'HEAD'), 'git', {})
  watch(join(gitDir, 'refs'), 'git', { recursive: true })

  return () => {
    if (timer) clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
  }
}

/**
 * Directory entries, folders first then files, each alphabetical.
 *
 * Everything the directory holds, bar the VCS store: there is no show/hide setting,
 * because hiding a file the user can see in their shell is a worse answer than
 * showing it and refusing to open what cannot be displayed.
 */
export function listDir(dir: string, depth = 0): TreeNode[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(e => !(e.isDirectory() && VCS_DIRS.has(e.name)))
    .map(e => {
      const path = join(dir, e.name)
      if (!e.isSymbolicLink()) return { name: e.name, path, isDir: e.isDirectory(), depth }
      // A dirent describes the link itself, so a symlinked directory answers
      // isDirectory() false — and the tree then tries to read it as a file.
      let isDir = false
      try {
        isDir = fs.statSync(path).isDirectory()
      } catch {
        // Broken link: nothing to resolve, so leave it looking like a file.
      }
      return { name: e.name, path, isDir, depth, symlink: true }
    })
    .toSorted((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

/** Where a path really lives, or the path itself when it cannot be resolved. */
function realPath(path: string): string {
  try {
    return fs.realpathSync(path)
  } catch {
    return path
  }
}

export function flattenVisible(root: string, expanded: Set<string>): TreeNode[] {
  const out: TreeNode[] = []
  // Real paths of the branch being walked. A symlink pointing at one of its own
  // ancestors is a cycle, and expanding into it would never come back.
  const branch = new Set<string>()
  const walk = (dir: string, depth: number) => {
    const real = realPath(dir)
    if (branch.has(real)) return
    branch.add(real)
    for (const node of listDir(dir, depth)) {
      out.push(node)
      if (node.isDir && expanded.has(node.path)) walk(node.path, depth + 1)
    }
    branch.delete(real)
  }
  walk(root, 0)
  return out
}

export class BinaryFileError extends Error {
  constructor() {
    super('binary file')
    this.name = 'BinaryFileError'
  }
}

/**
 * Read a text file, refusing binary content — a NUL byte in the first 8 KB, the
 * same heuristic git uses.
 *
 * The sniff is a positional read rather than a slice of the whole file: the tree
 * happily offers a 2 GB video, and reading it before rejecting it would allocate
 * all of it and throw ERR_FS_FILE_TOO_LARGE instead of BinaryFileError.
 */
export function readFile(path: string): string {
  const fd = fs.openSync(path, 'r')
  try {
    const head = Buffer.alloc(8192)
    const read = fs.readSync(fd, head, 0, 8192, 0)
    if (head.subarray(0, read).includes(0)) throw new BinaryFileError()
  } finally {
    fs.closeSync(fd)
  }
  return fs.readFileSync(path, 'utf8')
}

/** Last-modified time in ms, or 0 when the file is missing/unreadable. */
export function mtimeOf(path: string): number {
  try {
    return fs.statSync(path).mtimeMs
  } catch {
    return 0
  }
}

export function isDirectory(path: string): boolean {
  try {
    return fs.statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function exists(path: string): boolean {
  return fs.existsSync(path)
}

/** Result helper: `null` on success, otherwise a human-readable message. */
export type FsResult = string | null

const attempt = (run: () => void): FsResult => {
  try {
    run()
    return null
  } catch (e) {
    return (e as Error).message
  }
}

const taken = (path: string): FsResult =>
  fs.existsSync(path) ? `already exists: ${basename(path)}` : null

export const writeFile = (path: string, content: string): FsResult =>
  attempt(() => {
    fs.mkdirSync(dirname(path), { recursive: true })
    fs.writeFileSync(path, content, 'utf8')
  })

export const createFile = (path: string): FsResult =>
  taken(path) ??
  attempt(() => {
    fs.mkdirSync(dirname(path), { recursive: true })
    fs.writeFileSync(path, '', 'utf8')
  })

export const createDir = (path: string): FsResult =>
  taken(path) ?? attempt(() => void fs.mkdirSync(path, { recursive: true }))

export const remove = (path: string): FsResult =>
  attempt(() => fs.rmSync(path, { recursive: true, force: true }))

export const rename = (from: string, to: string): FsResult =>
  taken(to) ??
  attempt(() => {
    fs.mkdirSync(dirname(to), { recursive: true })
    fs.renameSync(from, to)
  })

export const copy = (from: string, to: string): FsResult =>
  taken(to) ??
  attempt(() => {
    fs.mkdirSync(dirname(to), { recursive: true })
    // `errorOnExist` with `force: false` so a race that creates the destination
    // between the check above and here fails loudly instead of overwriting it.
    fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: true })
  })

/**
 * `dir/name`, or the first `name copy`, `name copy 2`, … that nothing occupies.
 *
 * Pasting a copy beside the original is the ordinary case, so a free name has to be
 * found rather than refused — and the suffix goes before the extension, where the
 * eye expects it and where tooling still sees a `.ts` file.
 */
export function freePath(dir: string, name: string): string {
  if (!fs.existsSync(join(dir, name))) return join(dir, name)
  const dot = name.lastIndexOf('.')
  // A leading dot is the whole name of a dotfile, not an extension.
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 1; ; n++) {
    const candidate = join(dir, `${stem} copy${n === 1 ? '' : ` ${n}`}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
}

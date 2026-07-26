import fs from 'node:fs'
import { basename, dirname, join } from 'node:path'

export interface TreeNode {
  name: string
  path: string
  isDir: boolean
  depth: number
}

/**
 * Watch `root` recursively and call `onChange` (debounced) on any file event.
 * Returns a stop function. Best-effort — returns a no-op if watching fails.
 */
export function watchTree(root: string, onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let watcher: fs.FSWatcher
  try {
    watcher = fs.watch(root, { recursive: true }, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(onChange, 80) // coalesce bursts of events
    })
  } catch {
    return () => {}
  }
  return () => {
    if (timer) clearTimeout(timer)
    watcher.close()
  }
}

/** Noise hidden when `showHidden` is off. */
export const HIDDEN = new Set(['.DS_Store', '.git', '.svn', '.hg', 'Thumbs.db', 'desktop.ini'])

/** Directory entries, folders first then files, each alphabetical. */
export function listDir(dir: string, depth = 0, showHidden = false): TreeNode[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(e => showHidden || !HIDDEN.has(e.name))
    .map(e => ({
      name: e.name,
      path: join(dir, e.name),
      isDir: e.isDirectory(),
      depth,
    }))
    .toSorted((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export function flattenVisible(
  root: string,
  expanded: Set<string>,
  showHidden = false,
): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (dir: string, depth: number) => {
    for (const node of listDir(dir, depth, showHidden)) {
      out.push(node)
      if (node.isDir && expanded.has(node.path)) walk(node.path, depth + 1)
    }
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

/** Human-readable size, for the "cannot display" notice. */
export function fileSize(path: string): string {
  try {
    const { size } = fs.statSync(path)
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
  } catch {
    return 'unknown size'
  }
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

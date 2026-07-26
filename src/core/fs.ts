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

/** Noise that is never worth showing in the tree. */
/** Noise hidden by default; `showHidden` in the config brings it back. */
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

/** Flatten the tree into the currently visible rows given expanded folders. */
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

/**
 * Read a text file. Throws on binary content (a NUL byte in the first 8 KB is
 * the same heuristic git uses) so we never load an image or a .DS_Store into
 * the editor as mojibake.
 */
export class BinaryFileError extends Error {
  constructor() {
    super('binary file')
    this.name = 'BinaryFileError'
  }
}

export function readFile(path: string): string {
  const buf = fs.readFileSync(path)
  if (buf.subarray(0, 8192).includes(0)) throw new BinaryFileError()
  return buf.toString('utf8')
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

export function writeFile(path: string, content: string): FsResult {
  try {
    fs.mkdirSync(dirname(path), { recursive: true })
    fs.writeFileSync(path, content, 'utf8')
    return null
  } catch (e) {
    return (e as Error).message
  }
}

export function createFile(path: string): FsResult {
  try {
    if (fs.existsSync(path)) return `already exists: ${basename(path)}`
    fs.mkdirSync(dirname(path), { recursive: true })
    fs.writeFileSync(path, '', 'utf8')
    return null
  } catch (e) {
    return (e as Error).message
  }
}

export function createDir(path: string): FsResult {
  try {
    if (fs.existsSync(path)) return `already exists: ${basename(path)}`
    fs.mkdirSync(path, { recursive: true })
    return null
  } catch (e) {
    return (e as Error).message
  }
}

export function remove(path: string): FsResult {
  try {
    fs.rmSync(path, { recursive: true, force: true })
    return null
  } catch (e) {
    return (e as Error).message
  }
}

export function rename(from: string, to: string): FsResult {
  try {
    if (fs.existsSync(to)) return `already exists: ${basename(to)}`
    fs.mkdirSync(dirname(to), { recursive: true })
    fs.renameSync(from, to)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

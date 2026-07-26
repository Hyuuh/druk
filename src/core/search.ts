import { listDir, readFile } from './fs'

export interface Match {
  path: string
  /** 0-based line index. */
  line: number
  /** 0-based column of the match start. */
  col: number
  /** The whole line, for display. */
  text: string
}

export interface SearchOptions {
  caseSensitive?: boolean
  limit?: number
}

const DEFAULT_LIMIT = 200

/** Directories never worth walking for a project-wide search. */
const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  '.next',
  '.turbo',
  '.cache',
])

export function searchText(
  text: string,
  query: string,
  path: string,
  options: SearchOptions = {},
): Match[] {
  if (!query) return []
  const limit = options.limit ?? DEFAULT_LIMIT
  const needle = options.caseSensitive ? query : query.toLowerCase()
  const matches: Match[] = []

  const lines = text.split('\n')
  for (let line = 0; line < lines.length && matches.length < limit; line++) {
    const raw = lines[line]!
    const haystack = options.caseSensitive ? raw : raw.toLowerCase()
    let col = haystack.indexOf(needle)
    while (col >= 0 && matches.length < limit) {
      matches.push({ path, line, col, text: raw })
      col = haystack.indexOf(needle, col + needle.length)
    }
  }
  return matches
}

/** Search every text file under `root`, breadth-first, stopping at the limit. */
export function searchProject(root: string, query: string, options: SearchOptions = {}): Match[] {
  if (!query) return []
  const limit = options.limit ?? DEFAULT_LIMIT
  const matches: Match[] = []
  const queue: string[] = [root]

  while (queue.length > 0 && matches.length < limit) {
    const dir = queue.shift()!
    for (const node of listDir(dir)) {
      if (matches.length >= limit) break
      if (node.isDir) {
        if (!SKIPPED_DIRS.has(node.name)) queue.push(node.path)
        continue
      }
      let content: string
      try {
        content = readFile(node.path)
      } catch {
        continue // binary or unreadable
      }
      matches.push(
        ...searchText(content, query, node.path, {
          ...options,
          limit: limit - matches.length,
        }),
      )
    }
  }
  return matches
}

/**
 * Subsequence match, VS Code style: every character of `query` must appear in
 * order. Returns a score (lower is better) or null when it does not match.
 */
export function fuzzyScore(text: string, query: string): number | null {
  if (!query) return 0
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  let score = 0
  let at = -1
  for (const char of needle) {
    const next = haystack.indexOf(char, at + 1)
    if (next < 0) return null
    score += next - at - 1 // reward characters that sit close together
    at = next
  }
  // Prefer matches late in the path (the file name) and shorter paths.
  return score + text.length - at
}

/** Every file under `root`, for the fuzzy finder. */
export function listFiles(root: string, limit = 5000, showHidden = false): string[] {
  const files: string[] = []
  const queue: string[] = [root]
  while (queue.length > 0 && files.length < limit) {
    const dir = queue.shift()!
    for (const node of listDir(dir, 0, showHidden)) {
      if (node.isDir) {
        if (!SKIPPED_DIRS.has(node.name)) queue.push(node.path)
      } else if (files.length < limit) {
        files.push(node.path)
      }
    }
  }
  return files
}

/** Case-insensitive replace of every occurrence, mirroring searchText. */
export function replaceAll(text: string, query: string, replacement: string): string {
  if (!query) return text
  const needle = query.toLowerCase()
  const haystack = text.toLowerCase()
  let out = ''
  let at = 0
  for (;;) {
    const found = haystack.indexOf(needle, at)
    if (found < 0) break
    out += text.slice(at, found) + replacement
    at = found + needle.length
  }
  return out + text.slice(at)
}

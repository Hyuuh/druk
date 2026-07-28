import { listDir, readFile } from './fs'

export interface Match {
  path: string
  /** 0-based line index. */
  line: number
  /** 0-based column of the match start. */
  col: number
  /** Characters matched — equals the query's length except in regex mode. */
  length: number
  text: string
}

export interface SearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

/**
 * The query as a per-line RegExp, or null when it is an invalid pattern.
 * One place builds it so search, replace-one and replace-all can never
 * disagree about what a match is.
 */
export function buildQuery(query: string, options: SearchOptions = {}): RegExp | null {
  const escaped = options.regex ? query : query.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  const wrapped = options.wholeWord ? `\\b(?:${escaped})\\b` : escaped
  try {
    return new RegExp(wrapped, options.caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

/** Lines around a match, for a preview. */
export interface Context {
  /** 0-based index of `lines[0]`. */
  start: number
  lines: string[]
}

/** As `contextAround`, for text already in hand (the open buffer). */
export function contextIn(text: string, line: number, radius: number): Context {
  const lines = text.split('\n')
  const start = Math.max(0, line - radius)
  return { start, lines: lines.slice(start, line + radius + 1) }
}

/**
 * `radius` lines either side of `line`. Reads the file rather than carrying context
 * on every `Match`: a 200-match scan would drag five extra lines along for each, and
 * only the selected one is ever shown.
 */
export function contextAround(path: string, line: number, radius: number): Context | null {
  try {
    return contextIn(readFile(path), line, radius)
  } catch {
    return null // deleted or unreadable since the scan
  }
}

const DEFAULT_LIMIT = 200

/** Directories never worth walking, for both the search and the fuzzy finder. */
const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  '.turbo',
  '.cache',
])

export function searchText(
  text: string,
  query: string,
  path: string,
  options: SearchOptions = {},
  limit = DEFAULT_LIMIT,
): Match[] {
  if (!query) return []
  const pattern = buildQuery(query, options)
  if (!pattern) return []
  const matches: Match[] = []

  const lines = text.split('\n')
  for (let line = 0; line < lines.length && matches.length < limit; line++) {
    const raw = lines[line]!
    pattern.lastIndex = 0
    for (let hit = pattern.exec(raw); hit && matches.length < limit; hit = pattern.exec(raw)) {
      // A pattern like `a*` matches the empty string at every column; skipping
      // those (and stepping past them) is what keeps this loop finite.
      if (hit[0].length === 0) {
        pattern.lastIndex++
        continue
      }
      matches.push({ path, line, col: hit.index, length: hit[0].length, text: raw })
    }
  }
  return matches
}

// Breadth-first, so the files nearest the root are found before any limit cuts off.
function* filesUnder(root: string): Generator<string> {
  const queue: string[] = [root]
  while (queue.length > 0) {
    const dir = queue.shift()!
    for (const node of listDir(dir)) {
      if (node.isDir) {
        if (!SKIPPED_DIRS.has(node.name)) queue.push(node.path)
      } else {
        yield node.path
      }
    }
  }
}

/** Search every text file under `root`, breadth-first, stopping at the limit. */
export function searchProject(
  root: string,
  query: string,
  options: SearchOptions = {},
  limit = DEFAULT_LIMIT,
): Match[] {
  if (!query) return []
  const matches: Match[] = []

  for (const path of filesUnder(root)) {
    if (matches.length >= limit) break
    let content: string
    try {
      content = readFile(path)
    } catch {
      continue // binary or unreadable
    }
    matches.push(...searchText(content, query, path, options, limit - matches.length))
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

/** Every file under `root`, breadth-first, so the nearest ones survive the limit. */
export function listFiles(root: string, limit = 5000): string[] {
  const files: string[] = []
  for (const path of filesUnder(root)) {
    if (files.length >= limit) break
    files.push(path)
  }
  return files
}

/** Replace every occurrence, matching exactly what `searchText` matched. */
export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  options: SearchOptions = {},
): string {
  if (!query) return text
  const pattern = buildQuery(query, options)
  if (!pattern) return text
  // Function form, so `$&` and `$1` in the replacement are inserted literally.
  return text.replace(pattern, hit => (hit.length === 0 ? hit : replacement))
}

/**
 * Replace the one occurrence `match` points at, leaving every other alone.
 * A match whose line has since changed is refused rather than applied at a
 * drifted offset.
 */
export function replaceMatch(text: string, match: Match, replacement: string): string | null {
  const lines = text.split('\n')
  if (lines[match.line] !== match.text) return null
  const line = lines[match.line]!
  lines[match.line] = line.slice(0, match.col) + replacement + line.slice(match.col + match.length)
  return lines.join('\n')
}

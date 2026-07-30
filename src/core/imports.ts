/**
 * The file a path in the text points at: the token under the cursor, and where
 * that token resolves to on disk — relative, absolute, or through the aliases a
 * `tsconfig.json` / `jsconfig.json` declares (`@/foo` → `src/foo`). No Solid, no
 * OpenTUI; `test/imports.test.ts` exercises this file directly.
 *
 * Deliberately not a module resolver: nothing here walks `node_modules` or reads
 * a package's `exports`. A specifier this cannot place is handed to the language
 * server, which resolves it the way the project's own toolchain does.
 */
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const QUOTES = new Set(['"', "'", '`'])

/** What an unquoted path may be made of — anything else ends the token. */
const PATH_CHAR = /[\w@~./\\#$+-]/

/**
 * Extensions tried against a specifier that carries none, in the order a
 * bundler would: source before compiled output, so `./foo` lands on `foo.ts`
 * rather than a `foo.js` built beside it.
 */
const EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.astro',
  '.json',
  '.css',
  '.scss',
  '.md',
]

/** Nothing on the filesystem answers for these, and a URL is not a typo either. */
const URL_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** The quoted run `col` sits in — the specifier of an import, most of the time. */
function quotedAt(lineText: string, col: number): string | null {
  for (let at = 0; at < lineText.length; at++) {
    const quote = lineText[at]!
    if (!QUOTES.has(quote)) continue
    const close = lineText.indexOf(quote, at + 1)
    if (close < 0) return null
    // Inclusive of both quotes: a cursor resting on one still means the string
    // it opens, and the caret sits *before* its character.
    if (col >= at && col <= close) return lineText.slice(at + 1, close)
    at = close
  }
  return null
}

/**
 * The path-like token at `col` — a quoted specifier where there is one, else the
 * bare run of path characters around the cursor. Null when there is nothing
 * there to open.
 */
export function pathTokenAt(lineText: string, col: number): string | null {
  const quoted = quotedAt(lineText, col)
  if (quoted !== null) return quoted.trim() || null

  const at = Math.max(0, Math.min(col, lineText.length))
  let start = at
  while (start > 0 && PATH_CHAR.test(lineText[start - 1]!)) start--
  let end = at
  while (end < lineText.length && PATH_CHAR.test(lineText[end]!)) end++
  // Sentence punctuation belongs to the prose around a path, not to the path —
  // `see src/core/fs.ts.` names a file that exists, with a full stop after it.
  const token = lineText.slice(start, end).replace(/[.,;:]+$/, '')
  return token || null
}

/** `candidate` itself, the same name with an extension, or its index file. */
function fileAt(candidate: string): string | null {
  if (isFile(candidate)) return candidate
  for (const ext of EXTENSIONS) {
    if (isFile(candidate + ext)) return candidate + ext
  }
  for (const ext of EXTENSIONS) {
    const index = join(candidate, `index${ext}`)
    if (isFile(index)) return index
  }
  return null
}

type Json = Record<string, unknown>

const objectAt = (value: unknown): Json | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null

/**
 * JSON with what tsconfig files actually hold: comments and trailing commas,
 * neither of which `JSON.parse` accepts. One pass, because stripping comments
 * with a regex would also gut any string holding a slash pair — a `paths` entry
 * mapping onto a URL-ish target is not far off.
 */
function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!
    if (inString) {
      out += char
      if (char === '\\') out += text[++at] ?? ''
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === '/' && text[at + 1] === '/') {
      while (at < text.length && text[at] !== '\n') at++
      out += '\n'
      continue
    }
    if (char === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2)
      at = end < 0 ? text.length : end + 1
      continue
    }
    if (
      char === ',' &&
      (nextMeaningful(text, at + 1) === '}' || nextMeaningful(text, at + 1) === ']')
    )
      continue
    out += char
  }
  return JSON.parse(out)
}

/** The next character that is neither whitespace nor comment, or '' at the end. */
function nextMeaningful(text: string, from: number): string {
  for (let at = from; at < text.length; at++) {
    const char = text[at]!
    if (/\s/.test(char)) continue
    if (char === '/' && text[at + 1] === '/') {
      while (at < text.length && text[at] !== '\n') at++
      continue
    }
    if (char === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2)
      if (end < 0) return ''
      at = end + 1
      continue
    }
    return char
  }
  return ''
}

/** A project's alias map, as the config that declared it means it. */
interface Aliases {
  /** What `paths` entries are relative to: `baseUrl`, else the config's folder. */
  base: string
  paths: Record<string, string[]>
  /** Set only when the config has one; a bare specifier resolves against it. */
  baseUrl: string | null
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const list = value.filter((entry): entry is string => typeof entry === 'string')
  return list.length > 0 ? list : null
}

/**
 * The alias map `file` supplies, following a *relative* `extends` when it has
 * none of its own. A package-name `extends` is not followed: resolving it means
 * walking `node_modules`, which is the job this module leaves to the server.
 */
function loadAliases(file: string, depth = 0): Aliases | null {
  if (depth > 4 || !isFile(file)) return null
  let json: unknown
  try {
    json = parseJsonc(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  const root = objectAt(json)
  if (!root) return null
  const dir = dirname(file)
  const options = objectAt(root.compilerOptions) ?? {}
  const baseUrl = typeof options.baseUrl === 'string' ? resolve(dir, options.baseUrl) : null
  const declared = objectAt(options.paths)
  const paths: Record<string, string[]> = {}
  for (const [pattern, targets] of Object.entries(declared ?? {})) {
    const list = stringList(targets)
    if (list) paths[pattern] = list
  }
  if (Object.keys(paths).length > 0 || baseUrl) {
    return { base: baseUrl ?? dir, paths, baseUrl }
  }
  const extend = root.extends
  if (typeof extend !== 'string' || !extend.startsWith('.')) return null
  // `.json` and nothing else: `extends: "./tsconfig.base"` has an extension as
  // far as `extname` is concerned, and the file it names is `tsconfig.base.json`.
  const parent = resolve(dir, extend.endsWith('.json') ? extend : `${extend}.json`)
  return loadAliases(parent, depth + 1)
}

/**
 * Every place `spec` could land through the project's aliases. TypeScript's own
 * rule: at most one `*` per pattern, the longest matching prefix winning — which
 * only matters when two patterns match, so the candidates are simply tried in
 * that order.
 */
function aliasCandidates(spec: string, rootDir: string): string[] {
  const aliases =
    loadAliases(join(rootDir, 'tsconfig.json')) ?? loadAliases(join(rootDir, 'jsconfig.json'))
  if (!aliases) return []
  const candidates: { length: number; path: string }[] = []
  for (const [pattern, targets] of Object.entries(aliases.paths)) {
    const star = pattern.indexOf('*')
    if (star < 0) {
      if (pattern === spec) {
        candidates.push(...targets.map(target => ({ length: pattern.length, path: target })))
      }
      continue
    }
    const prefix = pattern.slice(0, star)
    const suffix = pattern.slice(star + 1)
    if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) continue
    if (spec.length < prefix.length + suffix.length) continue
    const middle = spec.slice(prefix.length, spec.length - suffix.length)
    candidates.push(
      ...targets.map(target => ({ length: prefix.length, path: target.replace('*', middle) })),
    )
  }
  const resolved = candidates
    .toSorted((a, b) => b.length - a.length)
    .map(candidate => resolve(aliases.base, candidate.path))
  // `baseUrl` alone makes every path under it importable by name, which is how
  // a project with no `paths` at all still writes `src/core/fs`.
  if (aliases.baseUrl) resolved.push(resolve(aliases.baseUrl, spec))
  return resolved
}

/**
 * The file `spec` names, or null. Tried in the order that costs least and is
 * least likely to be wrong: the folder holding the file it was written in, then
 * the project root, then the project's aliases.
 */
export function resolveImportPath(spec: string, fromDir: string, rootDir: string): string | null {
  const token = spec.trim()
  if (!token || URL_SCHEME.test(token)) return null

  const direct = token.startsWith('~/')
    ? [join(homedir(), token.slice(2))]
    : isAbsolute(token)
      ? [token]
      : [resolve(fromDir, token), resolve(rootDir, token)]
  for (const candidate of direct) {
    const found = fileAt(candidate)
    if (found) return found
  }

  // An alias never starts with `.` or `/`: those forms have had their answer.
  if (token.startsWith('.') || token.startsWith('~/') || isAbsolute(token)) return null
  for (const candidate of aliasCandidates(token, rootDir)) {
    const found = fileAt(candidate)
    if (found) return found
  }
  return null
}

/**
 * Reading a `extension.json` into contributions druk can register.
 *
 * Manifests are data, never code: an extension is a JSON file, so installing one
 * cannot run anything and the compiled binary needs no loader. That is the
 * whole trade — an extension adds languages, language servers, themes and icon
 * themes, and nothing else, which is what these four lists are for. It adds
 * them from *one* of the two families, never both: a language extension and an
 * appearance extension are installed for different reasons and change on different
 * schedules.
 *
 * Every field is validated here rather than where it is used. A malformed entry
 * costs its extension that one contribution and a reported problem; it never costs
 * the extension its other contributions, and it can never break startup.
 */
import { join } from 'node:path'

import type { StyleDefinitionInput } from '@opentui/core'

import type { IconEntry, IconTheme } from '../icons'
import type { Language } from '../languages'
import { GRAMMARS } from '../languages/grammars'
import type { ServerInstall, ServerSpec } from '../lsp/servers'
import { THEMES } from '../themes'
import type { Theme, ThemeUi } from '../themes'
import type { Extension, ExtensionProblem } from './types'

/** Read off a shipped theme, so a new chrome color needs no second list here. */
const UI_KEYS = Object.keys(THEMES.dark.ui) as (keyof ThemeUi)[]

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)

const text = (raw: unknown): string | null => (typeof raw === 'string' && raw ? raw : null)

const isColor = (raw: unknown): raw is string =>
  typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw)

const stringList = (raw: unknown): string[] | null =>
  Array.isArray(raw) && raw.length > 0 && raw.every(part => typeof part === 'string' && part)
    ? (raw as string[])
    : null

/** Ids name files and config keys, so they are held to what a file name may be. */
const isId = (raw: unknown): raw is string => typeof raw === 'string' && /^[\w.-]+$/.test(raw)

function parseTheme(
  raw: unknown,
  fail: (reason: string) => void,
): { id: string; theme: Theme } | null {
  if (!isRecord(raw)) {
    fail('a theme must be an object')
    return null
  }
  const id = raw.id
  if (!isId(id)) {
    fail(`theme id ${JSON.stringify(raw.id)} is not a name`)
    return null
  }
  if (!isRecord(raw.ui)) {
    fail(`theme "${id}" has no ui colors`)
    return null
  }
  const ui = {} as ThemeUi
  for (const key of UI_KEYS) {
    const color = raw.ui[key]
    if (!isColor(color)) {
      fail(`theme "${id}" needs a #rrggbb ${key}`)
      return null
    }
    ui[key] = color
  }
  if (!isRecord(raw.syntax)) {
    fail(`theme "${id}" has no syntax groups`)
    return null
  }
  const syntax: Theme['syntax'] = {}
  for (const [group, style] of Object.entries(raw.syntax)) {
    if (!isRecord(style)) {
      fail(`theme "${id}": syntax group "${group}" is not an object`)
      continue
    }
    const parsed: StyleDefinitionInput = {}
    if (isColor(style.fg)) parsed.fg = style.fg
    if (isColor(style.bg)) parsed.bg = style.bg
    if (typeof style.bold === 'boolean') parsed.bold = style.bold
    if (typeof style.italic === 'boolean') parsed.italic = style.italic
    if (typeof style.underline === 'boolean') parsed.underline = style.underline
    if (typeof style.dim === 'boolean') parsed.dim = style.dim
    syntax[group] = parsed
  }
  return { id, theme: { name: text(raw.name) ?? id, ui, syntax } }
}

/**
 * Codepoints a terminal draws two cells wide — CJK, the fullwidth forms, and
 * everything from the emoji planes up. Not exhaustive and does not need to be:
 * it covers what someone reaches for when writing an icon theme, and the rest
 * of the BMP is one cell.
 */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]|[\u{1F000}-\u{10FFFF}]/u

/**
 * One glyph, or a glyph with a color. Held to a single *cell*: the tree gives
 * the icon the column the arrow had, and a wider glyph shifts every name in the
 * panel by one — which is why an emoji is refused rather than drawn.
 */
function parseIcon(raw: unknown): IconEntry | null {
  const glyph = typeof raw === 'string' ? raw : isRecord(raw) ? raw.glyph : null
  if (typeof glyph !== 'string') return null
  if ([...glyph].length !== 1 || WIDE.test(glyph)) return null
  const color = isRecord(raw) && isColor(raw.color) ? raw.color : undefined
  return color ? { glyph, color } : { glyph }
}

function parseIconMap(raw: unknown): Record<string, IconEntry> {
  const map: Record<string, IconEntry> = {}
  if (!isRecord(raw)) return map
  for (const [key, value] of Object.entries(raw)) {
    const icon = parseIcon(value)
    if (icon) map[key.toLowerCase().replace(/^\./, '')] = icon
  }
  return map
}

const FALLBACK: Record<'file' | 'folder' | 'folderOpen', IconEntry> = {
  file: { glyph: '·' },
  folder: { glyph: '▸' },
  folderOpen: { glyph: '▾' },
}

function parseIconTheme(raw: unknown, fail: (reason: string) => void): IconTheme | null {
  if (!isRecord(raw)) {
    fail('an icon theme must be an object')
    return null
  }
  const id = raw.id
  if (!isId(id)) {
    fail(`icon theme id ${JSON.stringify(raw.id)} is not a name`)
    return null
  }
  return {
    id,
    name: text(raw.name) ?? id,
    // The three defaults are what a theme that only maps extensions falls back
    // to; without them such a theme would draw nothing on most rows.
    file: parseIcon(raw.file) ?? FALLBACK.file,
    folder: parseIcon(raw.folder) ?? FALLBACK.folder,
    folderOpen: parseIcon(raw.folderOpen) ?? parseIcon(raw.folder) ?? FALLBACK.folderOpen,
    names: parseIconMap(raw.names),
    extensions: parseIconMap(raw.extensions),
    folders: parseIconMap(raw.folders),
  }
}

/**
 * How a server is obtained, as a manifest spells it.
 *
 * `download` takes either one `url` or a `urls` map keyed by
 * `<platform>-<arch>` — a release that ships a binary per machine, which is
 * common and which static data has to describe somehow. The current machine is
 * resolved here rather than at install time, so an extension that has no build for
 * it falls back to the `command` it also carries and the user is told what to
 * fetch by hand instead of being offered a URL that 404s.
 */
function parseInstall(raw: unknown): ServerInstall | undefined {
  if (!isRecord(raw)) return undefined
  const command = text(raw.command)
  if (raw.kind === 'npm') {
    const packages = stringList(raw.packages)
    return packages ? { kind: 'npm', packages } : undefined
  }
  if (raw.kind === 'download') {
    const url = text(raw.url)
    if (url) return { kind: 'download', url }
    const forMachine = isRecord(raw.urls)
      ? text(raw.urls[`${process.platform}-${process.arch}`])
      : null
    if (forMachine) return { kind: 'download', url: forMachine }
    return command ? { kind: 'manual', command } : undefined
  }
  if (raw.kind === 'manual' && command) return { kind: 'manual', command }
  return undefined
}

function parseServer(raw: unknown, fail: (reason: string) => void): ServerSpec | null {
  if (!isRecord(raw)) {
    fail('a language server must be an object')
    return null
  }
  const id = raw.id
  if (!isId(id)) {
    fail(`server id ${JSON.stringify(raw.id)} is not a name`)
    return null
  }
  const command = stringList(raw.command)
  if (!command) {
    fail(`server "${id}" needs a command, e.g. ["nimlangserver"]`)
    return null
  }
  const filetypes = stringList(raw.filetypes)
  if (!filetypes) {
    fail(`server "${id}" needs the filetypes it serves`)
    return null
  }
  const install = parseInstall(raw.install)
  return install ? { id, command, filetypes, install } : { id, command, filetypes }
}

/** A relative path inside the extension's own folder — never an escape from it. */
function assetPath(raw: unknown): string | null {
  const value = text(raw)
  if (!value) return null
  if (value.startsWith('/') || value.includes('..') || /^[a-z]+:/i.test(value)) return null
  return value
}

/**
 * One language: which grammar highlights it, and the names that resolve to it.
 *
 * A grammar comes from one of three places — the ones druk vendors (`vendored`,
 * embedded in the binary, so installing that extension downloads no wasm at all),
 * OpenTUI's own (`bundled`), or the extension's folder (`wasm` + `query`, which is
 * how a language druk never heard of arrives). `collect` records the relative
 * paths so the market knows what to fetch beside the manifest.
 */
function parseLanguage(
  raw: unknown,
  fail: (reason: string) => void,
  ctx: { dir?: string; collect: (path: string) => void },
): Language | null {
  if (!isRecord(raw)) {
    fail('a language must be an object')
    return null
  }
  const id = raw.id
  if (!isId(id)) {
    fail(`language id ${JSON.stringify(raw.id)} is not a name`)
    return null
  }
  const language: Language = { id }
  const label = text(raw.label)
  if (label) language.label = label
  const lineComment = text(raw.lineComment)
  if (lineComment) language.lineComment = lineComment

  const grammar = isRecord(raw.grammar) ? raw.grammar : null
  if (grammar) {
    const vendored = text(grammar.vendored)
    if (vendored) {
      const known = GRAMMARS[vendored as keyof typeof GRAMMARS]
      if (!known) {
        fail(`language "${id}": druk ships no "${vendored}" grammar`)
        return null
      }
      language.wasm = known.wasm
      language.query = known.query
    } else if (grammar.bundled === true) {
      language.bundled = true
    } else {
      const wasm = assetPath(grammar.wasm)
      const query = assetPath(grammar.query)
      if (!wasm || !query) {
        fail(`language "${id}": a grammar needs "vendored", "bundled", or wasm + query`)
        return null
      }
      ctx.collect(wasm)
      ctx.collect(query)
      // Absolute once the folder is known, which is what the parser is handed;
      // left relative for a manifest read off the wire, whose files are not on
      // disk yet — the market resolves them when it writes the folder.
      language.wasm = ctx.dir ? join(ctx.dir, wasm) : wasm
      language.query = ctx.dir ? join(ctx.dir, query) : query
    }
  }

  if (Array.isArray(raw.patterns)) {
    const patterns: NonNullable<Language['patterns']> = []
    for (const entry of raw.patterns) {
      if (!isRecord(entry)) continue
      const group = text(entry.group)
      const source = text(entry.re)
      if (!group || !source) {
        fail(`language "${id}": a pattern needs a group and a regex`)
        return null
      }
      try {
        // `g` always: `highlightWithPatterns` walks matches with lastIndex, and
        // a non-global regex there loops on the first match forever.
        const flags = text(entry.flags) ?? ''
        patterns.push({ group, re: new RegExp(source, flags.includes('g') ? flags : `${flags}g`) })
      } catch (error) {
        fail(`language "${id}": ${error instanceof Error ? error.message : String(error)}`)
        return null
      }
    }
    if (patterns.length > 0) language.patterns = patterns
  }

  if (!language.wasm && !language.bundled && !language.patterns) {
    fail(`language "${id}" has neither a grammar nor patterns`)
    return null
  }

  const extensions = stringList(raw.extensions)
  if (extensions) language.extensions = extensions
  const filenames = stringList(raw.filenames)
  if (filenames) language.filenames = filenames
  const pattern = text(raw.filenamePattern)
  if (pattern) {
    try {
      language.filenamePattern = new RegExp(pattern)
    } catch (error) {
      fail(`language "${id}": ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }
  return language
}

/**
 * A manifest as contributions. `null` for one druk cannot use at all — anything
 * short of that is an extension with a problem beside it.
 *
 * `dir` is the folder the manifest was read from, when there is one: it is what
 * turns a relative asset into a path the parser can open. A manifest fetched
 * from the market has no folder yet, and its assets stay relative for the
 * installer to place.
 */
export function parseManifest(
  raw: unknown,
  source: string,
  dir?: string,
): { extension: Extension | null; problems: ExtensionProblem[] } {
  const problems: ExtensionProblem[] = []
  const fail = (reason: string) => void problems.push({ source, reason })
  if (!isRecord(raw)) {
    fail('not a JSON object')
    return { extension: null, problems }
  }
  const id = raw.id
  if (!isId(id)) {
    fail(`id ${JSON.stringify(raw.id)} is missing, or is not a name`)
    return { extension: null, problems }
  }
  const assets: string[] = []
  const collect = (path: string) => void (assets.includes(path) || assets.push(path))
  const list = (value: unknown) => (Array.isArray(value) ? value : [])
  const themes = list(raw.themes)
    .map(entry => parseTheme(entry, fail))
    .filter(entry => entry !== null)
  const icons = list(raw.icons)
    .map(entry => parseIconTheme(entry, fail))
    .filter(entry => entry !== null)
  const languages = list(raw.languages)
    .map(entry => parseLanguage(entry, fail, { dir, collect }))
    .filter(entry => entry !== null)
  const servers = list(raw.languageServers)
    .map(entry => parseServer(entry, fail))
    .filter(entry => entry !== null)
  // An extension is about a language or about how the editor looks, never both: the
  // two are installed for different reasons and updated on different schedules,
  // and a Go extension that also repaints the editor is not one anybody asked for.
  if (themes.length + icons.length > 0 && languages.length + servers.length > 0) {
    fail(`"${id}" mixes themes with languages — an extension is one or the other`)
    return { extension: null, problems }
  }
  if (themes.length === 0 && icons.length === 0 && languages.length === 0 && servers.length === 0) {
    fail(`"${id}" contributes nothing druk can use`)
  }
  return {
    extension: {
      id,
      name: text(raw.name) ?? id,
      version: text(raw.version) ?? '0.0.0',
      description: text(raw.description) ?? '',
      source,
      disabled: false,
      builtin: false,
      themes,
      icons,
      languages,
      servers,
      assets,
    },
    problems,
  }
}

/** The one-line summary the palette and the settings page show. */
export function contributionSummary(extension: Extension): string {
  const counts = [
    [extension.themes.length, 'theme'],
    [extension.icons.length, 'icon theme'],
    [extension.languages.length, 'language'],
    [extension.servers.length, 'server'],
  ] as const
  const parts = counts
    .filter(([count]) => count > 0)
    .map(([count, noun]) => `${count} ${noun}${count === 1 ? '' : 's'}`)
  return parts.join(', ') || 'nothing'
}

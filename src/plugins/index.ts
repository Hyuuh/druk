/**
 * Plugins — languages, language servers, themes and icon themes. Nearly
 * everything extensible druk can do arrives through here, including what it
 * ships itself.
 *
 * A plugin is a JSON manifest and the files it names: `plugin.json` in a folder
 * under `$XDG_CONFIG_HOME/druk/plugins/`, or a bare `<name>.json` in that folder
 * for one that needs no files at all. A project may carry its own in
 * `<project>/.druk/plugins/`, the way it carries its own settings. `./builtin.ts`
 * holds the manifests compiled into the binary; a copy on disk with the same id
 * replaces one of those, which is how the market updates it.
 *
 * Data, deliberately. Installing a plugin runs no code, so a shared theme pack
 * is as safe to drop in as a config file, and the compiled binary needs no
 * module loader — `bun build --compile` embeds what it can see at build time,
 * which a plugin by definition is not.
 *
 * Load order matters: the registries here back the config validators
 * (`isThemeName`, `isIconThemeName`), so `loadPlugins` has to run before the
 * config is read or a plugin theme in the config would be rejected as unknown.
 * `main.tsx` is where that order lives.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { createSignal } from 'solid-js'

import { CONFIG_FILE, PROJECT_CONFIG_DIR } from '../core/config'
import { clearPluginIconThemes, registerIconTheme } from '../icons'
import { clearPluginLanguages, registerLanguage } from '../languages'
import { clearPluginServers, registerServer } from '../lsp/servers'
import { clearPluginThemes, registerTheme } from '../themes'
import { builtinPlugins } from './builtin'
import { parseManifest } from './manifest'
import type { Plugin, PluginLoad, PluginProblem } from './types'

export type { Plugin, PluginLoad, PluginProblem }
export { contributionSummary, parseManifest } from './manifest'

/** Beside `config.json`, so one folder holds everything druk reads. */
export const PLUGINS_DIR = join(dirname(CONFIG_FILE), 'plugins')

export const projectPluginsDir = (rootDir: string): string =>
  join(rootDir, PROJECT_CONFIG_DIR, 'plugins')

const MANIFEST = 'plugin.json'

/** Every manifest in one plugins folder: `<id>.json`, and `<id>/plugin.json`. */
function manifestsIn(dir: string): string[] {
  let entries: { name: string; isDir: boolean }[]
  try {
    entries = readdirSync(dir, { withFileTypes: true }).map(entry => ({
      name: entry.name,
      isDir: entry.isDirectory(),
    }))
  } catch {
    return [] // no plugins folder is the normal case, not a problem to report
  }
  return entries
    .filter(entry =>
      // `index.json` is the market's catalog, not a plugin. It only turns up in a
      // plugins folder someone copied the market into, and reading it as a
      // one-file plugin reports a problem about a file that is doing its job.
      entry.isDir ? true : entry.name.endsWith('.json') && entry.name !== 'index.json',
    )
    .map(entry => (entry.isDir ? join(dir, entry.name, MANIFEST) : join(dir, entry.name)))
    .toSorted()
}

// A signal: the settings page lists these, so a reload has to repaint it.
const [loaded, setLoaded] = createSignal<PluginLoad>({ plugins: [], problems: [] })

/** What the last load found — the palette's list and the settings page read this. */
export const plugins = (): Plugin[] => loaded().plugins

/** Manifests that were wrong about something. `App` reports one on startup. */
export const pluginProblems = (): PluginProblem[] => loaded().problems

/**
 * Read every manifest and register what it contributes, replacing whatever the
 * previous load registered — this is also the reload path, so it must leave no
 * theme or server behind from a plugin that has since been deleted.
 *
 * A disabled plugin is still read and listed: the settings page needs its name
 * and its contributions to offer it back, and reading a manifest costs one small
 * file.
 */
export function loadPlugins(
  rootDir: string,
  disabled: string[] = [],
  /** The user's plugins folder. A parameter only so a test can point elsewhere. */
  userDir = PLUGINS_DIR,
): PluginLoad {
  clearPluginThemes()
  clearPluginIconThemes()
  clearPluginLanguages()
  clearPluginServers()

  const off = new Set(disabled)
  const problems: PluginProblem[] = []
  /** By id, so a copy on disk replaces the one baked into the binary. */
  const found = new Map<string, Plugin>()

  for (const plugin of builtinPlugins()) found.set(plugin.id, plugin)

  for (const source of [...manifestsIn(userDir), ...manifestsIn(projectPluginsDir(rootDir))]) {
    // A folder without a manifest is someone's stray directory, not a plugin —
    // checked before the read so a manifest that *is* there and is malformed
    // still gets reported rather than looking like an absent one.
    if (!existsSync(source)) continue
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(source, 'utf8'))
    } catch (error) {
      problems.push({ source, reason: error instanceof Error ? error.message : String(error) })
      continue
    }
    const parsed = parseManifest(raw, source, dirname(source))
    problems.push(...parsed.problems)
    const plugin = parsed.plugin
    if (!plugin) continue
    const held = found.get(plugin.id)
    // Shadowing a built-in is the update path — the market's copy of a plugin
    // druk ships is how it gets a newer version — but two on disk is a mistake
    // someone has to be told about, since which one wins is a directory listing.
    if (held && !held.builtin) {
      problems.push({ source, reason: `"${plugin.id}" is already loaded from ${held.source}` })
      continue
    }
    found.set(plugin.id, plugin)
  }

  const list = [...found.values()]
  for (const plugin of list) {
    plugin.disabled = off.has(plugin.id)
    if (plugin.disabled) continue
    for (const { id, theme } of plugin.themes) registerTheme(id, theme)
    for (const icons of plugin.icons) registerIconTheme(icons)
    for (const language of plugin.languages) registerLanguage(language)
    for (const server of plugin.servers) registerServer(server)
  }

  const load = { plugins: list, problems }
  setLoaded(load)
  return load
}

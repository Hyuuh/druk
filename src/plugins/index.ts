/**
 * Plugins — themes, icon themes and language servers druk did not ship.
 *
 * A plugin is a JSON manifest and nothing else: `plugin.json` in a folder under
 * `$XDG_CONFIG_HOME/druk/plugins/`, or a bare `<name>.json` in that folder for
 * a plugin that is only a theme. A project may carry its own in
 * `<project>/.druk/plugins/`, the way it carries its own settings.
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
import { clearPluginServers, registerServer } from '../lsp/servers'
import { clearPluginThemes, registerTheme } from '../themes'
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
    .filter(entry => (entry.isDir ? true : entry.name.endsWith('.json')))
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
export function loadPlugins(rootDir: string, disabled: string[] = []): PluginLoad {
  clearPluginThemes()
  clearPluginIconThemes()
  clearPluginServers()

  const off = new Set(disabled)
  const found: Plugin[] = []
  const problems: PluginProblem[] = []
  const seen = new Map<string, string>()

  for (const source of [...manifestsIn(PLUGINS_DIR), ...manifestsIn(projectPluginsDir(rootDir))]) {
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
    const parsed = parseManifest(raw, source)
    problems.push(...parsed.problems)
    const plugin = parsed.plugin
    if (!plugin) continue
    const held = seen.get(plugin.id)
    if (held) {
      problems.push({ source, reason: `"${plugin.id}" is already loaded from ${held}` })
      continue
    }
    seen.set(plugin.id, source)
    plugin.disabled = off.has(plugin.id)
    found.push(plugin)
    if (plugin.disabled) continue
    for (const { id, theme } of plugin.themes) registerTheme(id, theme)
    for (const icons of plugin.icons) registerIconTheme(icons)
    for (const server of plugin.servers) registerServer(server)
  }

  const load = { plugins: found, problems }
  setLoaded(load)
  return load
}

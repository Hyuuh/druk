/**
 * The plugins that ship inside the binary.
 *
 * Same manifests as the market's — these are `plugins/<id>/plugin.json` in this
 * repository, imported as JSON so `bun build --compile` inlines them. Nothing
 * else distinguishes a preinstalled plugin: it is listed, it can be disabled,
 * and installing the market's copy of the same id replaces it, which is how a
 * built-in plugin gets an update.
 *
 * What is here is a judgement about a first run: the languages most projects
 * open, so a fresh druk highlights code with no network and no installs. Every
 * other language is a plugin away, and costs one small JSON to fetch — the
 * grammars themselves are embedded either way (`src/languages/grammars.ts`),
 * since a wasm cannot be downloaded into a running tree-sitter worker.
 *
 * The static imports are the point. A computed path resolves to nothing inside
 * the compiled binary, so this list is deliberately spelled out rather than
 * globbed from the folder.
 */
import cssManifest from '../../plugins/css/plugin.json'
import htmlManifest from '../../plugins/html/plugin.json'
import jsonManifest from '../../plugins/json/plugin.json'
import markdownManifest from '../../plugins/markdown/plugin.json'
import tomlManifest from '../../plugins/toml/plugin.json'
import typescriptManifest from '../../plugins/typescript/plugin.json'
import yamlManifest from '../../plugins/yaml/plugin.json'
import { parseManifest } from './manifest'
import type { Plugin } from './types'

const MANIFESTS: unknown[] = [
  typescriptManifest,
  jsonManifest,
  markdownManifest,
  htmlManifest,
  cssManifest,
  yamlManifest,
  tomlManifest,
]

/** Where a built-in says it came from, since there is no file to point at. */
export const BUILTIN_SOURCE = 'built in'

let parsed: Plugin[] | null = null

/**
 * The embedded plugins, parsed once.
 *
 * A problem here is druk's own bug, not a user's, so it is dropped rather than
 * reported: `test/plugins-repo.test.ts` parses every manifest in the repository
 * and fails the build, which is where a broken one is caught.
 */
export function builtinPlugins(): Plugin[] {
  parsed ??= MANIFESTS.map(raw => parseManifest(raw, BUILTIN_SOURCE).plugin)
    .filter(plugin => plugin !== null)
    .map(plugin => ({ ...plugin, builtin: true }))
  return parsed
}

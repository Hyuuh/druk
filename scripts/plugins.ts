/**
 * Regenerate `plugins/index.json` — the market's catalog.
 *
 * Every manifest goes through `parseManifest`, the editor's own validator, so a
 * plugin that druk could not use cannot reach the index; the run fails instead.
 * `test/plugins-repo.test.ts` asserts the committed index equals what this
 * writes, which is what makes forgetting `bun run plugins` a failing check
 * rather than a market that quietly lists the wrong version.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { entryFor } from '../src/core/market'
import type { MarketEntry } from '../src/core/market'
import { parseManifest } from '../src/plugins/manifest'
import type { Plugin } from '../src/plugins/types'

export const MARKET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins')
export const INDEX_FILE = join(MARKET_DIR, 'index.json')

/** Every plugin folder in the market, in the order the index lists them. */
export function marketIds(dir = MARKET_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .toSorted()
}

/**
 * Every market manifest, parsed. Throws on one druk would reject — a plugin that
 * loses a contribution to a typo must not reach the index looking complete.
 */
export function readMarket(dir = MARKET_DIR): Plugin[] {
  return marketIds(dir).map(id => {
    const source = join(dir, id, 'plugin.json')
    const { plugin, problems } = parseManifest(JSON.parse(readFileSync(source, 'utf8')), source)
    if (!plugin) throw new Error(`${id}: ${problems[0]?.reason ?? 'not a plugin'}`)
    if (problems.length > 0) throw new Error(`${id}: ${problems[0]!.reason}`)
    if (plugin.id !== id) throw new Error(`${id}: manifest declares itself "${plugin.id}"`)
    return plugin
  })
}

/** The catalog the market folder describes. */
export function buildIndex(dir = MARKET_DIR): { plugins: MarketEntry[] } {
  return { plugins: readMarket(dir).map(entryFor) }
}

const serialize = (index: { plugins: MarketEntry[] }): string =>
  `${JSON.stringify(index, null, 2)}\n`

if (import.meta.main) {
  const index = buildIndex()
  writeFileSync(INDEX_FILE, serialize(index))
  process.stdout.write(`wrote plugins/index.json — ${index.plugins.length} plugins\n`)
}

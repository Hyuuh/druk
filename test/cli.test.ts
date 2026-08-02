import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'

import { MARKET_DIR } from '../scripts/extensions'
import { flagOutput } from '../src/core/cli'
import { loadExtensions } from '../src/extensions'
import { vendoredLanguages } from '../src/languages'
import { GRAMMARS } from '../src/languages/grammars'

describe('flags', () => {
  test('--version prints a bare version, which the installers compare against', () => {
    // `install` and the Homebrew formula both parse this exact output.
    expect(flagOutput('--version')).toMatch(/^\d+\.\d+\.\d+.*\n$/)
    expect(flagOutput('-v')).toBe(flagOutput('--version')!)
  })

  test('--help prints usage', () => {
    expect(flagOutput('--help')).toContain('Usage: druk [path]')
    expect(flagOutput('-h')).toBe(flagOutput('--help')!)
  })

  test('a path is not a flag', () => {
    expect(flagOutput('src')).toBeNull()
    expect(flagOutput(undefined)).toBeNull()
  })
})

describe('grammar assets', () => {
  test('every registered grammar resolves to a file that exists', () => {
    // These are `with { type: 'file' }` imports, so a wrong path is a build-time error
    // in a normal run — but the shipped binary embeds whatever they point at, and an
    // entry missing from GRAMMARS ships a language with no grammar behind it.
    for (const [name, grammar] of Object.entries(GRAMMARS)) {
      expect(`${name}: ${existsSync(grammar.wasm)}`).toBe(`${name}: true`)
      expect(`${name}: ${existsSync(grammar.query)}`).toBe(`${name}: true`)
    }
  })

  test('every vendored language points at one of them', () => {
    const known = new Set(Object.values(GRAMMARS).flatMap(g => [g.wasm, g.query]))
    loadExtensions(process.env.XDG_CONFIG_HOME!, [], MARKET_DIR)
    for (const lang of vendoredLanguages()) {
      expect(`${lang.id}: ${known.has(lang.wasm!) && known.has(lang.query!)}`).toBe(
        `${lang.id}: true`,
      )
    }
  })
})

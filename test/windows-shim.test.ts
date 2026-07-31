import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { removeWindowsBareShim } from '../bin/windows-shim.mjs'

async function shims() {
  const prefix = await mkdtemp(join(tmpdir(), 'druk-windows-shim-'))
  for (const name of ['druk', 'druk.cmd', 'druk.ps1']) {
    writeFileSync(join(prefix, name), name)
  }
  return prefix
}

describe('Windows npm shim cleanup', () => {
  test('removes only the extensionless global shim on Windows', async () => {
    const prefix = await shims()
    try {
      removeWindowsBareShim({ platform: 'win32', global: 'true', prefix })
      expect(existsSync(join(prefix, 'druk'))).toBe(false)
      expect(existsSync(join(prefix, 'druk.cmd'))).toBe(true)
      expect(existsSync(join(prefix, 'druk.ps1'))).toBe(true)
    } finally {
      await rm(prefix, { recursive: true, force: true })
    }
  })

  test('leaves shims alone outside a Windows global install', async () => {
    const prefixes = await Promise.all([shims(), shims(), shims()])
    try {
      removeWindowsBareShim({ platform: 'linux', global: 'true', prefix: prefixes[0] })
      removeWindowsBareShim({ platform: 'win32', global: 'false', prefix: prefixes[1] })
      removeWindowsBareShim({ platform: 'win32', global: 'true', prefix: undefined })
      expect(prefixes.every(prefix => existsSync(join(prefix, 'druk')))).toBe(true)
    } finally {
      await Promise.all(prefixes.map(prefix => rm(prefix, { recursive: true, force: true })))
    }
  })

  test('does not fail when npm created no bare shim', async () => {
    const prefix = await mkdtemp(join(tmpdir(), 'druk-windows-shim-'))
    try {
      mkdirSync(join(prefix, 'node_modules'))
      expect(() =>
        removeWindowsBareShim({ platform: 'win32', global: 'true', prefix }),
      ).not.toThrow()
    } finally {
      await rm(prefix, { recursive: true, force: true })
    }
  })
})

import { describe, expect, test } from 'bun:test'

import { forLibc } from '../src/core/assets'

/**
 * A Linux binary embeds the glibc and the musl build of libopentui alike, under
 * names that are content hashes, so the DT_NEEDED string is the only thing that
 * says which is which. These stand in for a 14MB library: the same NUL-terminated
 * entry in the same .dynstr shape, and nothing else that matters.
 */
function lib(needed: string): Blob {
  return new Blob([`\0.dynstr\0${needed}\0libm.so.6\0__libc_start_main\0`])
}

const glibc = lib('libc.so.6')
const musl = lib('libc.so')

describe('picking the native library built for a libc', () => {
  test('tells the two Linux builds apart', async () => {
    expect(await forLibc([musl, glibc], 'glibc')).toBe(glibc)
    expect(await forLibc([musl, glibc], 'musl')).toBe(musl)
  })

  test("glibc's entry is not read as musl's prefix", async () => {
    expect(await forLibc([glibc], 'musl')).toBeNull()
    expect(await forLibc([musl], 'glibc')).toBeNull()
  })

  // Staging a library that cannot be identified is what broke 1.12.0 on glibc
  // arm64; leaving it unstaged only costs the launch its extraction.
  test('gives up rather than guess', async () => {
    expect(await forLibc([lib('libc.musl-aarch64.so.1')], 'glibc')).toBeNull()
    expect(await forLibc([glibc, lib('libc.so.6')], 'glibc')).toBeNull()
  })
})

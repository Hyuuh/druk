/**
 * fake-lsp, but it first records the `initializationOptions` it was handed:
 * argv[2] names a file to write them to as JSON. The typescript settings test
 * asserts on that, since what a server does with those options is its business
 * and not something a frame can show.
 */
import { writeFileSync } from 'node:fs'

import { createDecoder } from '../../src/lsp/transport'

const dump = process.argv[2]!
process.stdin.on(
  'data',
  createDecoder(message => {
    if (message.method !== 'initialize') return
    const params = message.params as { initializationOptions?: unknown } | undefined
    writeFileSync(dump, JSON.stringify(params?.initializationOptions ?? null))
  }),
)

await import('./fake-lsp')

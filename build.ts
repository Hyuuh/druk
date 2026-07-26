import { cp, rm } from 'node:fs/promises'

import solidPlugin from '@opentui/solid/bun-plugin'

await rm('./dist', { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: ['./src/index.tsx'],
  target: 'bun',
  outdir: './dist',
  plugins: [solidPlugin],
  // Native FFI and wasm are resolved from node_modules at runtime, never bundled.
  external: ['@opentui/core', '@opentui/solid', 'solid-js', 'tree-sitter-wasms'],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

await cp('./src/languages/queries', './dist/queries', { recursive: true })

const bin = './dist/index.js'
const code = await Bun.file(bin).text()
if (!code.startsWith('#!')) await Bun.write(bin, `#!/usr/bin/env bun\n${code}`)
await Bun.$`chmod +x ${bin}`.quiet()

process.stdout.write(`built ${bin}\n`)

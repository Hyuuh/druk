/**
 * fake-lsp, but it first records that it was spawned at all: argv[2] names a
 * file to create. The laziness test launches with no file open and asserts the
 * marker does not appear until a matching file does.
 */
import { writeFileSync } from 'node:fs'

writeFileSync(process.argv[2]!, 'spawned')
await import('./fake-lsp')

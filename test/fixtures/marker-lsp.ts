/**
 * fake-lsp, but it first records that it was spawned at all: argv[2] names a
 * file to append a line to. The laziness test launches with no file open and
 * asserts the marker does not appear until a matching file does; the restart
 * tests count the lines, so this appends rather than writes.
 */
import { appendFileSync } from 'node:fs'

appendFileSync(process.argv[2]!, 'spawned\n')
await import('./fake-lsp')

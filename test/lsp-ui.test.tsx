import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { fixture, launch, press, runCommand, settle } from './helpers'
import type { Harness } from './helpers'

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')

/** Diagnostics cross a process boundary; re-render and check until they land. */
async function frameShows(t: Harness, needle: string, tries = 100) {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (t.captureCharFrame().includes(needle)) return true
    await settle(t, 50)
  }
  return false
}

test('diagnostics reach the status bar, the problems list, and next-problem', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE] } },
    {},
    { openFile: join(dir, 'a.ts') },
  )

  // The edit reaches the server through the debounced didChange, so this
  // exercises the whole pipeline, not just the didOpen snapshot.
  await press(t, input => void input.typeText('oops'))
  expect(await frameShows(t, '● 1')).toBe(true)

  await runCommand(t, 'List problems')
  expect(await frameShows(t, 'found oops')).toBe(true)
  expect(t.captureCharFrame()).toContain('a.ts:1:1')

  // Enter jumps to the diagnostic and closes the list.
  await press(t, input => input.pressEnter())
  expect(await frameShows(t, 'Ln 1, Col 1')).toBe(true)
  expect(t.captureCharFrame()).not.toContain('Enter jumps')

  // Next problem wraps to the same diagnostic and reads it out.
  await runCommand(t, 'Next problem')
  expect(await frameShows(t, 'found oops')).toBe(true)
}, 30_000)

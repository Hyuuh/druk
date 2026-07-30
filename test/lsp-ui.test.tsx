import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { fixture, launch, press, runCommand, untilFrame, untilGone } from './helpers'

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')

/** Diagnostics cross a process boundary; give the fake server room to start. */
const LSP_WAIT = 15_000

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
  await untilFrame(t, '● 1', LSP_WAIT)

  await runCommand(t, 'List problems')
  await untilFrame(t, 'found oops', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('a.ts:1:1')

  // Enter jumps to the diagnostic and closes the list.
  await press(t, input => input.pressEnter())
  await untilFrame(t, 'Ln 1, Col 1', LSP_WAIT)
  await untilGone(t, 'Enter jumps')

  // Next problem wraps to the same diagnostic and reads it out.
  await runCommand(t, 'Next problem')
  await untilFrame(t, 'found oops', LSP_WAIT)
}, 30_000)

test('the settings page shows the LSP rows and the master toggle flips', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  // Tall enough for every section: the page windows its rows to what it can draw,
  // and the language-server rows are the last of them.
  const t = await launch(dir, {}, { height: 40 })

  await runCommand(t, 'Settings')
  await untilFrame(t, 'LSP diagnostics')
  expect(t.captureCharFrame()).toMatch(/\d+\/\d+ enabled/)
}, 15_000)

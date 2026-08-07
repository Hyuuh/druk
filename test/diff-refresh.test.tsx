import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  fixture,
  launch,
  openDiff,
  press,
  pressEscape,
  runCommand,
  settle,
  untilFrame,
  untilGone,
} from './helpers'
import type { Harness } from './helpers'

const run = (dir: string, ...args: string[]) => {
  const result = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

/** Two committed files, both changed since — the panel's cursor pages them. */
function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  run(dir, 'init', '-q')
  run(dir, 'config', 'user.email', 'druk@test')
  run(dir, 'config', 'user.name', 'druk')
  run(dir, 'config', 'commit.gpgsign', 'false')
  run(dir, 'add', '.')
  run(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  writeFileSync(join(dir, 'b.ts'), 'beta changed\n')
  return dir
}

const frame = (t: Harness) => t.captureCharFrame()

/** The panel's first change row, under the tab strip, the view tabs and the header. */
const FIRST_ROW = 3

test('Esc closes the diff opened from the panel, not the panel under it', async () => {
  const t = await launch(repo())
  await runCommand(t, 'Source control')
  await t.mockMouse.click(4, FIRST_ROW)
  await untilFrame(t, 'alpha changed')

  await pressEscape(t)
  const after = frame(t)
  expect(after).not.toContain('alpha changed')
  // The panel is still the sidebar's view: only the page it opened went away.
  expect(after).toContain('◆ review')
})

test('a commit elsewhere closes the page for the file it committed', async () => {
  const dir = repo()
  const t = await launch(dir)
  await openDiff(t)
  await untilFrame(t, 'alpha changed')

  run(dir, 'add', 'a.ts')
  run(dir, 'commit', '-qm', 'just a')
  await untilGone(t, 'alpha changed')

  // a.ts lost its row in the panel, so the page it opened goes with it. b.ts is
  // still changed and still listed — nothing has pointed the cursor at it.
  expect(frame(t)).toContain('b.ts')
})

test('an edit elsewhere to the open file rebuilds the page against HEAD', async () => {
  const dir = repo()
  const t = await launch(dir)
  // The file has to be an open tab: that is what the watcher reloads, and the
  // reload is what tells the page to re-read.
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await openDiff(t)
  await untilFrame(t, 'alpha changed')

  writeFileSync(join(dir, 'a.ts'), 'alpha rewritten\n')
  await untilFrame(t, 'alpha rewritten')

  expect(frame(t)).not.toContain('alpha changed')
})

test('the diff closes itself once nothing is left to show', async () => {
  const dir = repo()
  const t = await launch(dir)
  await openDiff(t)
  await untilFrame(t, 'alpha changed')

  run(dir, 'add', '.')
  run(dir, 'commit', '-qm', 'all of it')
  await untilGone(t, 'alpha changed')
})

test('a commit under an open diff does not throw TextBufferView is destroyed', async () => {
  // Issue #70: DiffView's deferred pane attach raced refreshDiff tearing the
  // <diff> down when an external commit removed the change. Trap the throw —
  // the page already closes in the tests above; this is the crash itself.
  const errors: Error[] = []
  const onUncaught = (err: Error) => {
    errors.push(err)
  }
  const onRejection = (reason: unknown) => {
    errors.push(reason instanceof Error ? reason : new Error(String(reason)))
  }
  process.on('uncaughtException', onUncaught)
  process.on('unhandledRejection', onRejection)
  try {
    const dir = repo()
    const t = await launch(dir)
    await openDiff(t)
    await untilFrame(t, 'alpha changed')

    for (let i = 0; i < 5; i++) {
      writeFileSync(join(dir, 'a.ts'), `alpha changed ${i}\n`)
      await settle(t, 30)
    }
    run(dir, 'add', 'a.ts')
    run(dir, 'commit', '-qm', 'agent commit')
    await untilGone(t, 'alpha changed', 3000)
    await settle(t, 200)

    expect(errors.filter(e => /TextBufferView is destroyed/i.test(e.message))).toEqual([])
  } finally {
    process.off('uncaughtException', onUncaught)
    process.off('unhandledRejection', onRejection)
  }
})

import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, settle } from './helpers'

const LINES = Number(process.env.PL ?? 20000)

test('real app: diff all on a large change', async () => {
  const dir = fixture({ 'big.ts': 'const a = 1\n' })
  const run = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  run('init', '-q')
  run('config', 'user.email', 't@t.t')
  run('config', 'user.name', 't')
  run('add', '-A')
  run('commit', '-qm', 'init')
  writeFileSync(
    join(dir, 'big.ts'),
    Array.from({ length: LINES }, (_, i) => `export const value${i} = ${i}`).join('\n') + '\n',
  )
  const diffLines = run('diff').stdout.split('\n').length
  console.log(`git diff produced ${diffLines} lines`)

  const t = await launch(dir)
  // Ctrl+P → type "diff all" → Enter
  await press(t, i => i.pressKey('p', { ctrl: true }))
  for (const ch of 'diff all') await press(t, i => i.typeText(ch))
  const t0 = performance.now()
  let crashed: unknown = null
  try {
    await press(t, i => i.pressEnter())
  } catch (e) {
    crashed = e
  }
  const ms = performance.now() - t0
  console.log(
    `RESULT diffLines=${diffLines} openMs=${ms.toFixed(0)} crashed=${crashed ? String((crashed as Error).message) : 'no'} rss=${(process.memoryUsage().rss / 1e6).toFixed(0)}MB`,
  )
  await settle(t)
  console.log(t.captureCharFrame().split('\n').slice(0, 4).join('\n'))
  expect(diffLines).toBeGreaterThan(0)
}, 300000)

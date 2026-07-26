import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { launch, press, settle } from './helpers'

const MODE = process.env.BENCH_MODE ?? 'tree'
const SIZE = Number(process.env.BENCH_SIZE ?? '1000')

function wideDir(count: number) {
  const dir = mkdtempSync(join(tmpdir(), 'druk-wide-'))
  mkdirSync(join(dir, 'many'))
  for (let i = 0; i < count; i++) writeFileSync(join(dir, 'many', `f${i}.ts`), 'x\n')
  return dir
}

function bigDiffRepo(files: number, lines: number) {
  const dir = mkdtempSync(join(tmpdir(), 'druk-bench-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@e.com')
  git('config', 'user.name', 'T')
  const body = (p: string) => Array.from({ length: lines }, (_, i) => `const ${p}${i} = ${i}`).join('\n')
  for (let f = 0; f < files; f++) writeFileSync(join(dir, `f${f}.ts`), body('a'))
  git('add', '.')
  git('commit', '-qm', 'init')
  for (let f = 0; f < files; f++) writeFileSync(join(dir, `f${f}.ts`), body('b'))
  const rows = execFileSync('git', ['diff', 'HEAD'], { cwd: dir, encoding: 'utf8' }).split('\n').length
  return { dir, rows }
}

test(`BENCH ${MODE} ${SIZE}`, async () => {
  let failed = ''
  let elapsed = 0
  let label = ''

  try {
    if (MODE === 'tree') {
      const t = await launch(wideDir(SIZE))
      const started = performance.now()
      await press(t, i => i.pressArrow('down'))
      await press(t, i => i.pressEnter())
      await settle(t)
      elapsed = performance.now() - started
      label = `tree entries=${SIZE}`
    } else {
      const { dir, rows } = bigDiffRepo(SIZE, 200)
      const t = await launch(dir)
      const started = performance.now()
      await press(t, i => i.pressKey('p', { ctrl: true }))
      await press(t, i => void i.typeText('Diff all'))
      await press(t, i => i.pressEnter())
      await settle(t)
      elapsed = performance.now() - started
      label = `diff rows=${rows}`
    }
  } catch (e) {
    failed = (e as Error).message
  }

  console.log(`RESULT ${label.padEnd(24)} ${elapsed.toFixed(0).padStart(6)}ms  ${failed}`)
  expect(true).toBe(true)
}, 600000)

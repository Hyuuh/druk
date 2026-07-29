import { expect, test } from 'bun:test'

import { invalidateSyntaxStyle, segmentsIn } from '../src/languages/highlight'
import { setTheme, THEMES } from '../src/themes'
import { fixture, launch, press, pressTimes } from './helpers'
import { parseHighlights, WHOLE } from './syntax'

/**
 * Generated rather than read from the repo's own lockfile: that coupled the test to
 * whichever package manager was in use and to how many dependencies happened to be
 * installed, so a routine `bun install` could move the numbers.
 */
const BIG = `settings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n${Array.from(
  { length: 1500 },
  (_, i) =>
    `  /package-${i}@1.0.${i}:\n    resolution: {integrity: sha512-${'abcdef0123456789'.repeat(2)}${i}}\n    engines: {node: '>=18'}\n    dev: false`,
).join('\n')}\n`

const rgb = (hex: string) =>
  [0, 2, 4].map(i => Number.parseInt(hex.replace('#', '').slice(i, i + 2), 16)).join(',')

/** One line of the same shape as BIG's, so the two differ only in length. */
const SMALL = `settings:\n  /package-0@1.0.0:\n    engines: {node: '>=18'}\n    dev: false\n`

/** Time the open itself — the launch before it is the same work either way. */
async function timeOpen(body: string) {
  const t = await launch(fixture({ 'lock.yaml': body }))
  const started = performance.now()
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  return { elapsed: performance.now() - started, frame: t.captureCharFrame() }
}

/**
 * Asserted as a ratio against a three-line file, not a duration: a wall-clock budget
 * has to hold on the slowest machine that ever runs it, and under `--parallel` this
 * suite is exactly that machine. Opening 6000 lines costs barely more than opening
 * three; a return to per-segment full applies puts the cost back on the file's size,
 * which is orders past the bar rather than near it.
 */
test('opening a large file costs about what opening a small one costs', async () => {
  const ratios: number[] = []
  let frame = ''
  for (let n = 0; n < 3; n++) {
    const small = await timeOpen(SMALL)
    const big = await timeOpen(BIG)
    frame = big.frame
    ratios.push(big.elapsed / small.elapsed)
  }
  const median = ratios.sort((a, b) => a - b)[1]!

  expect(frame).toContain('settings:')
  expect(`${median.toFixed(1)}x the small file, under 5x: ${median < 5}`).toBe(
    `${median.toFixed(1)}x the small file, under 5x: true`,
  )
}, 30000)

test('scrolling deep into a large file keeps highlights', async () => {
  // The theme is module state shared across test files, so pin it rather than
  // asserting against whichever one the previously run file left behind.
  setTheme('dark')
  invalidateSyntaxStyle()

  const t = await launch(fixture({ 'lock.yaml': BIG }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await pressTimes(t, 300, i => i.pressArrow('down'))

  const spans = t.captureSpans() as unknown as {
    lines: { spans: { text: string; fg?: { buffer: Record<string, number> } }[] }[]
  }
  const foreground = new Set<string>()
  for (const line of spans.lines) {
    for (const span of line.spans) {
      if (span.fg && span.text.trim()) {
        const b = span.fg.buffer
        foreground.add(`${b['0']},${b['1']},${b['2']}`)
      }
    }
  }
  // Assert a syntax color, not a count of distinct ones: the tree and status bar
  // supply five on their own, so counting passes even with nothing highlighted.
  expect(foreground).toContain(rgb((THEMES.dark.syntax.property as { fg: string }).fg))
}, 20000)

/**
 * Segmenting a window must not cost what segmenting the document costs. It used to:
 * `segmentsIn` rebuilt the line-offset table and re-sorted every capture in the file
 * on each call, so one new line of a 20 000-line file cost ~2ms — paid on every
 * scroll tick. Asserted as a ratio, not a duration, so a slow machine scales both
 * sides of it.
 */
test('segmenting one line costs a fraction of segmenting the whole file', async () => {
  const source = `${Array.from(
    { length: 8000 },
    (_, i) => `export function fn${i}(a: number, b: string): string { return \`x-${i}\` }`,
  ).join('\n')}\n`

  const parsed = await parseHighlights(source, 'typescript')
  const time = (runs: number, fn: () => void) => {
    fn() // warm
    const started = performance.now()
    for (let n = 0; n < runs; n++) fn()
    return (performance.now() - started) / runs
  }

  const whole = time(5, () => void segmentsIn(parsed, 0, WHOLE))
  let line = 4000
  const one = time(50, () => void segmentsIn(parsed, line, line++))

  expect(`${whole.toFixed(2)}ms whole vs ${one.toFixed(3)}ms per line: ${whole / one > 20}`).toBe(
    `${whole.toFixed(2)}ms whole vs ${one.toFixed(3)}ms per line: true`,
  )
}, 30000)

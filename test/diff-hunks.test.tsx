import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  launch,
  openDiff,
  press,
  pressEscape,
  until,
  untilFrame,
  untilGone,
} from './helpers'
import { git, initRepo } from './repo'
import { tempDir } from './temp'

interface Span {
  text: string
  fg: unknown
  bg: unknown
}

function repo(files: Record<string, string>) {
  const dir = tempDir('druk-hunks-')
  initRepo(dir)
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

const text = (lines: string[]) => `${lines.join('\n')}\n`

const classBody = [
  'export class Store {',
  '  load(key: string) {',
  ...Array.from({ length: 14 }, (_, i) => `    const step${i} = key.at(${i})`),
  '    return key',
  '  }',
  '}',
]

const spansOf = (t: Awaited<ReturnType<typeof launch>>) =>
  (t.captureSpans() as { lines: { spans: Span[] }[] }).lines.map(
    (line) => line.spans
  )

const rowOf = (t: Awaited<ReturnType<typeof launch>>, needle: string) =>
  t
    .captureCharFrame()
    .split('\n')
    .findIndex((line) => line.includes(needle))

test('unchanged stretches fold into a row naming the scope the hunk sits in', async () => {
  const dir = repo({ 'a.ts': text(classBody) })
  const after = [...classBody]
  after[12] = '    const step10 = key.at(-10)'
  writeFileSync(join(dir, 'a.ts'), text(after))

  const t = await launch(dir, {}, { height: 40, width: 130 })
  await openDiff(t)
  await untilFrame(t, 'key.at(-10)')

  const frame = t.captureCharFrame()
  expect(frame).toContain('⋯ 9 unchanged lines  load(key: string) {')
  expect(frame).toContain('⋯ 3 unchanged lines')
  expect(frame).not.toContain('step0 ')
})

test('a click on the folded row opens it, and z folds the file back', async () => {
  const dir = repo({ 'a.ts': text(classBody) })
  const after = [...classBody]
  after[12] = '    const step10 = key.at(-10)'
  writeFileSync(join(dir, 'a.ts'), text(after))

  const t = await launch(dir, {}, { height: 40, width: 130 })
  await openDiff(t)
  await untilFrame(t, '⋯ 9 unchanged lines')

  const row = rowOf(t, '⋯ 9 unchanged lines')
  const col = t.captureCharFrame().split('\n')[row]!.indexOf('⋯')
  await t.mockMouse.click(col, row)
  await untilFrame(t, 'const step0 = key.at(0)')
  expect(t.captureCharFrame()).not.toContain('⋯ 9 unchanged lines')
  expect(t.captureCharFrame()).toContain('⋯ 3 unchanged lines')

  await press(t, (i) => i.pressKey('z'))
  await untilGone(t, 'const step0 = key.at(0)')
  expect(t.captureCharFrame()).toContain('⋯ 9 unchanged lines')

  await press(t, (i) => i.pressKey('z'))
  await untilGone(t, 'unchanged lines')
  expect(t.captureCharFrame()).toContain('const step0 = key.at(0)')
})

test('] and [ walk the hunks of every file on the page', async () => {
  const long = Array.from({ length: 200 }, (_, i) => `line ${i}`)
  const dir = repo({ 'a.ts': text(long), 'b.ts': text(long) })
  const changed = [...long]
  for (const at of [10, 80, 150]) {
    changed[at] = `CHANGED ${at}`
  }
  writeFileSync(join(dir, 'a.ts'), text(changed))
  writeFileSync(join(dir, 'b.ts'), text(changed))

  const t = await launch(dir, {}, { height: 24, width: 130 })
  await openDiff(t)
  await untilFrame(t, 'CHANGED 10')
  await press(t, (i) => i.pressTab())

  await press(t, (i) => i.pressKey(']'))
  await untilGone(t, 'CHANGED 10')
  expect(t.captureCharFrame()).toContain('CHANGED 80')

  await press(t, (i) => i.pressKey(']'))
  await untilFrame(t, 'CHANGED 150')
  // The fourth hunk is the next file's first.
  await press(t, (i) => i.pressKey(']'))
  await until(t, () => rowOf(t, 'CHANGED 10') !== -1)
  expect(t.captureCharFrame()).toContain('b.ts')

  await press(t, (i) => i.pressKey('['))
  await untilFrame(t, 'CHANGED 150')
})

test('/ finds text across the page and n steps to the next hit', async () => {
  const long = Array.from({ length: 200 }, (_, i) => `line ${i}`)
  const dir = repo({ 'a.ts': text(long) })
  const changed = long.map((line, i) => (i % 10 === 5 ? `edit ${i}` : line))
  changed[5] = 'needle one'
  changed[195] = 'needle two'
  writeFileSync(join(dir, 'a.ts'), text(changed))

  const t = await launch(dir, {}, { height: 24, width: 130 })
  await openDiff(t)
  await untilFrame(t, 'needle one')
  await press(t, (i) => i.pressTab())

  await press(t, (i) => i.pressKey('/'))
  await untilFrame(t, 'find in diff')
  await press(t, (i) => i.typeText('Needle'))
  await press(t, (i) => i.pressEnter())
  // Smart case: an uppercase letter makes the query exact, so nothing matches.
  await untilFrame(t, 'no matches')
  await pressEscape(t)
  await untilGone(t, 'no matches')

  await press(t, (i) => i.pressKey('/'))
  await press(t, (i) => i.typeText('needle'))
  await press(t, (i) => i.pressEnter())
  await untilFrame(t, '1/2')
  await press(t, (i) => i.pressKey('n'))
  await untilFrame(t, '2/2')
  expect(t.captureCharFrame()).toContain('needle two')
  expect(t.captureCharFrame()).not.toContain('needle one')

  await press(t, (i) => i.pressKey('n', { shift: true }))
  await untilFrame(t, 'needle one')

  await pressEscape(t)
  await untilGone(t, '1/2')
  // The first Esc cleared the search, not the page.
  expect(t.captureCharFrame()).toContain('needle one')
})

test('the words a change touched are tinted apart from the rest of the line', async () => {
  const dir = repo({ 'a.ts': text(['const total = alpha + beta']) })
  writeFileSync(join(dir, 'a.ts'), text(['const total = alpha - beta']))

  const t = await launch(dir, {}, { width: 130 })
  await openDiff(t)
  await untilFrame(t, '+ const total = alpha - beta')

  const added = () =>
    spansOf(t).find(
      (line) =>
        line.some((span) => span.text.includes('alpha')) &&
        line.some((span) => span.text.trim() === '+')
    )
  await until(t, () => added() !== undefined)
  const spans = added()!
  const bgOf = (needle: string) =>
    String(spans.find((span) => span.text.includes(needle))?.bg)
  expect(bgOf('-')).not.toBe(bgOf('alpha'))
  expect(bgOf('alpha')).toBe(bgOf('beta'))
})

test('a block moved within the file is tinted apart from plain additions', async () => {
  const block = [
    'function helperThatMoves(value: number) {',
    '  return value * 2 + value / 3',
    '}',
  ]
  const rest = Array.from({ length: 8 }, (_, i) => `const keep${i} = ${i}`)
  const dir = repo({ 'a.ts': text([...block, ...rest]) })
  writeFileSync(join(dir, 'a.ts'), text([...rest, ...block, 'const fresh = 1']))

  const t = await launch(dir, {}, { height: 40, width: 130 })
  await openDiff(t)
  await untilFrame(t, '+ const fresh = 1')

  const rowBg = (needle: string) => {
    const line = spansOf(t).find((spans) =>
      spans.some((span) => span.text.includes(needle))
    )
    return String(line?.find((span) => span.text.includes(needle))?.bg)
  }
  // One token each: syntax colour splits a row into a span per token.
  expect(rowBg('fresh')).not.toBe(rowBg('helperThatMoves'))
  expect(rowBg('fresh')).not.toBe('undefined')
})

test('w wraps a long line instead of cutting it at the pane edge', async () => {
  const tail = 'END_OF_THE_LINE'
  const longLine = `const value = '${'x'.repeat(160)}' // ${tail}`
  const dir = repo({ 'a.ts': text(['const a = 1']) })
  writeFileSync(join(dir, 'a.ts'), text([longLine]))

  const t = await launch(dir, {}, { width: 130 })
  await openDiff(t)
  await untilFrame(t, "+ const value = 'xxx")
  expect(t.captureCharFrame()).not.toContain(tail)

  await press(t, (i) => i.pressTab())
  await press(t, (i) => i.pressKey('w'))
  await untilFrame(t, tail)
})

test('the auto layout goes side by side once the diff has the columns for it', async () => {
  const dir = repo({ 'a.ts': text(['one', 'two', 'three']) })
  writeFileSync(join(dir, 'a.ts'), text(['one', 'TWO', 'three']))

  const narrow = await launch(dir, {}, { width: 130 })
  await openDiff(narrow)
  await untilFrame(narrow, '+ TWO')
  expect(rowOf(narrow, '- two')).not.toBe(rowOf(narrow, '+ TWO'))

  const wide = await launch(dir, {}, { width: 220 })
  await openDiff(wide)
  await untilFrame(wide, '+ TWO')
  expect(rowOf(wide, '- two')).toBe(rowOf(wide, '+ TWO'))
})

import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ui } from '../src/themes'
import { fixture, launch, press, pressEscape, settle } from './helpers'

interface Span {
  text: string
  bg?: { buffer: Uint8Array }
}
interface Frame {
  lines: { spans: Span[] }[]
}

const hex = (bg: Span['bg']) =>
  bg
    ? `#${Array.from(bg.buffer.slice(0, 3), v => v.toString(16).padStart(2, '0')).join('')}`
    : undefined

/** The tree row painted with the focused-selection background, if any. */
function selectedRow(frame: Frame): string {
  for (const line of frame.lines) {
    if (hex(line.spans[0]?.bg) === ui.treeSelectedBg.toLowerCase()) {
      return line.spans
        .map(span => span.text)
        .join('')
        .trim()
    }
  }
  return ''
}

describe('focusing the tree', () => {
  test('reveals and scrolls to the file opened from the picker', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 30; index++) {
      files[`deep/nested/f${index}.ts`] = `const a${index} = 1\n`
    }
    const t = await launch(fixture(files))

    await press(t, input => input.pressKey('o', { ctrl: true }))
    await press(t, input => void input.typeText('f21.ts'))
    await press(t, input => input.pressEnter())
    await pressEscape(t)

    expect(selectedRow(t.captureSpans() as unknown as Frame)).toContain('f21.ts')

    await press(t, input => input.pressArrow('down'))
    expect(selectedRow(t.captureSpans() as unknown as Frame)).toContain('f22.ts')
  })

  test('a mouse-scrolled tree is not yanked back by a tree refresh', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 40; index++) files[`f${index}.ts`] = `const a${index} = 1\n`
    const dir = fixture(files)
    const t = await launch(dir)

    await press(t, input => input.pressArrow('down')) // select the first row
    const topRow = () => t.captureCharFrame().split('\n')[3]!.slice(0, 20)
    const atTop = topRow()

    for (let step = 0; step < 6; step++) await t.mockMouse.scroll(4, 8, 'down')
    await settle(t)
    const scrolled = topRow()
    expect(scrolled).not.toBe(atTop)

    // The watcher rebuilds the node list on any disk change; the view must stay put.
    writeFileSync(join(dir, 'touched.ts'), 'const touched = 1\n')
    await new Promise(resolve => setTimeout(resolve, 400))
    await settle(t)
    expect(topRow()).toBe(scrolled)
  })

  test('selects the first row when nothing was selected yet', async () => {
    const t = await launch(fixture({ 'alpha.ts': 'const a = 1\n', 'beta.ts': 'const b = 2\n' }))
    await press(t, input => input.pressArrow('down'))
    expect(selectedRow(t.captureSpans() as unknown as Frame)).toContain('alpha.ts')
  })
})

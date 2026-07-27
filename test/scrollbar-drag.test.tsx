import { describe, expect, test } from 'bun:test'

import { fixture, launch, press, settle } from './helpers'
import type { Harness } from './helpers'

const long = `${Array.from({ length: 400 }, (_, index) => `line ${index}`).join('\n')}\n`

/** Rightmost column of the editor rows: the scrollbar track. */
const track = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .slice(1, 19)
    .map(row => row.at(-1))
    .join('')

/** First line number in the gutter, i.e. where the viewport sits. */
function topLine(t: Harness): number {
  const row = t.captureCharFrame().split('\n')[1]!
  return Number(row.trim().split(/\s+/)[0])
}

/**
 * Open the file with the sidebar hidden — the tree would otherwise occupy the
 * left columns, so the gutter is not the first thing on the row.
 */
async function openAlone(name: string, content: string) {
  const t = await launch(fixture({ [name]: content }))
  await press(t, input => input.pressKey('o', { ctrl: true }))
  await press(t, input => void input.typeText(name))
  await press(t, input => input.pressEnter())
  await press(t, input => input.pressKey('b', { ctrl: true }))
  await settle(t)
  return t
}

/** The track's screen column: the last cell of an editor row. */
const trackX = (t: Harness) => t.captureCharFrame().split('\n')[1]!.length - 1

describe('dragging the editor scrollbar', () => {
  test('pressing down the track scrolls the file there', async () => {
    const t = await openAlone('big.ts', long)
    expect(topLine(t)).toBe(1)

    await t.mockMouse.pressDown(trackX(t), 14)
    await settle(t)

    expect(topLine(t)).toBeGreaterThan(200)
    expect(track(t)).toContain('█')
  })

  test('a drag follows the pointer and can come back to the top', async () => {
    const t = await openAlone('big.ts', long)
    const x = trackX(t)

    await t.mockMouse.drag(x, 2, x, 16)
    await settle(t)
    const deep = topLine(t)
    expect(deep).toBeGreaterThan(100)

    await t.mockMouse.drag(x, 16, x, 1)
    await settle(t)
    expect(topLine(t)).toBe(1)
  })

  test('the caret stays put — dragging scrolls, it does not retarget', async () => {
    const t = await openAlone('big.ts', long)
    expect(t.captureCharFrame()).toContain('Ln 1, Col 1')

    const x = trackX(t)
    await t.mockMouse.drag(x, 2, x, 15)
    await settle(t)

    expect(topLine(t)).toBeGreaterThan(100)
    expect(t.captureCharFrame()).toContain('Ln 1, Col 1')
  })

  test('the thumb ends up under the pointer, not somewhere else', async () => {
    const t = await openAlone('big.ts', long)
    const x = trackX(t)

    await t.mockMouse.pressDown(x, 10)
    await settle(t)

    // Row 10 of the frame is row 9 of the track (row 0 is the tab bar).
    const thumb = track(t).indexOf('█')
    expect(Math.abs(thumb - 9)).toBeLessThanOrEqual(2)
  })

  test('a drag that wanders off the one-column track keeps scrolling', async () => {
    const t = await openAlone('big.ts', long)
    const x = trackX(t)

    // Grab the thumb, then move with the pointer nowhere near the track — a real
    // vertical drag drifts sideways within the first few rows. Capture lives on the
    // pane, so leaving the one-column target must not end the gesture.
    await t.mockMouse.pressDown(x, 2)
    await settle(t)
    const grabbed = topLine(t)

    await t.mockMouse.drag(x - 6, 4, x - 6, 15)
    await settle(t)
    const deep = topLine(t)
    expect(deep).toBeGreaterThan(grabbed + 100)

    // Letting go ends it: the same movement afterwards changes nothing.
    await t.mockMouse.release(x - 6, 15)
    await settle(t)
    await t.mockMouse.drag(x - 6, 15, x - 6, 4)
    await settle(t)
    expect(topLine(t)).toBe(deep)
  })

  test('a file that fits has no track to drag', async () => {
    const t = await openAlone('tiny.ts', 'one\ntwo\n')

    expect(track(t)).not.toContain('█')
    // Pressing where the track would be must not scroll or crash.
    await t.mockMouse.pressDown(79, 10)
    await settle(t)
    expect(topLine(t)).toBe(1)
  })
})

import { expect, test } from 'bun:test'
import { EditBufferRenderable } from '@opentui/core'

import { fixture, launch, press, settle } from './helpers'

/** Wrap the FFI highlight calls and count them. Returns a stop/read handle. */
function countHighlightCalls() {
  const proto = EditBufferRenderable.prototype as unknown as Record<string, (...a: never[]) => void>
  const counts: Record<string, number> = {
    addHighlight: 0,
    addHighlightByCharRange: 0,
    clearLineHighlights: 0,
    clearAllHighlights: 0,
  }
  const originals: Record<string, (...a: never[]) => void> = {}
  for (const name of Object.keys(counts)) originals[name] = proto[name]!
  for (const name of Object.keys(counts)) {
    const original = originals[name]!
    proto[name] = function (this: unknown, ...args: never[]) {
      counts[name]!++
      return original.apply(this, args)
    }
  }
  return {
    counts,
    reset: () => {
      for (const k of Object.keys(counts)) counts[k] = 0
    },
    restore: () => {
      for (const name of Object.keys(counts)) proto[name] = originals[name]!
    },
  }
}

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `const value${i} = ${i} + someFn(${i}) // note ${i}`).join(
    '\n',
  ) + '\n'

test('SCRATCH highlight call count per keystroke', async () => {
  const probe = countHighlightCalls()
  try {
    for (const n of [200, 1000, 4000]) {
      const t = await launch(fixture({ 'big.ts': lines(n) }))
      await press(t, i => i.pressArrow('down'))
      await press(t, i => i.pressEnter())
      // let the async highlight land
      await new Promise(r => setTimeout(r, 600))
      await settle(t)
      const afterOpen = { ...probe.counts }

      probe.reset()
      await press(t, i => i.typeText('x'))
      await new Promise(r => setTimeout(r, 600))
      await settle(t)
      const afterType = { ...probe.counts }

      console.log(
        `lines=${String(n).padStart(5)} open.add=${String(afterOpen.addHighlight).padStart(6)} open.clearAll=${afterOpen.clearAllHighlights} | type.add=${String(afterType.addHighlight).padStart(6)} type.clearLine=${afterType.clearLineHighlights} type.clearAll=${afterType.clearAllHighlights}`,
      )
    }
  } finally {
    probe.restore()
  }
  expect(true).toBe(true)
}, 120000)

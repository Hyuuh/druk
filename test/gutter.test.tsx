import { expect, test } from 'bun:test'

import { fixture, launch, press } from './helpers'

test('line numbers past 99 are not truncated', async () => {
  const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join('\n')
  const t = await launch(fixture({ 'big.txt': lines }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())

  for (let n = 0; n < 120; n++) await press(t, i => i.pressArrow('down'))

  const frame = t.captureCharFrame()
  expect(frame).toContain('120 line 120') // gutter and content stay aligned
  expect(frame).not.toContain('unsaved') // scrolling must not modify the buffer
})

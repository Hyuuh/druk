import { describe, expect, test } from 'bun:test'

import { fixture, launch, openFile, press, until } from './helpers'
import type { Harness } from './helpers'

/**
 * Lines long enough to wrap several times each. That is what breaks the window:
 * `scrollY` counts visual rows while highlights are addressed by logical line,
 * so deep in such a file the two disagree by a factor of four.
 */
const LOCKFILE = `{
  "lockfileVersion": 1,
  "packages": {
${Array.from(
  { length: 800 },
  (_, index) =>
    `    "@scope/pkg-${index}": ["@scope/pkg-${index}@1.0.0", "", { "dependencies": { "a": "^1.0.0" } }, "sha512-${'x'.repeat(90)}=="],`,
).join('\n')}
  }
}
`

/** Distinct foreground colours in the text area — one means it is all plain. */
function colors(t: Harness) {
  const frame = t.captureSpans() as unknown as {
    lines: { spans: { text: string; fg?: { buffer: Uint8Array } }[] }[]
  }
  const seen = new Set<string>()
  for (const line of frame.lines.slice(1, 22)) {
    for (const span of line.spans) {
      if (!span.text.trim() || !span.fg) continue
      seen.add(Array.from(span.fg.buffer.slice(0, 3)).join(','))
    }
  }
  return seen
}

/** The highlight pass is async — wait for color to arrive, not for a duration. */
const painted = (t: Harness) => until(t, () => colors(t).size > 2)

async function openLock() {
  const t = await launch(fixture({ 'bun.lock': LOCKFILE }), {}, { width: 100, height: 24 })
  await openFile(t, 'bun.lock')
  await painted(t)
  return t
}

const gotoLine = async (t: Harness, line: number) => {
  await press(t, input => input.pressKey('g', { ctrl: true }))
  await press(t, input => void input.typeText(String(line)))
  await press(t, input => input.pressEnter())
  await painted(t)
}

/**
 * A smoke check, not the guard. The off-screen harness wraps differently enough
 * that it kept passing with the bug in place — what actually pins the mapping is
 * `window.test.ts`, which drives `logicalWindow` directly.
 */
describe('highlighting a file whose lines wrap', () => {
  test('is still painted hundreds of lines in', async () => {
    const t = await openLock()
    const atTop = colors(t).size
    expect(atTop).toBeGreaterThan(2)

    await gotoLine(t, 400)
    // Without the visual-to-logical mapping this window lands past the end of
    // the file and every visible line renders in the plain text colour.
    expect(colors(t).size).toBeGreaterThan(2)
  }, 60000)

  test('and at the very end of the file', async () => {
    const t = await openLock()
    await gotoLine(t, 795)

    expect(colors(t).size).toBeGreaterThan(2)
  }, 60000)
})

import { afterAll, expect, test } from 'bun:test'

import { invalidateSyntaxStyle } from '../src/languages/highlight'
import { setTheme, THEMES } from '../src/themes'
import {
  fixture,
  launch,
  openPalette,
  press,
  pressEscape,
  pressTimes,
  runCommand,
  until,
  untilFrame,
} from './helpers'
import type { Harness } from './helpers'

/** The theme store is module-global, so a test that confirms one puts it back. */
afterAll(() => {
  setTheme('dark')
  invalidateSyntaxStyle()
})

interface Span {
  text: string
  fg?: { buffer: Record<string, number> }
  bg?: { buffer: Record<string, number> }
}

const rgb = (c?: { buffer: Record<string, number> }) =>
  c ? `${c.buffer['0']},${c.buffer['1']},${c.buffer['2']}` : ''

const spans = (t: Harness) =>
  (t.captureSpans() as unknown as { lines: { spans: Span[] }[] }).lines.flatMap(l => l.spans)

/** Backgrounds only — the chrome the sidebar and the tab strip paint. */
function bgColors(t: Harness) {
  return new Set(spans(t).flatMap(span => (span.bg ? [rgb(span.bg)] : [])))
}

/** Backgrounds plus text color: syntax highlighting lives in the latter. */
function colors(t: Harness) {
  const seen = bgColors(t)
  for (const span of spans(t)) if (span.fg && span.text.trim()) seen.add(rgb(span.fg))
  return seen
}

const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '')
  return `${Number.parseInt(h.slice(0, 2), 16)},${Number.parseInt(h.slice(2, 4), 16)},${Number.parseInt(h.slice(4, 6), 16)}`
}

const DARK_BG = hexToRgb(THEMES.dark.ui.bg)
const LIGHT_BG = hexToRgb(THEMES.light.ui.bg)
const DARK_KEYWORD = hexToRgb((THEMES.dark.syntax.keyword as { fg: string }).fg)
const LIGHT_KEYWORD = hexToRgb((THEMES.light.syntax.keyword as { fg: string }).fg)

test('palette filters from root and previews a theme before confirming', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
  await openPalette(t)

  // Filtering from the root searches flattened leaves; stopping on a theme paints it.
  await press(t, i => void i.typeText('light'))
  expect(bgColors(t)).toContain(LIGHT_BG)

  // Esc cancels the preview and returns to the current theme.
  await pressEscape(t)
  expect(bgColors(t)).toContain(DARK_BG)

  // Re-open, filter, and confirm.
  await openPalette(t)
  await press(t, i => void i.typeText('light'))
  await press(t, i => i.pressEnter())
  expect(bgColors(t)).toContain(LIGHT_BG)
  expect(bgColors(t)).not.toContain(DARK_BG)
})

test('palette cancels a previewed theme when filtering away from it', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
  await openPalette(t)

  await press(t, i => void i.typeText('light'))
  expect(bgColors(t)).toContain(LIGHT_BG)

  // Filtering until there are no matching commands leaves the preview row.
  await press(t, i => void i.typeText('x'))
  expect(t.captureCharFrame()).toContain('No matching commands')
  expect(bgColors(t)).toContain(DARK_BG)
  expect(bgColors(t)).not.toContain(LIGHT_BG)

  // Closing the palette after the preview has already been cancelled.
  await pressEscape(t)
  expect(bgColors(t)).toContain(DARK_BG)
  expect(bgColors(t)).not.toContain(LIGHT_BG)
})

test('palette cancels a previewed theme before running a non-preview command', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
  await openPalette(t)

  await press(t, i => void i.typeText('light'))
  expect(bgColors(t)).toContain(LIGHT_BG)

  // Backspace the filter and select a non-preview command.
  await pressTimes(t, 5, i => i.pressBackspace())
  await press(t, i => void i.typeText('save'))
  expect(t.captureCharFrame()).toContain('Save file')

  await press(t, i => i.pressEnter())
  expect(bgColors(t)).toContain(DARK_BG)
  expect(bgColors(t)).not.toContain(LIGHT_BG)
})

test('backing out of the themes submenu puts the theme back', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
  await openPalette(t)
  // Into the submenu, rather than filtering: a filter from the root flattens to
  // the leaves, and there would be no trail to back out of.
  for (let step = 0; step < 20; step++) {
    const row = t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes('Themes'))
    if (row?.includes('▌')) break
    await press(t, i => i.pressArrow('down'))
  }
  await press(t, i => i.pressArrow('right'))
  // The submenu opens on the first theme, which is the one already in force —
  // one step down is the first that paints anything.
  await press(t, i => i.pressArrow('down'))
  expect(bgColors(t)).toContain(LIGHT_BG)

  // ← leaves the submenu without closing the palette: the selection has left the
  // previewed theme, so the paint goes with it while the palette stays open.
  await press(t, i => i.pressArrow('left'))
  expect(bgColors(t)).toContain(DARK_BG)
  expect(bgColors(t)).not.toContain(LIGHT_BG)
})

test('cancelling a palette preview restores the editor, not only the sidebar', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, {}, {}, { openFile: `${dir}/a.ts` })
  await untilFrame(t, 'const')
  // Wait for the highlight pass: keyword color is what the editor alone paints.
  await until(t, () => colors(t).has(DARK_KEYWORD))

  await openPalette(t)
  await press(t, i => void i.typeText('light'))
  await until(t, () => bgColors(t).has(LIGHT_BG))

  // Esc closes the palette and must undo the preview everywhere — including the
  // open editor's syntax table, which used to stay on the previewed theme until
  // the next keystroke dirtied the buffer.
  await pressEscape(t)
  await until(t, () => colors(t).has(DARK_KEYWORD) && !colors(t).has(LIGHT_KEYWORD))
  expect(bgColors(t)).toContain(DARK_BG)
  expect(bgColors(t)).not.toContain(LIGHT_BG)
})

test('settings theme picker previews on filter and cancels on escape', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
  await runCommand(t, 'Settings')
  await press(t, i => i.pressEnter())

  await press(t, i => void i.typeText('light'))
  expect(bgColors(t)).toContain(LIGHT_BG)

  await pressEscape(t)
  expect(bgColors(t)).toContain(DARK_BG)
  expect(bgColors(t)).not.toContain(LIGHT_BG)
})

test('settings theme picker cancel restores the editor syntax too', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, {}, { height: 40 }, { openFile: `${dir}/a.ts` })
  await untilFrame(t, 'const')
  await until(t, () => colors(t).has(DARK_KEYWORD))

  await runCommand(t, 'Settings')
  await press(t, i => i.pressEnter())
  await press(t, i => void i.typeText('light'))
  await until(t, () => bgColors(t).has(LIGHT_BG))

  await pressEscape(t)
  // Back on the settings page — leave it so the editor is visible again.
  await pressEscape(t)
  await until(t, () => colors(t).has(DARK_KEYWORD) && !colors(t).has(LIGHT_KEYWORD))
})

// The light and dark rows paint nothing themselves — they take effect when the OS
// appearance flips — so confirming one has to leave the theme in force on screen
// rather than the theme the list was previewing.
test('picking a light theme leaves the theme in force on screen', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), { themeSync: false })
  await runCommand(t, 'Settings')
  await pressTimes(t, 2, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  // The dark theme, deliberately: picking the light one for the light row is
  // what it already holds, so nothing would have to have been put back.
  await press(t, i => void i.typeText('dark'))
  await press(t, i => i.pressEnter())

  expect(t.captureCharFrame()).toContain('Light theme: GitHub Dark')
  expect(bgColors(t)).toContain(DARK_BG)
  expect(bgColors(t)).not.toContain(LIGHT_BG)
})

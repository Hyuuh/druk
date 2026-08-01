import { describe, expect, test } from 'bun:test'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CapturedFrame } from '@opentui/core'

import {
  fixture,
  F1,
  launch,
  openFile,
  press,
  pressEscape,
  pressTimes,
  runCommand,
  untilFrame,
  untilGone,
} from './helpers'
import type { Harness } from './helpers'
import { pdfFixture } from './pdf-fixture'

function hasColor(t: Harness, [r, g, b]: [number, number, number]): boolean {
  const frame: CapturedFrame = t.captureSpans()
  return frame.lines.some(line =>
    line.spans.some(span =>
      [span.fg, span.bg].some(color => {
        const [red, green, blue] = color.toInts()
        return red === r && green === g && blue === b
      }),
    ),
  )
}

const PAGE_UP = '\x1B[5~'
const PAGE_DOWN = '\x1B[6~'

function project(): { dir: string; pdf: string } {
  const dir = fixture({ 'main.ts': 'const a = 1\n' })
  const pdf = join(dir, 'sample.pdf')
  writeFileSync(pdf, pdfFixture())
  return { dir, pdf }
}

async function pageKey(t: Awaited<ReturnType<typeof launch>>, sequence: string) {
  await press(t, input => void input.pressKeys([sequence]))
}

describe('PDF viewer', () => {
  test('druk sample.pdf opens a fitted viewer instead of refusing binary data', async () => {
    const { dir, pdf } = project()
    const t = await launch(dir, {}, { width: 80, height: 24 }, { openFile: pdf })
    await untilFrame(t, 'sample.pdf — 1/2 · 100%')
    const frame = t.captureCharFrame()
    expect(frame).toContain('▀')
    expect(frame).not.toContain('binary')
    expect(frame.trimEnd().split('\n').at(-1)).toContain('pdf')
  })

  test('picker open pages forward and backward', async () => {
    const { dir } = project()
    const t = await launch(dir, {}, { width: 80, height: 24 })
    await openFile(t, 'sample')
    await untilFrame(t, 'sample.pdf — 1/2 · 100%')
    expect(hasColor(t, [255, 0, 0])).toBe(true)
    expect(hasColor(t, [0, 0, 255])).toBe(false)

    await pageKey(t, PAGE_DOWN)
    await untilFrame(t, 'sample.pdf — 2/2 · 100%')
    expect(hasColor(t, [0, 0, 255])).toBe(true)
    expect(hasColor(t, [255, 0, 0])).toBe(false)
    await press(t, input => input.pressKey('k'))
    await untilFrame(t, 'sample.pdf — 1/2 · 100%')
    await pageKey(t, PAGE_UP)
    expect(t.captureCharFrame()).toContain('sample.pdf — 1/2 · 100%')
  })

  test('zooms, pans without changing page, and resets to fit', async () => {
    const { dir } = project()
    const t = await launch(dir, { sidebarWidth: 15 }, { width: 50, height: 16 })
    await openFile(t, 'sample')
    await untilFrame(t, 'sample.pdf — 1/2 · 100%')

    await press(t, input => input.pressKey('+'))
    await untilFrame(t, 'sample.pdf — 1/2 · 125%')
    await press(t, input => input.pressArrow('right'))
    expect(t.captureCharFrame()).toContain('sample.pdf — 1/2 · 125%')
    await press(t, input => input.pressKey('0'))
    await untilFrame(t, 'sample.pdf — 1/2 · 100%')
  })

  test('clips a 400% page to tabs, sidebar, and status bar', async () => {
    const { dir } = project()
    const t = await launch(dir, { sidebarWidth: 15 }, { width: 50, height: 16 })
    await openFile(t, 'sample')
    await untilFrame(t, 'sample.pdf — 1/2 · 100%')
    await pressTimes(t, 12, input => input.pressKey('+'))
    await untilFrame(t, 'sample.pdf — 1/2 · 400%')

    const rows = t.captureCharFrame().split('\n')
    expect(rows[0]).not.toContain('▀')
    expect(rows.at(-1)).not.toContain('▀')
    for (const row of rows.slice(1, -1)) expect(row.slice(0, 16)).not.toContain('▀')
  })

  test('a modal blocks viewer controls', async () => {
    const { dir } = project()
    const t = await launch(dir)
    await openFile(t, 'sample')
    await untilFrame(t, 'sample.pdf — 1/2 · 100%')

    await press(t, input => void input.pressKeys([F1]))
    await press(t, input => input.pressKey('+'))
    expect(t.captureCharFrame()).toContain('sample.pdf — 1/2 · 100%')
    await pressEscape(t)
    await pressEscape(t)
    expect(t.captureCharFrame()).not.toContain('125%')
  })

  test('a page over the PDF owns its arrow keys', async () => {
    const { dir } = project()
    const t = await launch(dir)
    await openFile(t, 'sample')
    await untilFrame(t, 'sample.pdf — 1/2 · 100%')

    await runCommand(t, 'Settings')
    await press(t, input => input.pressArrow('down'))
    await press(t, input => input.pressEnter())

    const frame = t.captureCharFrame()
    expect(frame).toContain('Follow OS appearance')
    const followOs = frame.split('\n').find(line => line.includes('Follow OS appearance'))
    expect(followOs?.trimEnd().endsWith('on')).toBe(true)
    expect(frame).not.toContain('Type to filter')
  })

  test('restores a PDF tab and never saves its bytes', async () => {
    const { dir, pdf } = project()
    const first = await launch(dir)
    await openFile(first, 'sample')
    await untilFrame(first, 'sample.pdf — 1/2 · 100%')

    const second = await launch(dir)
    await untilFrame(second, 'sample.pdf — 1/2 · 100%')
    const before = [...(await Bun.file(pdf).bytes())]
    await press(second, input => input.pressKey('s', { ctrl: true }))
    expect([...(await Bun.file(pdf).bytes())]).toEqual(before)
    expect(second.captureCharFrame()).not.toContain('Saved sample.pdf')

    await press(second, input => input.pressKey('w', { ctrl: true }))
    await untilGone(second, 'sample.pdf —')
  })

  test('shows corrupt and encrypted PDFs as closable viewer errors', async () => {
    const dir = fixture({ 'broken.pdf': '%PDF-broken' })
    copyFileSync(join(import.meta.dir, 'fixtures/pdf-password.pdf'), join(dir, 'locked.pdf'))
    const t = await launch(dir, {}, { width: 120 })

    await openFile(t, 'broken')
    await untilFrame(t, 'Cannot show broken.pdf: File not in PDF format or corrupted')
    await press(t, input => input.pressKey('w', { ctrl: true }))
    await untilGone(t, 'Cannot show broken.pdf')

    await openFile(t, 'locked')
    await untilFrame(t, 'Cannot show locked.pdf: Password required or incorrect password')
    await press(t, input => input.pressKey('w', { ctrl: true }))
    await untilGone(t, 'Cannot show locked.pdf')
  })
})

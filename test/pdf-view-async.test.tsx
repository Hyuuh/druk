import { afterEach, expect, mock, test } from 'bun:test'
import { join } from 'node:path'

import type { CapturedFrame } from '@opentui/core'
import { testRender } from '@opentui/solid'
import { createSignal } from 'solid-js'
import type { Setter } from 'solid-js'

interface RawImage {
  width: number
  height: number
  pixels: Uint8Array
  bytes: number
}

interface FakePdf {
  pageCount: number
  bytes: number
  renderPage: (page: number, cols: number, rows: number, zoom: number) => Promise<RawImage>
  close: () => Promise<void>
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

function clampPan(
  pan: { x: number; y: number },
  contentCols: number,
  contentRows: number,
  viewportCols: number,
  viewportRows: number,
) {
  return {
    x: Math.min(Math.max(0, contentCols - viewportCols), Math.max(0, Math.floor(pan.x))),
    y: Math.min(Math.max(0, contentRows - viewportRows), Math.max(0, Math.floor(pan.y))),
  }
}

let openImpl: (path: string) => Promise<FakePdf> = path =>
  Promise.reject(new Error(`unexpected open: ${path}`))
const openCalls: string[] = []

mock.module('../src/core/pdf', () => ({
  PDF_ZOOM_MIN: 25,
  PDF_ZOOM_MAX: 400,
  PDF_ZOOM_STEP: 25,
  isPdfPath: (path: string) => path.toLowerCase().endsWith('.pdf'),
  openPdf: (path: string) => {
    openCalls.push(path)
    return openImpl(path)
  },
  stepPdfZoom: (zoom: number, direction: -1 | 1) =>
    Math.min(400, Math.max(25, zoom + direction * 25)),
  clampPdfPan: clampPan,
  centerPdfPan: (
    contentCols: number,
    contentRows: number,
    viewportCols: number,
    viewportRows: number,
  ) =>
    clampPan(
      {
        x: Math.floor((contentCols - viewportCols) / 2),
        y: Math.floor((contentRows - viewportRows) / 2),
      },
      contentCols,
      contentRows,
      viewportCols,
      viewportRows,
    ),
}))

const { PdfView } = await import('../src/ui/PdfView')
const { fixture, launch, openFile: openProjectFile, untilFrame } = await import('./helpers')

type TestHarness = Awaited<ReturnType<typeof testRender>>
const harnesses = new Set<TestHarness>()

afterEach(() => {
  for (const t of harnesses) t.renderer.destroy()
  harnesses.clear()
  openCalls.length = 0
})

async function flush(t: TestHarness): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await t.flush()
}

async function until(
  t: TestHarness,
  condition: () => boolean,
  started = Date.now(),
): Promise<void> {
  if (condition() || Date.now() - started >= 2000) {
    expect(condition()).toBe(true)
    return
  }
  await new Promise(resolve => setTimeout(resolve, 10))
  await t.flush()
  return until(t, condition, started)
}

async function mount(path: string): Promise<{ t: TestHarness; setPath: Setter<string> }> {
  let setPath!: Setter<string>
  const t = await testRender(
    () => {
      const [currentPath, setCurrentPath] = createSignal(path)
      setPath = setCurrentPath
      return (
        <PdfView
          path={currentPath()}
          width={20}
          height={10}
          focused={true}
          blocked={false}
          onFocus={() => undefined}
        />
      )
    },
    { width: 20, height: 10 },
  )
  harnesses.add(t)
  await flush(t)
  return { t, setPath }
}

function solidImage(r: number, g: number, b: number, width = 4, height = 4): RawImage {
  const pixels = new Uint8Array(width * height * 4)
  for (let at = 0; at < pixels.length; at += 4) pixels.set([r, g, b, 255], at)
  return { width, height, pixels, bytes: pixels.byteLength }
}

function hasColor(t: TestHarness, [r, g, b]: [number, number, number]): boolean {
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

test('coalesces path opens and closes a stale result before opening only the latest path', async () => {
  const opens = new Map(['A.pdf', 'B.pdf', 'C.pdf'].map(path => [path, deferred<FakePdf>()]))
  const closeA = deferred<void>()
  const events: string[] = []
  openImpl = path => opens.get(path)!.promise

  const { t, setPath } = await mount('A.pdf')
  await until(t, () => openCalls.length === 1)

  setPath('C.pdf')
  await flush(t)
  setPath('B.pdf')
  await flush(t)
  expect(openCalls).toEqual(['A.pdf'])

  opens.get('A.pdf')!.resolve({
    pageCount: 1,
    bytes: 1,
    renderPage: async () => solidImage(255, 0, 0),
    close: () => {
      events.push('close A')
      return closeA.promise
    },
  })
  await until(t, () => events.includes('close A'))
  expect(openCalls).toEqual(['A.pdf'])

  closeA.resolve()
  await until(t, () => openCalls.length === 2)
  expect(openCalls).toEqual(['A.pdf', 'B.pdf'])
})

test('serializes opens across the App PDF to source to PDF transition', async () => {
  const openedA = deferred<FakePdf>()
  const openedB = deferred<FakePdf>()
  const closeA = deferred<void>()
  const events: string[] = []
  const dir = fixture({ 'A.pdf': '', 'B.pdf': '', 'main.ts': 'const source = true\n' })
  const a = join(dir, 'A.pdf')
  const b = join(dir, 'B.pdf')
  openImpl = path => (path === a ? openedA.promise : openedB.promise)

  const t = await launch(dir, {}, {}, { openFile: a })
  await until(t, () => openCalls.length === 1)
  await openProjectFile(t, 'main.ts')
  await untilFrame(t, 'const source = true')
  await openProjectFile(t, 'B.pdf')
  expect(openCalls).toEqual([a])

  openedA.resolve({
    pageCount: 1,
    bytes: 1,
    renderPage: async () => solidImage(255, 0, 0),
    close: () => {
      events.push('close A')
      return closeA.promise
    },
  })
  await until(t, () => events.includes('close A'))
  expect(openCalls).toEqual([a])

  closeA.resolve()
  await until(t, () => openCalls.length === 2)
  expect(openCalls).toEqual([a, b])

  openedB.resolve({
    pageCount: 1,
    bytes: 1,
    renderPage: async () => solidImage(0, 0, 255),
    close: async () => undefined,
  })
  await untilFrame(t, 'B.pdf — 1/1 · 100%')
})

test('closes a document whose open finishes after unmount', async () => {
  const opened = deferred<FakePdf>()
  const closed = deferred<void>()
  openImpl = () => opened.promise

  const { t } = await mount('late.pdf')
  await until(t, () => openCalls.length === 1)
  t.renderer.destroy()
  harnesses.delete(t)

  opened.resolve({
    pageCount: 1,
    bytes: 1,
    renderPage: async () => solidImage(255, 0, 0),
    close: async () => closed.resolve(),
  })
  await closed.promise
})

test('coalesces renders, drops stale paint, and pans the rendered image without rendering again', async () => {
  const renders: {
    page: number
    cols: number
    rows: number
    zoom: number
    result: Deferred<RawImage>
  }[] = []
  openImpl = async () => ({
    pageCount: 2,
    bytes: 1,
    renderPage: (page, cols, rows, zoom) => {
      const result = deferred<RawImage>()
      renders.push({ page, cols, rows, zoom, result })
      return result.promise
    },
    close: async () => undefined,
  })

  const { t } = await mount('pages.pdf')
  await until(t, () => renders.length === 1)

  t.mockInput.pressKey('+')
  t.mockInput.pressKey('+')
  t.mockInput.pressKey('j')
  await flush(t)
  expect(renders).toHaveLength(1)

  renders[0]!.result.resolve(solidImage(255, 0, 0))
  await until(t, () => renders.length === 2)
  expect(renders[1]).toMatchObject({ page: 1, zoom: 150 })
  expect(hasColor(t, [255, 0, 0])).toBe(false)

  renders[1]!.result.resolve(solidImage(0, 0, 255, 40, 18))
  await until(t, () => hasColor(t, [0, 0, 255]))
  expect(hasColor(t, [255, 0, 0])).toBe(false)

  t.mockInput.pressArrow('right')
  await flush(t)
  expect(renders).toHaveLength(2)
})

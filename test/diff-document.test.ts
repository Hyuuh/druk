import { expect, test } from 'bun:test'

import { createRoot } from 'solid-js'

import { createDiffDocument } from '../src/app/diffDocument'
import type { DiffContent, DiffEntry } from '../src/app/diffDocument'
import { waitFor } from './wait'

const entry = (key: string, extra: Partial<DiffEntry> = {}): DiffEntry => ({
  key,
  path: `/p/${key}`,
  rel: key,
  status: 'modified',
  ...extra,
})

// `lines` changed lines, which is `lines * 2` patch rows plus the hunk header.
const text = (lines: number, tag = 'x'): DiffContent => ({
  kind: 'text',
  newText: Array.from({ length: lines }, (_, i) => `${tag}${i}\n`).join(''),
  oldText: '',
})

function withDoc<T>(
  load: (entry: DiffEntry) => DiffContent | Promise<DiffContent>,
  run: (doc: ReturnType<typeof createDiffDocument>) => T,
  maxLines?: number
) {
  return createRoot((dispose) => {
    const doc = createDiffDocument(load, { maxLines })
    return { dispose, result: run(doc) }
  })
}

const flush = () => Bun.sleep(0)

test('files load in page order until the page budget is spent, the rest held folded', async () => {
  const asked: string[] = []
  const { result: doc, dispose } = withDoc(
    (e) => {
      asked.push(e.key)
      return text(10)
    },
    (d) => d,
    15
  )
  doc.setEntries([entry('a'), entry('b'), entry('c')])
  await flush()

  expect(asked).toEqual(['a', 'b'])
  const [a, b, c] = doc.sections()
  expect(a!.body?.lines).toBeGreaterThan(0)
  expect(b!.folded).toBe(false)
  expect(c!.folded).toBe(true)
  expect(c!.body).toBeUndefined()
  expect(c!.note).toBe('not loaded · → shows it')

  doc.setFolded('c', false)
  await flush()
  expect(asked).toEqual(['a', 'b', 'c'])
  expect(doc.sections()[2]!.body?.newText).toContain('x9')
  dispose()
})

test('the pinned file is loaded however far past the budget it sits', async () => {
  const { result: doc, dispose } = withDoc(
    () => text(10),
    (d) => d,
    5
  )
  doc.setEntries([entry('a'), entry('b'), entry('c')])
  doc.setPin('c')
  await flush()
  const [, b, c] = doc.sections()
  expect(b!.folded).toBe(true)
  expect(c!.folded).toBe(false)
  expect(c!.body).toBeDefined()
  dispose()
})

test('a viewed file starts folded and unread, and unmarking it opens it', async () => {
  const asked: string[] = []
  const { result: doc, dispose } = withDoc(
    (e) => {
      asked.push(e.key)
      return text(1)
    },
    (d) => d
  )
  doc.setEntries([entry('a', { viewed: 'viewed' }), entry('b')])
  await flush()
  expect(asked).toEqual(['b'])
  expect(doc.sections()[0]!.folded).toBe(true)
  expect(doc.sections()[0]!.note).toBeNull()

  doc.updateEntry('a', { viewed: 'unviewed' })
  await flush()
  expect(asked).toEqual(['b', 'a'])
  expect(doc.sections()[0]!.folded).toBe(false)

  // An explicit fold outlives the mark until the source says the default applies again.
  doc.setFolded('a', false)
  doc.updateEntry('a', { viewed: 'viewed' })
  expect(doc.sections()[0]!.folded).toBe(false)
  doc.forgetFold('a')
  expect(doc.sections()[0]!.folded).toBe(true)
  dispose()
})

test('a reload that reads the same text keeps the same body, so nothing re-renders', async () => {
  let tag = 'x'
  const { result: doc, dispose } = withDoc(
    () => text(2, tag),
    (d) => d
  )
  doc.setEntries([entry('a')])
  await flush()
  const before = doc.sections()[0]!.body
  doc.reload()
  expect(doc.sections()[0]!.body).toBe(before)

  tag = 'y'
  doc.reload()
  expect(doc.sections()[0]!.body).not.toBe(before)
  expect(doc.sections()[0]!.body?.newText).toContain('y1')
  dispose()
})

test('an async loader fills files in as they arrive, and a reset drops late answers', async () => {
  const pending = new Map<string, (content: DiffContent) => void>()
  const { result: doc, dispose } = withDoc(
    (e) => {
      const { promise, resolve } = Promise.withResolvers<DiffContent>()
      pending.set(e.key, resolve)
      return promise
    },
    (d) => d
  )
  doc.setEntries([entry('a'), entry('b')])
  await flush()
  expect(doc.sections()[0]!.note).toBe('loading…')

  pending.get('a')!(text(1))
  await waitFor(() => doc.sections()[0]!.body !== undefined)
  expect(doc.sections()[1]!.body).toBeUndefined()

  doc.reset([entry('c')])
  pending.get('b')!(text(1))
  await flush()
  expect(doc.sections().map((s) => s.key)).toEqual(['c'])
  dispose()
})

test('a binary file and a failed read are named in the header rather than drawn', async () => {
  const { result: doc, dispose } = withDoc(
    (e) =>
      e.key === 'bin'
        ? { kind: 'binary' }
        : { detail: 'Could not read it', kind: 'error' },
    (d) => d
  )
  doc.setEntries([entry('bin', { adds: null }), entry('bad')])
  await flush()
  const [bin, bad] = doc.sections()
  expect(bin!.body).toBeNull()
  expect(bin!.note).toBe('binary')
  expect(bad!.note).toBe('Could not read it')
  dispose()
})

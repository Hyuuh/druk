import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { launch, press, pressEscape, runCommand, settle } from './helpers'

interface Span {
  text: string
  fg: unknown
}

/** A real repository with committed files. */
function repo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'druk-diff-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return dir
}

test('diff of the current file shows deletions, additions and both line numbers', async () => {
  const dir = repo({ 'a.ts': 'one\ntwo\nthree\n' })
  writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\nfour\n')

  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await runCommand(t, 'Diff current file')
  // The renderable assembles its panes on a queued microtask and renders async;
  // under a loaded parallel suite a single flush is not always enough, and no
  // fixed wait is safe — poll until the diff body is on screen.
  for (let n = 0; n < 20 && !t.captureCharFrame().includes('+ four'); n++) await settle(t, 50)

  const frame = t.captureCharFrame()
  expect(frame).toContain('a.ts')
  expect(frame).toContain('+2 −1')
  expect(frame).toContain('- TWO'.replace('TWO', 'two'))
  expect(frame).toContain('+ TWO')
  expect(frame).toContain('+ four')
  expect(frame).toContain('inline')
})

test('Tab switches to side-by-side and back, and the choice persists', async () => {
  const dir = repo({ 'a.ts': 'one\ntwo\nthree\n' })
  writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\n')

  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await runCommand(t, 'Diff current file')
  await press(t, i => i.pressTab())

  const frame = t.captureCharFrame()
  expect(frame).toContain('side-by-side')
  // The two panes carry the same changed line, one side each.
  expect(frame).toContain('- two')
  expect(frame).toContain('+ TWO')

  await press(t, i => i.pressTab())
  expect(t.captureCharFrame()).not.toContain('side-by-side')
})

test('diff of all changes pages through the changed files', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir)
  await runCommand(t, 'Diff all changes')

  let frame = t.captureCharFrame()
  expect(frame).toContain('file 1/2')
  expect(frame).toContain('a.ts')
  expect(frame).toContain('+ ALPHA')

  await press(t, i => i.pressArrow('right'))
  frame = t.captureCharFrame()
  expect(frame).toContain('file 2/2')
  expect(frame).toContain('b.ts')
  expect(frame).toContain('+ BETA')
})

test('F opens a file picker with per-file counts, filters, and jumps', async () => {
  const dir = repo({ 'alpha.ts': 'alpha\n', 'beta.ts': 'beta\none\ntwo\n' })
  writeFileSync(join(dir, 'alpha.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'beta.ts'), 'BETA\none\ntwo\nextra\n')

  const t = await launch(dir)
  await runCommand(t, 'Diff all changes')
  expect(t.captureCharFrame()).toContain('file 1/2')

  await press(t, i => void i.typeText('f'))
  let frame = t.captureCharFrame()
  expect(frame).toContain('Changed files — 2 · +3 −2') // totals across both files
  expect(frame).toContain('alpha.ts')
  expect(frame).toContain('beta.ts')
  expect(frame).toContain('+2 −1') // beta's own counts on its row

  await press(t, i => void i.typeText('bet'))
  frame = t.captureCharFrame()
  // Filtered out of the list — the one hit left is the pane header behind it.
  expect(frame.match(/alpha\.ts/g)).toHaveLength(1)
  await press(t, i => i.pressEnter())

  frame = t.captureCharFrame()
  expect(frame).toContain('file 2/2')
  expect(frame).toContain('+ BETA')
})

test('Esc closes the picker but keeps the diff open', async () => {
  const dir = repo({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  writeFileSync(join(dir, 'a.ts'), 'ALPHA\n')
  writeFileSync(join(dir, 'b.ts'), 'BETA\n')

  const t = await launch(dir)
  await runCommand(t, 'Diff all changes')
  await press(t, i => void i.typeText('f'))
  expect(t.captureCharFrame()).toContain('Changed files')

  await pressEscape(t)
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Changed files')
  expect(frame).toContain('file 1/2') // still in the diff
})

test('an untracked file diffs as all additions', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })
  writeFileSync(join(dir, 'new.ts'), 'fresh\nlines\n')

  const t = await launch(dir)
  await runCommand(t, 'Diff all changes')

  const frame = t.captureCharFrame()
  expect(frame).toContain('new.ts')
  expect(frame).toContain('+ fresh')
  expect(frame).toContain('+ lines')
})

test('long unchanged stretches stay out of the hunks', async () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line${i}`)
  const dir = repo({ 'a.ts': `${lines.join('\n')}\n` })
  const changed = [...lines]
  changed[0] = 'CHANGED'
  writeFileSync(join(dir, 'a.ts'), `${changed.join('\n')}\n`)

  const t = await launch(dir, {}, { height: 30 })
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await runCommand(t, 'Diff current file')

  const frame = t.captureCharFrame()
  expect(frame).toContain('CHANGED')
  expect(frame).toContain('line2') // context under the change
  expect(frame).not.toContain('line10') // deep in the unchanged middle — not shown
})

test('Esc closes the diff and returns to the editor', async () => {
  const dir = repo({ 'a.ts': 'one\n' })
  writeFileSync(join(dir, 'a.ts'), 'ONE\n')

  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await runCommand(t, 'Diff current file')
  expect(t.captureCharFrame()).toContain('+1 −1')

  await pressEscape(t)
  expect(t.captureCharFrame()).not.toContain('+1 −1')
  expect(t.captureCharFrame()).toContain('ONE')
})

test('the mouse wheel scrolls the diff', async () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line${i}`)
  const dir = repo({ 'a.ts': `${lines.join('\n')}\n` })
  // Touch every line so nothing collapses and the diff is taller than the screen.
  writeFileSync(join(dir, 'a.ts'), `${lines.map(l => `${l}!`).join('\n')}\n`)

  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await runCommand(t, 'Diff current file')
  expect(t.captureCharFrame()).toContain('- line0')

  await t.mockMouse.scroll(60, 10, 'down')
  await settle(t)
  expect(t.captureCharFrame()).not.toContain('- line0')

  await t.mockMouse.scroll(60, 10, 'up')
  await settle(t)
  expect(t.captureCharFrame()).toContain('- line0')
})

test('the diff keeps tabs and status bar but takes the sidebar width', async () => {
  const dir = repo({ 'a.ts': 'one\n' })
  writeFileSync(join(dir, 'a.ts'), 'ONE\n')

  const t = await launch(dir)
  expect(t.captureCharFrame()).toContain('explorer')
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await runCommand(t, 'Diff current file')

  const frame = t.captureCharFrame()
  expect(frame).toContain('+1 −1') // the diff itself
  expect(frame).not.toContain('explorer') // sidebar makes way for the pane
  const lines = frame.split('\n')
  expect(lines[0]).toContain('a.ts') // tab row still up top
  expect(lines.at(-2)).toContain('⎇ main') // status bar still below

  await pressEscape(t)
  expect(t.captureCharFrame()).toContain('explorer') // and it comes back
})

test('a long path is cut from the left so the hints stay on screen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'druk-diff-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  const deep = 'a-very/deeply/nested/folder/structure/with-a-quite-long-file-name.test.tsx'
  mkdirSync(join(dir, deep, '..'), { recursive: true })
  writeFileSync(join(dir, deep), 'one\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  writeFileSync(join(dir, deep), 'ONE\n')

  const t = await launch(dir)
  await runCommand(t, 'Diff all changes')

  const headerRow = t.captureCharFrame().split('\n')[1]!
  expect(headerRow).toContain('Esc close') // hints survived
  expect(headerRow).toContain('…') // the path gave way instead
  expect(headerRow).toContain('long-file-name.test.tsx') // and kept its tail
})

test('removed lines highlight like added ones in split view', async () => {
  // The panes show fragments, and tree-sitter's error recovery on the removed
  // side used to drop JSX attribute captures — this is the exact shape that broke.
  const base = [
    'export function App() {',
    '  return (',
    '    <Show>',
    '      <EditorPane',
    '        path={workspace.activePath()}',
    '        theme={config.theme}',
    '      />',
    '    </Show>',
    '  )',
    '}',
    '',
  ].join('\n')
  const dir = repo({ 'a.tsx': base })
  writeFileSync(join(dir, 'a.tsx'), base.replace('theme={config.theme}', 'mode={config.mode}'))

  const t = await launch(dir, { diffView: 'split' }, { width: 130 })
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await runCommand(t, 'Diff current file')
  await settle(t, 600) // the async highlight pass has to land

  const spans = (t.captureSpans() as { lines: { spans: Span[] }[] }).lines
    .map(line => line.spans)
    .find(line => line.some(span => span.text === 'theme'))!
  expect(spans).toBeDefined()
  const fgOf = (text: string) => String(spans.find(span => span.text === text)?.fg)
  // The removed side's attribute name wears the same color as the added side's.
  expect(fgOf('theme')).toBe(fgOf('mode')!)
  // And it is a real syntax color, not the plain-text fallback.
  expect(fgOf('theme')).not.toBe(fgOf('=')!)
})

test('a clean working tree refuses with a status message', async () => {
  const t = await launch(repo({ 'a.ts': 'alpha\n' }))
  await runCommand(t, 'Diff all changes')
  expect(t.captureCharFrame()).toContain('working tree clean')
})

test('unsaved edits diff against HEAD before the file is saved', async () => {
  const dir = repo({ 'a.ts': 'alpha\n' })

  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await press(t, i => void i.typeText('typed '))
  await runCommand(t, 'Diff current file')

  const frame = t.captureCharFrame()
  expect(frame).toContain('- alpha')
  expect(frame).toContain('+ typed alpha')
})

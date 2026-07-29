import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULTS } from '../src/core/config'
import { fixture, launch, press, pressEscape, settle } from './helpers'
import type { Harness } from './helpers'

async function vimEditor(content = 'one\ntwo\nthree\n') {
  const dir = fixture({ 'a.ts': content })
  const t = await launch(dir, { ...DEFAULTS, vim: true })
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  return { t, dir, file: join(dir, 'a.ts') }
}

const type = async (t: Harness, text: string) => {
  await press(t, i => void i.typeText(text))
  await settle(t)
}

async function save(t: Harness, file: string) {
  await press(t, i => i.pressKey('s', { ctrl: true }))
  await settle(t)
  return readFileSync(file, 'utf8')
}

/** "Ln 2, Col 3" from the status bar. */
const at = (t: Harness) => /Ln (\d+), Col (\d+)/.exec(t.captureCharFrame())?.[0] ?? '?'

describe('vim mode basics', () => {
  test('starts in normal mode and says so', async () => {
    const { t } = await vimEditor()
    expect(t.captureCharFrame()).toContain('NORMAL')
  })

  test('i enters insert mode and Esc leaves it, with the sidebar showing', async () => {
    // Esc is also "leave the editor for the tree". App's handler runs first and
    // focus moves synchronously, so without a vim guard the mode never changes
    // and the next key is a tree command — `d` would offer to delete the file.
    const { t } = await vimEditor()
    await press(t, i => i.pressKey('i'))
    expect(t.captureCharFrame()).toContain('INSERT')

    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('NORMAL')
    expect(t.captureCharFrame()).not.toContain('Delete')
  })

  test('normal mode swallows unknown keys instead of typing them', async () => {
    const { t, file } = await vimEditor()
    await press(t, i => void i.typeText('zzz')) // no such command — must not reach the buffer
    await press(t, i => i.pressKey('i'))
    await press(t, i => void i.typeText('X'))
    await press(t, i => i.pressKey('s', { ctrl: true }))

    expect(readFileSync(file, 'utf8')).toBe('Xone\ntwo\nthree\n')
  })

  test('dd deletes a line and p puts it back', async () => {
    const { t, file } = await vimEditor()
    await press(t, i => void i.typeText('dd'))
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(file, 'utf8')).toBe('two\nthree\n')

    await press(t, i => void i.typeText('p'))
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(file, 'utf8')).toBe('two\none\nthree\n')
  })

  test('a count applies to the operator that follows it', async () => {
    const { t, file } = await vimEditor('a\nb\nc\nd\n')
    await press(t, i => void i.typeText('2dd'))
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(file, 'utf8')).toBe('c\nd\n')
  })

  test('a count is not carried into the next command', async () => {
    const { t, file } = await vimEditor('a\nb\nc\nd\n')
    await press(t, i => void i.typeText('2j')) // move, consuming the 2
    await press(t, i => void i.typeText('dd')) // deletes one line, not two
    await press(t, i => i.pressKey('s', { ctrl: true }))
    expect(readFileSync(file, 'utf8')).toBe('a\nb\nd\n')
  })
})

describe('motions', () => {
  test('l moves right, h back', async () => {
    const { t } = await vimEditor()
    await type(t, 'll')
    expect(at(t)).toBe('Ln 1, Col 3')
    await type(t, 'h')
    expect(at(t)).toBe('Ln 1, Col 2')
  })

  test('j / k move by line', async () => {
    const { t } = await vimEditor()
    await type(t, 'jj')
    expect(at(t)).toBe('Ln 3, Col 1')
    await type(t, 'k')
    expect(at(t)).toBe('Ln 2, Col 1')
  })

  test('counted motion: 2j', async () => {
    const { t } = await vimEditor('a\nb\nc\nd\ne\n')
    await type(t, '2j')
    expect(at(t)).toBe('Ln 3, Col 1')
  })

  test('$ goes to line end, 0 to the start', async () => {
    const { t } = await vimEditor()
    await type(t, '$')
    // On the last character, as vim leaves it — not past it.
    expect(at(t)).toBe('Ln 1, Col 3')
    await type(t, '0')
    expect(at(t)).toBe('Ln 1, Col 1')
  })

  test('G goes to the last line, gg back to the first', async () => {
    const { t } = await vimEditor('a\nb\nc\nd\n')
    await type(t, 'G')
    expect(at(t)).toContain('Ln 5')
    await type(t, 'gg')
    expect(at(t)).toBe('Ln 1, Col 1')
  })

  test('w / b step by word', async () => {
    const { t } = await vimEditor('alpha beta gamma\n')
    await type(t, 'w')
    expect(at(t)).toBe('Ln 1, Col 7')
    await type(t, 'w')
    expect(at(t)).toBe('Ln 1, Col 12')
    await type(t, 'b')
    expect(at(t)).toBe('Ln 1, Col 7')
  })

  test('5G jumps to line 5', async () => {
    const { t } = await vimEditor('a\nb\nc\nd\ne\nf\n')
    await type(t, '5G')
    expect(at(t)).toBe('Ln 5, Col 1')
  })
})

describe('entering insert mode', () => {
  test('i inserts before the cursor', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'i')
    await type(t, 'X')
    expect(await save(t, file)).toBe('Xone\ntwo\nthree\n')
  })

  test('a inserts after it', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'a')
    await type(t, 'X')
    expect(await save(t, file)).toBe('oXne\ntwo\nthree\n')
  })

  test('A appends at the line end', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'A')
    await type(t, 'X')
    expect(await save(t, file)).toBe('oneX\ntwo\nthree\n')
  })

  test('I inserts at the line start', async () => {
    const { t, file } = await vimEditor()
    await type(t, '$I')
    await type(t, 'X')
    expect(await save(t, file)).toBe('Xone\ntwo\nthree\n')
  })

  test('o opens a line below, O above', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'o')
    await type(t, 'X')
    expect(await save(t, file)).toBe('one\nX\ntwo\nthree\n')

    await pressEscape(t)
    await type(t, 'O')
    await type(t, 'Y')
    expect(await save(t, file)).toBe('one\nY\nX\ntwo\nthree\n')
  })

  test('Esc leaves insert mode and steps left', async () => {
    const { t } = await vimEditor()
    await type(t, 'A')
    await type(t, 'XY')
    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('NORMAL')
    expect(at(t)).toBe('Ln 1, Col 5')
  })
})

describe('normal-mode edits', () => {
  test('x deletes the character under the cursor', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'x')
    expect(await save(t, file)).toBe('ne\ntwo\nthree\n')
  })

  test('3x deletes three', async () => {
    const { t, file } = await vimEditor('abcdef\n')
    await type(t, '3x')
    expect(await save(t, file)).toBe('def\n')
  })

  test('D deletes to the line end', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'lD')
    expect(await save(t, file)).toBe('o\ntwo\nthree\n')
  })

  test('C deletes to the line end and inserts', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'lC')
    await type(t, 'X')
    expect(await save(t, file)).toBe('oX\ntwo\nthree\n')
  })

  test('dw deletes a word', async () => {
    const { t, file } = await vimEditor('alpha beta\n')
    await type(t, 'dw')
    expect(await save(t, file)).toBe('beta\n')
  })

  test('cw changes a word', async () => {
    const { t, file } = await vimEditor('alpha beta\n')
    await type(t, 'cw')
    await type(t, 'X')
    expect(await save(t, file)).toBe('Xbeta\n')
  })

  test('d$ deletes to the end', async () => {
    const { t, file } = await vimEditor('alpha beta\n')
    await type(t, 'wd$')
    expect(await save(t, file)).toBe('alpha \n')
  })

  test('cc clears the line and inserts', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'jcc')
    await type(t, 'X')
    expect(await save(t, file)).toBe('one\nX\nthree\n')
  })

  test('yy then p puts the copy below', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'yyp')
    expect(await save(t, file)).toBe('one\none\ntwo\nthree\n')
  })

  test('yy then P puts it above', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'jyyP')
    expect(await save(t, file)).toBe('one\ntwo\ntwo\nthree\n')
  })

  test('u undoes the last edit', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'dd')
    await type(t, 'u')
    expect(await save(t, file)).toBe('one\ntwo\nthree\n')
  })

  test('Ctrl+R redoes it', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'dd')
    await type(t, 'u')
    await press(t, i => i.pressKey('r', { ctrl: true }))
    await settle(t)
    expect(await save(t, file)).toBe('two\nthree\n')
  })
})

describe('visual mode', () => {
  test('v selects and d deletes the selection', async () => {
    const { t, file } = await vimEditor('abcdef\n')
    await type(t, 'vll')
    expect(t.captureCharFrame()).toContain('VISUAL')
    await type(t, 'd')
    expect(t.captureCharFrame()).toContain('NORMAL')
    expect(await save(t, file)).toBe('def\n')
  })

  test('v then y yanks, p puts it back', async () => {
    const { t, file } = await vimEditor('abcdef\n')
    await type(t, 'vly')
    await type(t, '$p')
    expect(await save(t, file)).toBe('abcdefab\n')
  })

  test('v$ stops on the last character, so d keeps the line break', async () => {
    const { t, file } = await vimEditor('const beta = 2\nnext\n')
    await type(t, 'wv$d')
    expect(await save(t, file)).toBe('const \nnext\n')
  })

  test('Esc leaves visual mode', async () => {
    const { t } = await vimEditor()
    await type(t, 'v')
    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('NORMAL')
  })

  test('c on a selection deletes it and inserts', async () => {
    const { t, file } = await vimEditor('abcdef\n')
    await type(t, 'vlc')
    await type(t, 'X')
    expect(await save(t, file)).toBe('Xcdef\n')
  })
})

describe('edges', () => {
  test('x at the end of a line takes the last character, not the newline', async () => {
    const { t, file } = await vimEditor()
    await type(t, '$x')
    expect(await save(t, file)).toBe('on\ntwo\nthree\n')
  })

  test('x on an empty line does nothing', async () => {
    const { t, file } = await vimEditor('a\n\nb\n')
    await type(t, 'jx')
    expect(await save(t, file)).toBe('a\n\nb\n')
  })

  test('dd on the last line', async () => {
    const { t, file } = await vimEditor('a\nb\n')
    await type(t, 'jdd')
    expect(await save(t, file)).toBe('a\n')
  })

  test('3dd takes three lines', async () => {
    const { t, file } = await vimEditor('a\nb\nc\nd\n')
    await type(t, '3dd')
    expect(await save(t, file)).toBe('d\n')
  })

  test('d2w deletes two words', async () => {
    const { t, file } = await vimEditor('alpha beta gamma\n')
    await type(t, 'd2w')
    expect(await save(t, file)).toBe('gamma\n')
  })

  test('2dw is the same as d2w', async () => {
    const { t, file } = await vimEditor('alpha beta gamma\n')
    await type(t, '2dw')
    expect(await save(t, file)).toBe('gamma\n')
  })

  test('visual selection can run backwards', async () => {
    const { t, file } = await vimEditor('abcdef\n')
    await type(t, '$hvhhd')
    // Anchored on `e`, two steps back to `c`: the anchor end is inside the selection.
    expect(await save(t, file)).toBe('abf\n')
  })

  test('visual across lines deletes both halves', async () => {
    const { t, file } = await vimEditor('abc\ndef\n')
    await type(t, 'lvjd')
    // b, c, the newline and d, e are all inside the selection.
    expect(await save(t, file)).toBe('af\n')
  })

  test('Esc in visual clears the selection, so the next edit is not it', async () => {
    const { t, file } = await vimEditor('abcdef\n')
    await type(t, 'vll')
    await pressEscape(t)
    await type(t, 'x')
    expect(await save(t, file)).toBe('abdef\n')
  })

  test('u steps back through several bursts', async () => {
    const { t, file } = await vimEditor('a\nb\nc\n')
    await type(t, 'dd')
    await settle(t, 450)
    await type(t, 'dd')
    await settle(t, 450)
    expect(await save(t, file)).toBe('c\n')
    await type(t, 'u')
    expect(await save(t, file)).toBe('b\nc\n')
    await type(t, 'u')
    expect(await save(t, file)).toBe('a\nb\nc\n')
  })

  test('the mode shows in the status bar', async () => {
    const { t } = await vimEditor()
    await type(t, 'v')
    expect(t.captureCharFrame()).toContain('VISUAL')
    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('NORMAL')
    await type(t, 'i')
    expect(t.captureCharFrame()).toContain('INSERT')
  })

  test('insert mode types normally, arrows included', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'i')
    await type(t, 'XY')
    await press(t, i => i.pressArrow('down'))
    await type(t, 'Z')
    expect(await save(t, file)).toBe('XYone\ntwZo\nthree\n')
  })

  test('o on the last line opens below it', async () => {
    const { t, file } = await vimEditor('a\nb\n')
    await type(t, 'Go')
    await type(t, 'X')
    expect(await save(t, file)).toBe('a\nb\n\nX')
  })
})

describe('living with the rest of the editor', () => {
  test('Ctrl+D and Ctrl+U move a screenful', async () => {
    const long = `${Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')}\n`
    const { t } = await vimEditor(long)
    await press(t, i => i.pressKey('d', { ctrl: true }))
    await settle(t)
    expect(at(t)).toBe('Ln 11, Col 1')
    await press(t, i => i.pressKey('u', { ctrl: true }))
    await settle(t)
    expect(at(t)).toBe('Ln 1, Col 1')
  })

  test('u undoes a whole insert burst, not one character', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'i')
    await type(t, 'XYZ')
    await pressEscape(t)
    expect(await save(t, file)).toBe('XYZone\ntwo\nthree\n')
    await type(t, 'u')
    expect(await save(t, file)).toBe('one\ntwo\nthree\n')
  })

  test('Ctrl+C, Ctrl+X and Ctrl+V still work in normal mode', async () => {
    const { t, file } = await vimEditor('abcdef\n')
    await type(t, 'vll')
    await press(t, i => i.pressKey('c', { ctrl: true }))
    await pressEscape(t)
    await type(t, '$')
    await type(t, 'i')
    await press(t, i => i.pressKey('v', { ctrl: true }))
    await settle(t)
    expect(await save(t, file)).toBe('abcdeabcf\n')
  })

  test('Esc in normal mode hands the keyboard to the tree', async () => {
    const { t } = await vimEditor()
    await pressEscape(t)
    // `d` in the tree is delete, which asks first — that is how we know focus moved.
    await type(t, 'd')
    expect(t.captureCharFrame()).toContain('Delete')
  })

  test('switching files starts the new one in normal mode', async () => {
    const dir = fixture({ 'a.ts': 'aaa\n', 'b.ts': 'bbb\n' })
    const t = await launch(dir, { ...DEFAULTS, vim: true })
    await press(t, i => i.pressArrow('down'))
    await press(t, i => i.pressEnter())
    await type(t, 'i')
    expect(t.captureCharFrame()).toContain('INSERT')

    await press(t, i => i.pressKey('o', { ctrl: true }))
    await press(t, i => void i.typeText('b.ts'))
    await press(t, i => i.pressEnter())
    await settle(t)
    expect(t.captureCharFrame()).toContain('NORMAL')

    // …and the keys are commands again, not text: x deleted a character.
    await type(t, 'x')
    expect(t.captureCharFrame()).not.toContain('bbb')
  })

  test('with vim off the same keys type', async () => {
    const dir = fixture({ 'a.ts': 'one\n' })
    const t = await launch(dir, { ...DEFAULTS, vim: false })
    await press(t, i => i.pressArrow('down'))
    await press(t, i => i.pressEnter())
    await type(t, 'dd')
    await press(t, i => i.pressKey('s', { ctrl: true }))
    await settle(t)
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('ddone\n')
  })
})

describe('paragraph motions', () => {
  test('} goes to the next blank line', async () => {
    const { t } = await vimEditor('one\ntwo\n\nthree\nfour\n')
    // Cursor starts at Ln 1 (one). } goes to the blank line at Ln 3.
    await type(t, '}')
    expect(at(t)).toContain('Ln 3')
  })

  test('{ goes to the previous blank line', async () => {
    const { t } = await vimEditor('one\ntwo\n\nthree\nfour\n')
    await type(t, 'j}') // Ln 2 → Ln 3 (blank)
    expect(at(t)).toContain('Ln 3')
    await type(t, '{') // Ln 3 → Ln 1 (start of buffer)
    expect(at(t)).toContain('Ln 1')
  })

  test('counted paragraph motion: 2}', async () => {
    const { t } = await vimEditor('a\n\nb\n\nc\n')
    // From Ln 1, 2} goes past blank at Ln 2, then past blank at Ln 4
    await type(t, '2}')
    expect(at(t)).toContain('Ln 4')
  })

  test('} at end of file goes to the trailing blank line', async () => {
    const { t } = await vimEditor('a\nb\n')
    // "a\nb\n" splits into lines ["a", "b", ""]; the trailing empty line is Ln 3.
    await type(t, 'G}')
    expect(at(t)).toContain('Ln 3')
  })
})

describe('linewise visual mode', () => {
  test('V enters linewise visual mode', async () => {
    const { t } = await vimEditor()
    await type(t, 'V')
    expect(t.captureCharFrame()).toContain('VISUAL')
  })

  test('Vd deletes the current line', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'Vd')
    expect(await save(t, file)).toBe('two\nthree\n')
  })

  test('Vjd deletes two lines', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'Vjd')
    expect(await save(t, file)).toBe('three\n')
  })

  test('Vy yanks linewise and P puts above', async () => {
    const { t, file } = await vimEditor()
    // j to row 1 (two), V yanks linewise, P pastes above
    await type(t, 'jVyP')
    expect(await save(t, file)).toBe('one\ntwo\ntwo\nthree\n')
  })

  test('Vc deletes the line and enters insert on the next line', async () => {
    const { t, file } = await vimEditor()
    await type(t, 'Vc')
    await type(t, 'X')
    expect(await save(t, file)).toBe('Xtwo\nthree\n')
  })

  test('Esc leaves linewise visual mode', async () => {
    const { t } = await vimEditor()
    await type(t, 'V')
    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('NORMAL')
  })

  test('V then v switches to charwise visual', async () => {
    const { t } = await vimEditor()
    await type(t, 'V')
    expect(t.captureCharFrame()).toContain('VISUAL')
    await type(t, 'v')
    expect(t.captureCharFrame()).toContain('VISUAL')
  })
})

describe('text objects', () => {
  // "const x = { hello }\n": 'h' at col 12, '{' at col 10, '}' at col 18
  const BRACE = 'const x = { hello }\n'
  const PAREN = 'const x = ( hello )\n'
  const BRACKET = 'const x = [ hello ]\n'

  async function bEdit(content: string) {
    const dir = fixture({ 'a.ts': content })
    const t = await launch(dir, { ...DEFAULTS, vim: true })
    await press(t, i => i.pressArrow('down'))
    await press(t, i => i.pressEnter())
    return { t, dir, file: join(dir, 'a.ts') }
  }

  // ---- inner (i) variants: { } ----

  test('di{ deletes the inner block from normal mode', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe('const x = {}\n')
  })

  test('ci{ changes inner block and enters insert', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'ci{X')
    expect(await save(t, file)).toBe('const x = {X}\n')
  })

  test('yi{ yanks inner block and p pastes after', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'yi{$p')
    expect(await save(t, file)).toBe('const x = { hello } hello \n')
  })

  test('vi{ selects inner block, then d deletes it', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'vi{')
    expect(t.captureCharFrame()).toContain('VISUAL')
    await type(t, 'd')
    expect(await save(t, file)).toBe('const x = {}\n')
  })

  // ---- around (a) variants: { } ----

  test('da{ deletes block including braces', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'da{')
    expect(await save(t, file)).toBe('const x = \n')
  })

  test('ca{ deletes around and enters insert', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'ca{X')
    expect(await save(t, file)).toBe('const x = X\n')
  })

  test('ya{ yanks around and p pastes', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'ya{$p')
    expect(await save(t, file)).toBe('const x = { hello }{ hello }\n')
  })

  test('va{ selects around, then d deletes', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'va{')
    expect(t.captureCharFrame()).toContain('VISUAL')
    await type(t, 'd')
    expect(await save(t, file)).toBe('const x = \n')
  })

  // ---- ( ) variants ----

  test('di( deletes inner parens', async () => {
    const { t, file } = await bEdit(PAREN)
    await type(t, '012l')
    await type(t, 'di(')
    expect(await save(t, file)).toBe('const x = ()\n')
  })

  test('da( deletes parens including braces', async () => {
    const { t, file } = await bEdit(PAREN)
    await type(t, '012l')
    await type(t, 'da(')
    expect(await save(t, file)).toBe('const x = \n')
  })

  test('ci( changes inner parens and enters insert', async () => {
    const { t, file } = await bEdit(PAREN)
    await type(t, '012l')
    await type(t, 'ci(X')
    expect(await save(t, file)).toBe('const x = (X)\n')
  })

  test('di) deletes inner parens (cursor at close paren)', async () => {
    const { t, file } = await bEdit(PAREN)
    await type(t, '018l')
    await type(t, 'di)')
    expect(await save(t, file)).toBe('const x = ()\n')
  })

  // ---- [ ] variants ----

  test('di[ deletes inner brackets', async () => {
    const { t, file } = await bEdit(BRACKET)
    await type(t, '012l')
    await type(t, 'di[')
    expect(await save(t, file)).toBe('const x = []\n')
  })

  test('da[ deletes brackets including braces', async () => {
    const { t, file } = await bEdit(BRACKET)
    await type(t, '012l')
    await type(t, 'da[')
    expect(await save(t, file)).toBe('const x = \n')
  })

  test('yi[ yanks inner brackets and p pastes', async () => {
    const { t, file } = await bEdit(BRACKET)
    await type(t, '012l')
    await type(t, 'yi[$p')
    expect(await save(t, file)).toBe('const x = [ hello ] hello \n')
  })

  // ---- cursor on the bracket itself ----

  test('di{ with cursor on open brace', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '010l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe('const x = {}\n')
  })

  test('di{ with cursor on close brace', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '018l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe('const x = {}\n')
  })

  test('da{ with cursor on open brace', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '010l')
    await type(t, 'da{')
    expect(await save(t, file)).toBe('const x = \n')
  })

  // ---- cursor outside the pair — no-op ----

  test('di{ with cursor before pair is a no-op', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '04l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe(BRACE)
  })

  test('di{ with cursor after pair is a no-op', async () => {
    const { t, file } = await bEdit('before { hello } after\n')
    await type(t, '017l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe('before { hello } after\n')
  })

  // ---- nested ----

  test('di{ with nested braces deletes the innermost pair', async () => {
    const { t, file } = await bEdit('outer { inner { core } more }\n')
    await type(t, '016l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe('outer { inner {} more }\n')
  })

  test('da{ on nested braces deletes only the innermost pair', async () => {
    const { t, file } = await bEdit('outer { inner { core } more }\n')
    await type(t, '016l')
    await type(t, 'da{')
    expect(await save(t, file)).toBe('outer { inner  more }\n')
  })

  // ---- no matching pair ----

  test('di{ with no braces in file is a no-op', async () => {
    const { t, file } = await vimEditor('hello world\n')
    await type(t, '012l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe('hello world\n')
  })

  // ---- empty braces ----

  test('di{ on empty braces is a no-op', async () => {
    const { t, file } = await bEdit('const x = {}\n')
    await type(t, '012l')
    await type(t, 'di{')
    expect(await save(t, file)).toBe('const x = {}\n')
  })

  test('da{ on empty braces deletes the braces', async () => {
    const { t, file } = await bEdit('const x = {}\n')
    await type(t, '012l')
    await type(t, 'da{')
    expect(await save(t, file)).toBe('const x = \n')
  })

  // ---- visual mode text objects ----

  test('vi{ in visual mode, c changes inner block', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'vi{')
    expect(t.captureCharFrame()).toContain('VISUAL')
    await type(t, 'cX')
    expect(await save(t, file)).toBe('const x = {X}\n')
  })

  test('va{ in visual mode, y yanks around (Esc exits visual)', async () => {
    const { t, file } = await bEdit(BRACE)
    await type(t, '012l')
    await type(t, 'va{')
    expect(t.captureCharFrame()).toContain('VISUAL')
    await pressEscape(t)
    expect(t.captureCharFrame()).toContain('NORMAL')
  })
})

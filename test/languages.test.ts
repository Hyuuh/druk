import { describe, expect, test } from 'bun:test'

import { LANGUAGES, languageFor, languageLabel } from '../src/languages'
import { computeHighlights, getSyntaxStyle, segmentsIn, STALE } from '../src/languages/highlight'
import type { Highlighted } from '../src/languages/highlight'
import { allSegments, parseHighlights, WHOLE } from './syntax'

const SAMPLES: Record<string, string> = {
  python: 'import os\ndef f(x):\n    # c\n    return x + 1\n',
  rust: 'fn main() {\n    let x: i32 = 1; // c\n}\n',
  go: 'package main\n// c\nfunc main() { return }\n',
  typescriptreact: '// c\nconst A = () => <div className="a">{1}</div>\n',
  vue: '<template>\n  <!-- c -->\n  <div class="a">x</div>\n</template>\n',
  css: '.a { color: #fff; }\n/* c */\n',
  scss: '/* c */\n$brand: #f00;\n.a { color: $brand; &:hover { top: 1px } }\n',
  sass: '/* c */\n.a\n  top: 1px\n',
  php: '<?php\n// c\nfunction f($x) { return $x; }\n',
  ruby: '# c\nclass A\n  def go(x)\n    x\n  end\nend\n',
  java: '// c\nclass A { void m() { int x = 1; } }\n',
  c: '// c\nint main(void) { return 0; }\n',
  cpp: '// c\nint main() { int x = 1; return x; }\n',
  csharp: '// c\nclass A { void M() { int x = 1; } }\n',
  bash: '# c\nfor f in *.ts; do echo "$f"; done\n',
  lua: '-- c\nlocal function f(x) return x end\n',
  toml: '# c\n[pkg]\nname = "x"\n',
  swift: '// c\nfunc go(x: Int) -> Int { return x }\n',
  kotlin: '// c\nfun main() { val x = 1 }\n',
  dart: '// c\nvoid main() { var x = 1; }\n',
  elixir: '# c\ndefmodule A do\n  def go(x), do: x\nend\n',
  scala: '// c\nobject A { def go(x: Int): Int = x }\n',
  yaml: '# c\na:\n  b: true\n',
  svelte: '<!-- c -->\n<script>let x = 1</script>\n<div class="a">{x}</div>\n',
  sql: '-- c\nSELECT id FROM users WHERE age > 18;\n',
  ini: '; c\n[section]\nkey = value\n',
  dotenv: '# c\nexport PORT=3000\nURL="https://x.dev"\n',
}

describe('languages', () => {
  test('every registered language declares a grammar or patterns', () => {
    for (const lang of LANGUAGES) {
      const usable = lang.bundled || (lang.wasm && lang.query) || lang.patterns
      expect(`${lang.id}:${usable ? 'ok' : 'unusable'}`).toBe(`${lang.id}:ok`)
    }
  })

  test('a label, where there is one, is shorter than the id it replaces', () => {
    // The point of `label` is that OpenTUI's filetype name is a mouthful. One that
    // is not shorter is a label with no reason to exist.
    for (const lang of LANGUAGES.filter(l => l.label)) {
      expect(`${lang.id} -> ${lang.label}`).toBe(`${lang.id} -> ${lang.label}`)
      expect(lang.label!.length).toBeLessThan(lang.id.length)
    }
  })

  test('labels stand in for the id on screen, and only where set', () => {
    expect(languageLabel('typescriptreact')).toBe('tsx')
    expect(languageLabel('javascriptreact')).toBe('jsx')
    expect(languageLabel('typescript')).toBe('ts')
    expect(languageLabel('javascript')).toBe('js')
    expect(languageLabel('markdown')).toBe('md')
    // Everything else is already short enough to show as-is.
    expect(languageLabel('python')).toBe('python')
    expect(languageLabel('css')).toBe('css')
    // Not a registered filetype at all — the status bar still has to say something.
    expect(languageLabel('plain')).toBe('plain')
  })

  test('ids are unique', () => {
    const ids = LANGUAGES.map(l => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const [filetype, source] of Object.entries(SAMPLES)) {
    test(`${filetype} highlights`, async () => {
      expect(languageFor(filetype)).toBeDefined()
      const segs = await allSegments(source, filetype)
      // At least a comment must be recognised, so the query really ran.
      const comment = getSyntaxStyle().getStyleId('comment')
      expect(segs.some(s => s.styleId === comment)).toBe(true)
    }, 15000)
  }
})

describe('abandoning a highlight that arrived too late', () => {
  const SOURCE = 'const alpha = 1 // note\n'

  test('says STALE instead of preparing work nobody will use', async () => {
    // The parse itself already happened in the worker; the point is to skip the
    // sort and the per-character segmentation and let the caller drop the result.
    expect(await computeHighlights(SOURCE, 'typescript', 2, () => true)).toBe(STALE)
  })

  test('still segments normally while the text is current', async () => {
    const parsed = await computeHighlights(SOURCE, 'typescript', 2, () => false)
    expect(parsed).not.toBe(STALE)
    const comment = getSyntaxStyle().getStyleId('comment')
    expect(segmentsIn(parsed as Highlighted, 0, WHOLE).some(s => s.styleId === comment)).toBe(true)
  })

  test('a caller that asks nothing can never be handed STALE', async () => {
    expect(await computeHighlights(SOURCE, 'typescript', 2)).not.toBe(STALE)
  })
})

describe('segmenting a window instead of the document', () => {
  const source = `${Array.from(
    { length: 300 },
    (_, i) => `export const value${i} = ${i} // note ${i}`,
  ).join('\n')}\n`

  const key = (s: { line: number; start: number; end: number; styleId: number }) =>
    `${s.line}:${s.start}-${s.end}:${s.styleId}`

  test('a window matches what a full segmentation produces for those lines', async () => {
    const parsed = await parseHighlights(source, 'typescript')
    const whole = segmentsIn(parsed, 0, WHOLE)

    for (const [from, to] of [
      [0, 40],
      [100, 160],
      [260, 299],
    ] as const) {
      const windowed = segmentsIn(parsed, from, to).map(key).toSorted()
      const expected = whole
        .filter(s => s.line >= from && s.line <= to)
        .map(key)
        .toSorted()
      expect(`${from}-${to}: ${windowed.join('|')}`).toBe(`${from}-${to}: ${expected.join('|')}`)
    }
  }, 20000)

  test('stitching every window back together reproduces the whole file', async () => {
    const parsed = await parseHighlights(source, 'typescript')
    const whole = segmentsIn(parsed, 0, WHOLE).map(key).toSorted()

    const stitched: string[] = []
    for (let from = 0; from <= 300; from += 37) {
      stitched.push(...segmentsIn(parsed, from, from + 36).map(key))
    }
    expect(stitched.toSorted()).toEqual(whole)
  }, 20000)
})

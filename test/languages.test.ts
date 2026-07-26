import { describe, expect, test } from 'bun:test'

import { LANGUAGES, languageFor } from '../src/languages'
import { computeSegments, getSyntaxStyle } from '../src/languages/highlight'

const SAMPLES: Record<string, string> = {
  python: 'import os\ndef f(x):\n    # c\n    return x + 1\n',
  rust: 'fn main() {\n    let x: i32 = 1; // c\n}\n',
  go: 'package main\n// c\nfunc main() { return }\n',
  typescriptreact: '// c\nconst A = () => <div className="a">{1}</div>\n',
  vue: '<template>\n  <!-- c -->\n  <div class="a">x</div>\n</template>\n',
  css: '.a { color: #fff; }\n/* c */\n',
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
}

describe('languages', () => {
  test('every registered language declares a grammar or patterns', () => {
    for (const lang of LANGUAGES) {
      const usable = lang.bundled || (lang.wasm && lang.query) || lang.patterns
      expect(`${lang.id}:${usable ? 'ok' : 'unusable'}`).toBe(`${lang.id}:ok`)
      expect(lang.name.length).toBeGreaterThan(0)
    }
  })

  test('ids are unique', () => {
    const ids = LANGUAGES.map(l => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const [filetype, source] of Object.entries(SAMPLES)) {
    test(`${filetype} highlights`, async () => {
      expect(languageFor(filetype)).toBeDefined()
      const segs = await computeSegments(source, filetype, 2)
      expect(segs).not.toBeNull()
      // At least a comment must be recognised, so the query really ran.
      const comment = getSyntaxStyle().getStyleId('comment')
      expect(segs!.some(s => s.styleId === comment)).toBe(true)
    }, 15000)
  }
})

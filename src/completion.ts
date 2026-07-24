// Lightweight completion: words already in the buffer + language keywords.
// No language server — just prefix matching against what's on screen.

const JS_KEYWORDS = [
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'of',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'yield',
  'null',
  'undefined',
  'true',
  'false',
]

const TS_KEYWORDS = [
  ...JS_KEYWORDS,
  'abstract',
  'any',
  'as',
  'boolean',
  'declare',
  'enum',
  'implements',
  'infer',
  'interface',
  'is',
  'keyof',
  'namespace',
  'never',
  'number',
  'object',
  'private',
  'protected',
  'public',
  'readonly',
  'satisfies',
  'string',
  'symbol',
  'type',
  'unknown',
]

const KEYWORDS: Record<string, string[]> = {
  javascript: JS_KEYWORDS,
  typescript: TS_KEYWORDS,
}

const WORD = /[A-Za-z_$][\w$]*/g

/** The identifier being typed immediately before `col` on `lineText`. */
export function prefixAt(lineText: string, col: number): string {
  return lineText.slice(0, col).match(/[A-Za-z_$][\w$]*$/)?.[0] ?? ''
}

/** Candidate completions for `prefix`, drawn from the buffer and language keywords. */
export function completionsFor(text: string, prefix: string, filetype?: string): string[] {
  if (prefix.length === 0) return []
  const seen = new Set([prefix])
  const results: string[] = []
  const add = (word: string) => {
    if (word.length <= prefix.length || !word.startsWith(prefix) || seen.has(word)) return
    seen.add(word)
    results.push(word)
  }

  for (const word of text.match(WORD) ?? []) add(word)
  for (const word of KEYWORDS[filetype ?? ''] ?? []) add(word)

  results.sort((a, b) => a.length - b.length || a.localeCompare(b))
  return results.slice(0, 8)
}

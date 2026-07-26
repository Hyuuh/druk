/**
 * Language registry — the single place to teach druk a new language.
 *
 * To add one:
 *   1. Make sure a tree-sitter wasm exists (most live in `tree-sitter-wasms`).
 *   2. Drop a highlight query in `./queries/<id>.scm` (skip if OpenTUI bundles
 *      the grammar already — see `bundled: true` below).
 *   3. Add an entry here. Nothing else in the codebase needs to change.
 *
 * `id` must match OpenTUI's filetype name (`pathToFiletype`), which is what
 * maps a file extension to a language.
 */
export interface Language {
  /** Filetype id, e.g. "typescript". Must match OpenTUI's `pathToFiletype`. */
  id: string
  /** Human-readable name, shown in the status bar. */
  name: string
  /**
   * Grammar shipped with OpenTUI — no wasm/query needed from us.
   * Bundled today: javascript, typescript, markdown, zig.
   */
  bundled?: boolean
  /** Import specifier of the grammar wasm, when we vendor it ourselves. */
  wasm?: string
  /** Highlight query file in ./queries, when we vendor it ourselves. */
  query?: string
  /**
   * Regex highlighting, for formats with no usable grammar. Patterns paint in
   * order, so later entries win the characters they overlap.
   */
  patterns?: { group: string; re: RegExp }[]
}

const WASM = (name: string) => `tree-sitter-wasms/out/tree-sitter-${name}.wasm`

export const LANGUAGES: Language[] = [
  { id: 'javascript', name: 'JavaScript', bundled: true },
  { id: 'typescript', name: 'TypeScript', bundled: true },
  { id: 'markdown', name: 'Markdown', bundled: true },
  { id: 'zig', name: 'Zig', bundled: true },
  { id: 'json', name: 'JSON', wasm: WASM('json'), query: 'json.scm' },
  { id: 'html', name: 'HTML', wasm: WASM('html'), query: 'html.scm' },
  { id: 'typescriptreact', name: 'TSX', wasm: WASM('tsx'), query: 'tsx.scm' },
  { id: 'javascriptreact', name: 'JSX', wasm: WASM('tsx'), query: 'tsx.scm' },
  { id: 'vue', name: 'Vue', wasm: WASM('vue'), query: 'vue.scm' },
  { id: 'css', name: 'CSS', wasm: WASM('css'), query: 'css.scm' },
  { id: 'scss', name: 'SCSS', wasm: WASM('css'), query: 'css.scm' },
  { id: 'less', name: 'Less', wasm: WASM('css'), query: 'css.scm' },
  { id: 'python', name: 'Python', wasm: WASM('python'), query: 'python.scm' },
  { id: 'rust', name: 'Rust', wasm: WASM('rust'), query: 'rust.scm' },
  { id: 'go', name: 'Go', wasm: WASM('go'), query: 'go.scm' },
  { id: 'java', name: 'Java', wasm: WASM('java'), query: 'java.scm' },
  { id: 'kotlin', name: 'Kotlin', wasm: WASM('kotlin'), query: 'kotlin.scm' },
  { id: 'scala', name: 'Scala', wasm: WASM('scala'), query: 'scala.scm' },
  { id: 'c', name: 'C', wasm: WASM('c'), query: 'c.scm' },
  { id: 'cpp', name: 'C++', wasm: WASM('cpp'), query: 'cpp.scm' },
  { id: 'csharp', name: 'C#', wasm: WASM('c_sharp'), query: 'c_sharp.scm' },
  { id: 'php', name: 'PHP', wasm: WASM('php'), query: 'php.scm' },
  { id: 'ruby', name: 'Ruby', wasm: WASM('ruby'), query: 'ruby.scm' },
  { id: 'elixir', name: 'Elixir', wasm: WASM('elixir'), query: 'elixir.scm' },
  { id: 'swift', name: 'Swift', wasm: WASM('swift'), query: 'swift.scm' },
  { id: 'dart', name: 'Dart', wasm: WASM('dart'), query: 'dart.scm' },
  { id: 'lua', name: 'Lua', wasm: WASM('lua'), query: 'lua.scm' },
  { id: 'bash', name: 'Shell', wasm: WASM('bash'), query: 'bash.scm' },
  { id: 'toml', name: 'TOML', wasm: WASM('toml'), query: 'toml.scm' },
  // No usable grammar: tree-sitter-yaml hangs the query engine, and svelte/sql/ini
  // ship no wasm at all. Patterns are plenty for these shapes.
  {
    id: 'yaml',
    name: 'YAML',
    patterns: [
      { group: 'punctuation', re: /^\s*-\s|[:[\]{},]/gm },
      { group: 'number', re: /\b\d+(?:\.\d+)?\b/g },
      { group: 'boolean', re: /\b(?:true|false|yes|no|on|off|null)\b/gi },
      { group: 'string', re: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g },
      { group: 'label', re: /[&*][\w-]+/g },
      { group: 'property', re: /^[ \t]*-?[ \t]*['"]?[\w.$/@-]+['"]?(?=[ \t]*:)/gm },
      { group: 'punctuation.special', re: /^---$|^\.\.\.$/gm },
      { group: 'comment', re: /(?:^|[ \t])#.*/gm },
    ],
  },
  {
    id: 'svelte',
    name: 'Svelte',
    patterns: [
      { group: 'punctuation.bracket', re: /<\/?|\/?>|[{}]/g },
      { group: 'number', re: /\b\d+(?:\.\d+)?\b/g },
      { group: 'string', re: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g },
      { group: 'attribute', re: /\b(?:bind|on|use|class|transition|in|out|animate):[\w|]+/g },
      { group: 'tag', re: /<\/?([A-Za-z][\w.-]*)/g },
      {
        group: 'keyword',
        re: /\{[#:/@]\s*\w+|\b(?:let|const|function|export|import|from|await|return|if|else)\b/g,
      },
      { group: 'comment', re: /<!--[\s\S]*?-->|\/\/.*$/gm },
    ],
  },
  {
    id: 'sql',
    name: 'SQL',
    patterns: [
      { group: 'punctuation', re: /[(),;.*]/g },
      { group: 'number', re: /\b\d+(?:\.\d+)?\b/g },
      { group: 'string', re: /'(?:[^']|'')*'/g },
      {
        group: 'keyword',
        re: /\b(?:select|from|where|insert|into|values|update|set|delete|create|table|drop|alter|add|primary|key|foreign|references|join|left|right|inner|outer|on|group|order|by|having|limit|offset|as|and|or|not|null|distinct|union|index|view|with|returning|default|constraint|unique|check|cascade)\b/gi,
      },
      {
        group: 'type',
        re: /\b(?:int|integer|bigint|smallint|serial|text|varchar|char|boolean|bool|date|timestamp|timestamptz|numeric|decimal|real|json|jsonb|uuid)\b/gi,
      },
      { group: 'comment', re: /--.*$|\/\*[\s\S]*?\*\//gm },
    ],
  },
  {
    id: 'ini',
    name: 'INI',
    patterns: [
      { group: 'string', re: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g },
      { group: 'number', re: /\b\d+(?:\.\d+)?\b/g },
      { group: 'boolean', re: /\b(?:true|false|yes|no|on|off)\b/gi },
      { group: 'property', re: /^[ \t]*[\w.$-]+(?=[ \t]*=)/gm },
      { group: 'type', re: /^\s*\[[^\]]+\]/gm },
      { group: 'comment', re: /^[ \t]*[#;].*/gm },
    ],
  },
]

const BY_ID = new Map(LANGUAGES.map(lang => [lang.id, lang]))

export function languageFor(filetype: string | undefined): Language | undefined {
  return filetype ? BY_ID.get(filetype) : undefined
}

/** Languages we ship a grammar for and must register with tree-sitter at runtime. */
export const VENDORED_LANGUAGES = LANGUAGES.filter(lang => lang.wasm && lang.query)

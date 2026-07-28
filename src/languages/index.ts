/**
 * Language registry — the single place to teach druk a new language.
 *
 * To add one:
 *   1. Make sure a tree-sitter wasm exists (most live in `tree-sitter-wasms`).
 *   2. Drop a highlight query in `./queries/<id>.scm` (skip if OpenTUI bundles
 *      the grammar already — see `bundled: true` below).
 *   3. Register both in `./grammars.ts`.
 *   4. Add an entry here. Nothing else in the codebase needs to change.
 *
 * `id` must match OpenTUI's filetype name (`pathToFiletype`), which is what
 * maps a file extension to a language.
 */
import { GRAMMARS } from './grammars'

export interface Language {
  /** Filetype id, e.g. "typescript". Must match OpenTUI's `pathToFiletype`. */
  id: string
  /**
   * What the status bar calls the file, when the id itself will not do. `id` has to
   * be OpenTUI's filetype name, and a couple of those are a mouthful — `.tsx` files
   * are `typescriptreact`. Left off, the id is shown as-is.
   */
  label?: string
  /**
   * Grammar shipped with OpenTUI — no wasm/query needed from us.
   * Bundled today: javascript, typescript, markdown, zig.
   */
  bundled?: boolean
  /** Path to the grammar wasm, when we vendor it ourselves — see ./grammars.ts. */
  wasm?: string
  /** Path to the highlight query, when we vendor the grammar ourselves. */
  query?: string
  /**
   * Regex highlighting, for formats with no usable grammar. Patterns paint in
   * order, so later entries win the characters they overlap.
   */
  patterns?: { group: string; re: RegExp }[]
}

export const LANGUAGES: Language[] = [
  { id: 'javascript', label: 'js', bundled: true },
  { id: 'typescript', label: 'ts', bundled: true },
  { id: 'markdown', label: 'md', bundled: true },
  { id: 'zig', bundled: true },
  { id: 'json', ...GRAMMARS.json },
  { id: 'html', ...GRAMMARS.html },
  { id: 'typescriptreact', label: 'tsx', ...GRAMMARS.tsx },
  { id: 'javascriptreact', label: 'jsx', ...GRAMMARS.tsx },
  { id: 'vue', ...GRAMMARS.vue },
  { id: 'css', ...GRAMMARS.css },
  { id: 'scss', ...GRAMMARS.css },
  { id: 'sass', ...GRAMMARS.css },
  { id: 'less', ...GRAMMARS.css },
  { id: 'python', ...GRAMMARS.python },
  { id: 'rust', ...GRAMMARS.rust },
  { id: 'go', ...GRAMMARS.go },
  { id: 'java', ...GRAMMARS.java },
  { id: 'kotlin', ...GRAMMARS.kotlin },
  { id: 'scala', ...GRAMMARS.scala },
  { id: 'c', ...GRAMMARS.c },
  { id: 'cpp', ...GRAMMARS.cpp },
  { id: 'csharp', ...GRAMMARS.csharp },
  { id: 'php', ...GRAMMARS.php },
  { id: 'ruby', ...GRAMMARS.ruby },
  { id: 'elixir', ...GRAMMARS.elixir },
  { id: 'swift', ...GRAMMARS.swift },
  { id: 'dart', ...GRAMMARS.dart },
  { id: 'lua', ...GRAMMARS.lua },
  { id: 'bash', ...GRAMMARS.bash },
  { id: 'toml', ...GRAMMARS.toml },
  // No usable grammar: tree-sitter-yaml hangs the query engine, and svelte/sql/ini
  // ship no wasm at all. Patterns are plenty for these shapes.
  {
    id: 'yaml',
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
    id: 'dotenv',
    label: 'env',
    patterns: [
      { group: 'punctuation', re: /=/g },
      { group: 'number', re: /\b\d+(?:\.\d+)?\b/g },
      { group: 'boolean', re: /\b(?:true|false|null)\b/gi },
      { group: 'string', re: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g },
      // Interpolation, which is the one place a value refers to another key.
      { group: 'variable', re: /\$\{[\w.]+\}|\$[A-Za-z_]\w*/g },
      { group: 'property', re: /^[ \t]*(?:export[ \t]+)?[\w.]+(?=[ \t]*=)/gm },
      // After the key rule, which spans `export NAME` and would otherwise win it.
      { group: 'keyword', re: /^[ \t]*export\b/gm },
      // Last, so a `#` inside a value does not turn the rest of the line grey —
      // and a commented-out KEY=value keeps the comment colour.
      { group: 'comment', re: /^[ \t]*#.*/gm },
    ],
  },
  {
    id: 'svelte',
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

/** What to call `filetype` on screen. */
export function languageLabel(filetype: string): string {
  return languageFor(filetype)?.label ?? filetype
}

/** Languages we ship a grammar for and must register with tree-sitter at runtime. */
export const VENDORED_LANGUAGES = LANGUAGES.filter(lang => lang.wasm && lang.query)

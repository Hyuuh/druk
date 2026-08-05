import { describe, expect, test } from 'bun:test'

import { commentPrefix } from '../src/languages'
import { filetypeForPath, getSyntaxStyle } from '../src/languages/highlight'
import { resolveServer } from '../src/lsp/servers'
import { allSegments } from './syntax'

describe('recognising jsonc files', () => {
  test('by extension, and without stealing plain json', () => {
    expect(filetypeForPath('wrangler.jsonc')).toBe('jsonc')
    expect(filetypeForPath('app/tsconfig.jsonc')).toBe('jsonc')
    // bun.lock carries trailing commas, and the languageId is what stops the
    // json server flagging every one of them.
    expect(filetypeForPath('bun.lock')).toBe('jsonc')
    expect(filetypeForPath('package.json')).toBe('json')
  })

  test('with a comment prefix json itself has no business having', () => {
    expect(commentPrefix('jsonc')).toBe('//')
    expect(commentPrefix('json')).toBeUndefined()
  })
})

describe('painting jsonc', () => {
  const SAMPLE = `{
  // a line comment
  /* and a block one */
  "port": 8080
}
`

  test('comments are comments, not errors', async () => {
    const style = getSyntaxStyle()
    const segments = await allSegments(SAMPLE, 'jsonc')
    const commented = (line: number) =>
      segments
        .filter(segment => segment.line === line && segment.styleId === style.getStyleId('comment'))
        .map(segment => SAMPLE.split('\n')[line]?.slice(segment.start, segment.end))
    expect(commented(1)).toEqual(['// a line comment'])
    expect(commented(2)).toEqual(['/* and a block one */'])
    // The whole point: a comment must not be parsed as a broken value.
    expect(segments.some(segment => segment.styleId === style.getStyleId('error'))).toBe(false)
  })
})

test('the json server serves jsonc too', () => {
  // Same process, but the languageId druk sends is the filetype — which is what
  // tells vscode-json-language-server to allow the comments rather than flag them.
  expect(resolveServer('jsonc', {})?.command).toEqual(resolveServer('json', {})!.command)
})

test('bun.lock is excused its trailing commas by schema, not languageId', () => {
  // The jsonc languageId only *downgrades* trailing commas to warnings — the
  // server hardcodes `trailingCommas: 'warning'` for jsonc documents, and druk
  // draws warnings too. Silence comes from a schema association: the language
  // service skips both checks entirely for a file whose schema says
  // `allowTrailingCommas` / `allowComments`. And once any settings are pushed,
  // `validate.enable` must ride along — the server resets it to false on every
  // `didChangeConfiguration` that omits it, killing syntax errors everywhere.
  const settings = resolveServer('json', {})?.settings as {
    json: {
      validate: { enable: boolean }
      schemas: { fileMatch: string[]; schema: Record<string, boolean> }[]
    }
  }
  expect(settings.json.validate.enable).toBe(true)
  const lockfile = settings.json.schemas.find(entry => entry.fileMatch.includes('bun.lock'))
  expect(lockfile?.schema).toEqual({ allowTrailingCommas: true, allowComments: true })
})

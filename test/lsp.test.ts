import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MARKET_DIR } from '../scripts/plugins'
import { problemFrom } from '../src/app/lsp'
import type { Problem } from '../src/app/lsp'
import { styleIdForGroup } from '../src/languages/highlight'
import { spawnLspClient } from '../src/lsp/client'
import { installServer, installedCommand } from '../src/lsp/install'
import { projectCommand, typescriptMajor } from '../src/lsp/project'
import type { Diagnostic, RpcMessage } from '../src/lsp/protocol'
import { isUnnecessary, severityOf } from '../src/lsp/protocol'
import { installHint, resolveServer } from '../src/lsp/servers'
import { createDecoder, encodeMessage } from '../src/lsp/transport'
import { loadPlugins } from '../src/plugins'

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')

/** Deliveries arrive when the server feels like it; `atLeast` awaits the event itself. */
function collector<T>() {
  const items: T[] = []
  const waiters: { count: number; resolve: () => void }[] = []
  return {
    items,
    push(item: T) {
      items.push(item)
      for (let at = waiters.length - 1; at >= 0; at--) {
        if (items.length >= waiters[at]!.count) {
          waiters[at]!.resolve()
          waiters.splice(at, 1)
        }
      }
    },
    atLeast(count: number): Promise<void> {
      if (items.length >= count) return Promise.resolve()
      const { promise, resolve } = Promise.withResolvers<void>()
      waiters.push({ count, resolve })
      return promise
    },
  }
}

describe('framing', () => {
  const collect = () => {
    const messages: RpcMessage[] = []
    return { messages, sink: createDecoder(message => void messages.push(message)) }
  }

  test('a message split anywhere still decodes', () => {
    const { messages, sink } = collect()
    const frame = encodeMessage({ jsonrpc: '2.0', method: 'x', params: { a: 1 } })
    for (const byte of frame) sink(Buffer.from([byte]))
    expect(messages).toEqual([{ jsonrpc: '2.0', method: 'x', params: { a: 1 } }])
  })

  test('several messages in one chunk all decode', () => {
    const { messages, sink } = collect()
    sink(Buffer.concat([encodeMessage({ id: 1 }), encodeMessage({ id: 2 })]))
    expect(messages.map(m => m.id)).toEqual([1, 2])
  })

  test('Content-Length counts bytes, not characters', () => {
    const { messages, sink } = collect()
    sink(encodeMessage({ method: 'x', params: { text: 'héllo — ★' } }))
    expect((messages[0]!.params as { text: string }).text).toBe('héllo — ★')
  })

  test('header name is case-insensitive', () => {
    const { messages, sink } = collect()
    const body = Buffer.from('{"id":7}', 'utf8')
    sink(Buffer.concat([Buffer.from(`content-length: ${body.length}\r\n\r\n`), body]))
    expect(messages[0]!.id).toBe(7)
  })
})

describe('protocol mapping', () => {
  const at = (line: number, col: number): Diagnostic => ({
    range: { start: { line, character: col }, end: { line, character: col } },
    message: 'm',
  })

  test('severity defaults to error and maps the four levels', () => {
    expect(severityOf(at(0, 0))).toBe('error')
    expect(severityOf({ ...at(0, 0), severity: 2 })).toBe('warning')
    expect(severityOf({ ...at(0, 0), severity: 3 })).toBe('info')
    expect(severityOf({ ...at(0, 0), severity: 4 })).toBe('hint')
  })

  test('the span styles are registered for every severity', () => {
    for (const severity of ['error', 'warning', 'info', 'hint']) {
      expect(styleIdForGroup(`druk.problem.${severity}`)).not.toBeNull()
    }
    expect(styleIdForGroup('druk.problem.unnecessary')).not.toBeNull()
  })

  test('the Unnecessary tag is recognised, and other tags are not', () => {
    expect(isUnnecessary(at(0, 0))).toBe(false)
    expect(isUnnecessary({ ...at(0, 0), tags: [] })).toBe(false)
    expect(isUnnecessary({ ...at(0, 0), tags: [2] })).toBe(false)
    expect(isUnnecessary({ ...at(0, 0), tags: [1] })).toBe(true)
    expect(isUnnecessary({ ...at(0, 0), tags: [2, 1] })).toBe(true)
  })

  // The market plugins are what carry the server specs now — the typescript one
  // is this repository's own `plugins/typescript/plugin.json`.
  loadPlugins(process.env.XDG_CONFIG_HOME!, [], MARKET_DIR)

  test('overrides replace a server command, and an empty one disables it', () => {
    expect(resolveServer('typescript', {})?.command[0]).toBe('typescript-language-server')
    expect(resolveServer('typescript', { typescript: ['deno', 'lsp'] })?.command).toEqual([
      'deno',
      'lsp',
    ])
    // The hint names the default's package; an override would send them elsewhere.
    expect(resolveServer('typescript', { typescript: ['deno', 'lsp'] })?.install).toBeUndefined()
    expect(resolveServer('typescript', { typescript: [] })).toBeNull()
    expect(resolveServer('brainfuck', {})).toBeNull()
    expect(resolveServer(undefined, {})).toBeNull()
  })

  test('typescript is pinned to 5, the last line that ships a tsserver.js', () => {
    // 7.x is the native port: a platform binary and no tsserver.js, so
    // typescript-language-server installs fine and then fails its handshake.
    const install = resolveServer('typescript', {})?.install
    expect(install).toEqual({
      kind: 'npm',
      packages: ['typescript-language-server', 'typescript@5'],
    })
  })

  test('install hints read as the command that installs the server', () => {
    expect(installHint({ kind: 'npm', packages: ['pyright'] })).toBe('npm i -g pyright')
    expect(installHint({ kind: 'manual', command: 'gem install solargraph' })).toBe(
      'gem install solargraph',
    )
  })
})

describe('installed servers', () => {
  test('a command is rewritten only when druk installed that binary', () => {
    const root = mkdtempSync(join(tmpdir(), 'druk-lsp-root-'))
    const command = ['pyright-langserver', '--stdio']
    expect(installedCommand(command, root)).toBeNull()

    const bin = join(root, 'node_modules', '.bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'pyright-langserver'), '')
    // The arguments ride along; only the executable becomes a path.
    expect(installedCommand(command, root)).toEqual([join(bin, 'pyright-langserver'), '--stdio'])
  })

  test('an install with no npm to run it fails instead of hanging', async () => {
    const root = mkdtempSync(join(tmpdir(), 'druk-lsp-root-'))
    // PATH is what `spawn` searches, so emptying it is how npm goes missing.
    const path = process.env.PATH
    process.env.PATH = ''
    try {
      expect(await installServer(['druk-no-such-package'], root)).toBe(
        'npm is not installed, or not on PATH',
      )
    } finally {
      process.env.PATH = path
    }
  }, 20_000)
})

describe('the project’s own server', () => {
  const project = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'druk-project-'))
    for (const [name, content] of Object.entries(files)) {
      const path = join(dir, name)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, content)
    }
    return dir
  }
  const TLS = ['typescript-language-server', '--stdio']

  test('a project with nothing installed leaves the choice to the caller', () => {
    expect(projectCommand('typescript', TLS, project({}))).toBeNull()
    expect(typescriptMajor(project({}))).toBeNull()
  })

  test('a server in the project’s node_modules wins over anything global', () => {
    const dir = project({
      'node_modules/.bin/typescript-language-server': '',
      'node_modules/typescript/package.json': '{"version":"5.9.2"}',
    })
    expect(typescriptMajor(dir)).toBe(5)
    expect(projectCommand('typescript', TLS, dir)).toEqual([
      join(dir, 'node_modules', '.bin', 'typescript-language-server'),
      '--stdio',
    ])
  })

  test('TypeScript 7 is served by the compiler itself, not by tsserver', () => {
    // 7.x is the Go port: a platform binary and no tsserver.js, so
    // typescript-language-server cannot serve the project at all — and `tsc`
    // speaks LSP. Preferred even where the older server is also installed.
    const dir = project({
      'node_modules/.bin/tsc': '',
      'node_modules/.bin/typescript-language-server': '',
      'node_modules/typescript/package.json': '{"version":"7.0.2"}',
    })
    expect(typescriptMajor(dir)).toBe(7)
    expect(projectCommand('typescript', TLS, dir)).toEqual([
      join(dir, 'node_modules', '.bin', 'tsc'),
      '--lsp',
      '--stdio',
    ])
  })

  test('TypeScript 5’s tsc is never used as a server: it has no --lsp', () => {
    const dir = project({
      'node_modules/.bin/tsc': '',
      'node_modules/typescript/package.json': '{"version":"5.9.2"}',
    })
    expect(projectCommand('typescript', TLS, dir)).toBeNull()
  })
})

describe('problemFrom', () => {
  const problem = (line: number, col: number): Problem => ({
    path: '/p',
    line,
    col,
    endLine: line,
    endCol: col,
    severity: 'error',
    unnecessary: false,
    message: 'm',
  })
  const list = [problem(1, 4), problem(5, 0), problem(5, 9)]

  test('finds the next problem after the cursor, wrapping at the end', () => {
    expect(problemFrom(list, 0, 0, 1)).toEqual(problem(1, 4))
    expect(problemFrom(list, 1, 4, 1)).toEqual(problem(5, 0))
    expect(problemFrom(list, 5, 9, 1)).toEqual(problem(1, 4))
  })

  test('finds the previous problem, wrapping at the start', () => {
    expect(problemFrom(list, 5, 9, -1)).toEqual(problem(5, 0))
    expect(problemFrom(list, 1, 4, -1)).toEqual(problem(5, 9))
    expect(problemFrom([], 0, 0, -1)).toBeNull()
  })
})

describe('client against a live server', () => {
  test('handshake, didOpen diagnostics, didChange clearing them, dispose', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'druk-lsp-'))
    const path = join(dir, 'a.ts')
    const deliveries = collector<Diagnostic[]>()
    const client = spawnLspClient({
      command: [process.execPath, FAKE],
      rootDir: dir,
      onDiagnostics: (_uri, diagnostics) => deliveries.push(diagnostics),
      onFail: reason => {
        throw new Error(`fake server failed: ${reason}`)
      },
    })

    // Sent while the server is still initializing, so this also proves queueing.
    client.openDocument(path, 'typescript', 'const oops = 1\n')
    await deliveries.atLeast(1)
    expect(deliveries.items[0]).toHaveLength(1)
    expect(deliveries.items[0]![0]!.range.start).toEqual({ line: 0, character: 6 })
    expect(client.ready()).toBe(true)

    client.changeDocument(path, 'const fine = 1\n')
    await deliveries.atLeast(2)
    expect(deliveries.items[1]).toHaveLength(0)

    client.dispose()
  }, 20_000)

  test('a command that is not on PATH reports failure instead of wedging', async () => {
    const { promise: failed, resolve: onFail } = Promise.withResolvers<{
      reason: string
      missing: boolean
    }>()
    const client = spawnLspClient({
      command: ['druk-no-such-language-server'],
      rootDir: tmpdir(),
      onDiagnostics: () => {},
      onFail: (reason, missing) => onFail({ reason, missing }),
    })
    // Neither runtime's raw ENOENT wording reaches the user: the status bar names
    // the command itself and adds the server's install line.
    expect(await failed).toEqual({ reason: 'is not installed, or not on PATH', missing: true })
    expect(client.ready()).toBe(false)
    // Dead, not merely un-ready: the document sync uses this to forget the entry,
    // so a server installed later receives the file that first asked for it.
    expect(client.dead()).toBe(true)
    client.dispose()
  }, 10_000)

  test('a starting client is not dead — its documents must not be forgotten', () => {
    const client = spawnLspClient({
      command: [process.execPath, FAKE],
      rootDir: tmpdir(),
      onDiagnostics: () => {},
      onFail: () => {},
    })
    expect(client.ready()).toBe(false)
    expect(client.dead()).toBe(false)
    client.dispose()
  })
})

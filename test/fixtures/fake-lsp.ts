/**
 * A minimal language server for tests: speaks the stdio protocol, answers the
 * handshake, publishes one error diagnostic wherever a document says "oops",
 * answers completion with a fixed list (one item carrying an auto-import
 * style additionalTextEdit, so the whole insertion path is exercised), and
 * sends every definition query to `def.ts` in the project root.
 * Run with `bun test/fixtures/fake-lsp.ts` — the tests point `lspServers` at it.
 */
import type { CompletionItem, Diagnostic } from '../../src/lsp/protocol'
import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

const publish = (uri: string, text: string) => {
  const diagnostics: Diagnostic[] = []
  const lines = text.split('\n')
  for (let line = 0; line < lines.length; line++) {
    const col = lines[line]!.indexOf('oops')
    if (col < 0) continue
    diagnostics.push({
      range: { start: { line, character: col }, end: { line, character: col + 4 } },
      severity: 1,
      message: 'found oops',
      source: 'fake',
    })
  }
  send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } })
}

const COMPLETIONS: CompletionItem[] = [
  { label: 'drukAlpha', kind: 3, detail: '() => void', insertText: 'drukAlpha()' },
  { label: 'drukBeta', kind: 6, detail: 'number' },
  {
    label: 'drukImported',
    kind: 7,
    detail: 'auto-import',
    additionalTextEdits: [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        newText: 'import { drukImported } from "druk"\n',
      },
    ],
  },
  // No additionalTextEdits here: they arrive only via completionItem/resolve,
  // the way typescript-language-server serves auto-imports.
  { label: 'drukLazy', kind: 7, detail: 'resolve-import' },
]

/** Where the definition answers point — the project root, from the handshake. */
let rootUri = ''

process.stdin.on(
  'data',
  createDecoder(message => {
    if (message.method === 'initialize') {
      rootUri = (message.params as { rootUri?: string }).rootUri ?? ''
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          capabilities: {
            textDocumentSync: 1,
            completionProvider: { triggerCharacters: ['.'], resolveProvider: true },
            definitionProvider: true,
          },
        },
      })
    } else if (message.method === 'textDocument/definition') {
      // A LocationLink rather than a Location: it is the shape linkSupport asks
      // for, and the one whose selection range the client has to prefer.
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: [
          {
            targetUri: `${rootUri}/def.ts`,
            targetRange: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
            targetSelectionRange: {
              start: { line: 1, character: 6 },
              end: { line: 1, character: 12 },
            },
          },
        ],
      })
    } else if (message.method === 'textDocument/completion') {
      send({ jsonrpc: '2.0', id: message.id, result: { isIncomplete: false, items: COMPLETIONS } })
    } else if (message.method === 'completionItem/resolve') {
      const item = message.params as CompletionItem
      const result =
        item.label === 'drukLazy'
          ? {
              ...item,
              additionalTextEdits: [
                {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: 'import { drukLazy } from "druk"\n',
                },
              ],
            }
          : item
      send({ jsonrpc: '2.0', id: message.id, result })
    } else if (message.method === 'shutdown') {
      send({ jsonrpc: '2.0', id: message.id, result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    } else if (message.method === 'textDocument/didOpen') {
      const params = message.params as { textDocument: { uri: string; text: string } }
      publish(params.textDocument.uri, params.textDocument.text)
    } else if (message.method === 'textDocument/didChange') {
      const params = message.params as {
        textDocument: { uri: string }
        contentChanges: { text: string }[]
      }
      publish(params.textDocument.uri, params.contentChanges[0]!.text)
    }
  }),
)
process.stdin.on('end', () => process.exit(0))

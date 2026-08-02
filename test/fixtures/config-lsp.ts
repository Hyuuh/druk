/**
 * A server that reports nothing until it has been configured — eslint's shape,
 * reduced to what can be asserted on.
 *
 * It gets its settings the two ways the protocol offers, and says which of them
 * arrived: `workspace/configuration`, which it asks for once the handshake is
 * done, and the `didChangeConfiguration` push. Answering the request is not
 * enough on its own — the answer lands after the first pull — so it also sends
 * `workspace/diagnostic/refresh`, which is the only way a pull server has of
 * saying its last answers went stale.
 */
import { createDecoder, encodeMessage } from '../../src/lsp/transport'

const send = (message: object) => process.stdout.write(encodeMessage(message))

const CONFIG_REQUEST_ID = 9001

let viaRequest = false
let viaPush = false

const validated = (settings: unknown): boolean =>
  typeof settings === 'object' &&
  settings !== null &&
  (settings as { validate?: unknown }).validate === 'on'

process.stdin.on(
  'data',
  createDecoder(message => {
    if (message.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          capabilities: {
            textDocumentSync: 1,
            diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false },
          },
        },
      })
    } else if (message.method === 'initialized') {
      send({
        jsonrpc: '2.0',
        id: CONFIG_REQUEST_ID,
        method: 'workspace/configuration',
        params: { items: [{ section: 'config-lsp' }] },
      })
    } else if (message.method === 'workspace/didChangeConfiguration') {
      viaPush = validated((message.params as { settings?: unknown } | undefined)?.settings)
    } else if (message.method === 'textDocument/diagnostic') {
      const items = [
        ...(viaRequest ? ['configured by request'] : []),
        ...(viaPush ? ['configured by push'] : []),
      ].map((text, at) => ({
        range: { start: { line: at, character: 0 }, end: { line: at, character: 1 } },
        severity: 2,
        message: text,
        source: 'config-lsp',
      }))
      send({ jsonrpc: '2.0', id: message.id, result: { kind: 'full', items } })
    } else if (message.id === CONFIG_REQUEST_ID) {
      const result = message.result as unknown[] | undefined
      viaRequest = validated(result?.[0])
      // The pull that followed didOpen was answered before this arrived, so the
      // marks on screen are the unconfigured ones until they are asked for again.
      send({ jsonrpc: '2.0', id: CONFIG_REQUEST_ID + 1, method: 'workspace/diagnostic/refresh' })
    } else if (message.method === 'shutdown') {
      send({ jsonrpc: '2.0', id: message.id, result: null })
    } else if (message.method === 'exit') {
      process.exit(0)
    }
  }),
)

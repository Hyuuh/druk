/**
 * One language server: the process, the handshake, and document sync.
 *
 * Lifecycle is `starting → ready → dead`. Notifications sent while the server is
 * still initializing are queued — the protocol forbids anything before the
 * `initialized` notification, and rust-analyzer takes seconds to answer
 * `initialize` — and flushed in order once the handshake lands.
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import type { Diagnostic, PublishDiagnosticsParams, RpcMessage } from './protocol'
import { createDecoder, encodeMessage } from './transport'

/**
 * A server that spawns but never answers `initialize` would otherwise sit in
 * `starting` forever, silently queueing every notification. Generous: on a cold
 * cache rust-analyzer legitimately takes a while.
 */
const INITIALIZE_TIMEOUT_MS = 30_000

/**
 * Every live server process, killed from one shared `process.on('exit')` hook.
 * One listener however many servers run — a hook per client would trip Node's
 * ten-listener warning on `process`, printed to stderr over the TUI's frame.
 * `exit` handlers are the one thing that still runs on `process.exit()`, and
 * kill() is signal-only, so it is safe there.
 */
const liveChildren = new Set<ChildProcess>()
let exitHookInstalled = false

function trackChild(child: ChildProcess) {
  liveChildren.add(child)
  child.once('exit', () => liveChildren.delete(child))
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.on('exit', () => {
    for (const live of liveChildren) {
      try {
        live.kill('SIGKILL')
      } catch {
        // already gone
      }
    }
  })
}

export interface LspClientOptions {
  command: string[]
  rootDir: string
  onDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void
  /**
   * The server is gone and will not be respawned: the command was not on PATH,
   * the handshake failed or timed out, or the process died. Called at most once,
   * and never for a `dispose()` the editor asked for.
   */
  onFail: (reason: string) => void
}

export function spawnLspClient(options: LspClientOptions) {
  const [executable, ...args] = options.command
  const child = spawn(executable!, args, {
    cwd: options.rootDir,
    // stderr is ignored: servers chat on it freely, and anything written to an
    // unread pipe would eventually block them mid-request.
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  trackChild(child)

  let state: 'starting' | 'ready' | 'dead' = 'starting'
  let disposed = false
  let nextId = 1
  const pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >()
  /** Notifications owed to the server once `initialized` has been sent. */
  const queued: RpcMessage[] = []
  const versions = new Map<string, number>()

  const send = (message: RpcMessage) => {
    if (child.stdin?.writable) child.stdin.write(encodeMessage(message))
  }

  const request = (method: string, params?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      send({ jsonrpc: '2.0', id, method, params })
    })

  const notify = (method: string, params: unknown) => {
    const message: RpcMessage = { jsonrpc: '2.0', method, params }
    if (state === 'starting') queued.push(message)
    else if (state === 'ready') send(message)
  }

  const die = (reason: string | null) => {
    if (state === 'dead') return
    state = 'dead'
    for (const waiter of pending.values()) waiter.reject(new Error(reason ?? 'disposed'))
    pending.clear()
    queued.length = 0
    if (reason !== null && !disposed) options.onFail(reason)
  }

  const onMessage = (message: RpcMessage) => {
    if (message.method !== undefined && message.id != null) {
      // Server → client requests. druk implements none, but a request left
      // unanswered stalls some servers — so each gets the emptiest legal reply.
      if (message.method === 'workspace/configuration') {
        const items = (message.params as { items?: unknown[] } | undefined)?.items ?? []
        send({ jsonrpc: '2.0', id: message.id, result: items.map(() => null) })
      } else if (
        message.method === 'client/registerCapability' ||
        message.method === 'client/unregisterCapability' ||
        message.method === 'window/workDoneProgress/create'
      ) {
        send({ jsonrpc: '2.0', id: message.id, result: null })
      } else {
        send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `method not found: ${message.method}` },
        })
      }
    } else if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params as PublishDiagnosticsParams
      options.onDiagnostics(params.uri, params.diagnostics ?? [])
    } else if (message.id != null) {
      const waiter = pending.get(message.id as number)
      if (!waiter) return
      pending.delete(message.id as number)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    }
    // Everything else (logMessage, showMessage, $/progress) is server chatter.
  }

  child.stdout?.on('data', createDecoder(onMessage))
  child.on('error', error => die(error.message))
  child.on('exit', () => die('exited'))

  const killNow = () => {
    try {
      child.kill('SIGKILL')
    } catch {
      // already gone
    }
  }

  const initTimeout = setTimeout(() => {
    if (state !== 'starting') return
    die('did not answer initialize')
    killNow()
  }, INITIALIZE_TIMEOUT_MS)
  initTimeout.unref?.()

  const rootUri = pathToFileURL(options.rootDir).href
  void request('initialize', {
    processId: process.pid,
    rootUri,
    capabilities: {
      textDocument: {
        synchronization: { didSave: true },
        publishDiagnostics: {},
      },
    },
    workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
  })
    .then(() => {
      if (state !== 'starting') return
      send({ jsonrpc: '2.0', method: 'initialized', params: {} })
      state = 'ready'
      for (const message of queued) send(message)
      queued.length = 0
    })
    .catch((error: unknown) => {
      // A rejection from `die` (process error/exit, dispose) is already handled —
      // `die` no-ops when dead. An *error response* to initialize is not: without
      // this the client would sit in `starting` queueing notifications forever.
      die(error instanceof Error ? error.message : 'initialize failed')
    })
    .finally(() => clearTimeout(initTimeout))

  return {
    /** True once the handshake finished and false again when the server dies. */
    ready: () => state === 'ready',

    openDocument(path: string, languageId: string, text: string) {
      const uri = pathToFileURL(path).href
      versions.set(uri, 1)
      notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } })
    },

    /** Full-document sync: simple and impossible to desynchronize. */
    changeDocument(path: string, text: string) {
      const uri = pathToFileURL(path).href
      const version = (versions.get(uri) ?? 1) + 1
      versions.set(uri, version)
      notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      })
    },

    saveDocument(path: string) {
      notify('textDocument/didSave', { textDocument: { uri: pathToFileURL(path).href } })
    },

    closeDocument(path: string) {
      const uri = pathToFileURL(path).href
      versions.delete(uri)
      notify('textDocument/didClose', { textDocument: { uri } })
    },

    /**
     * Polite but bounded: ask for shutdown, then make sure. Never blocks — the
     * caller is App teardown, and a test run must not wait on a server's mood.
     */
    dispose() {
      if (disposed) return
      disposed = true
      if (state === 'ready') {
        void request('shutdown').catch(() => {})
        send({ jsonrpc: '2.0', method: 'exit' })
      }
      die(null)
      if (child.exitCode === null) {
        const backstop = setTimeout(killNow, 500)
        backstop.unref?.()
        child.once('exit', () => clearTimeout(backstop))
      }
    },
  }
}

export type LspClient = ReturnType<typeof spawnLspClient>

/**
 * The shapes the LSP status page renders. In `lsp/` rather than `app/` because
 * `ui/LspStatusView` needs them and nothing in `ui/` may import from `app/` —
 * the store that fills them still lives in `app/lsp.ts`.
 */

export type ServerState = 'starting' | 'ready' | 'stopped' | 'failed'

/** One line of a server's log — stderr, a window/logMessage, or a lifecycle event. */
export interface ServerLogLine {
  /** HH:MM:SS, stamped when the line arrived. */
  time: string
  kind: 'stderr' | 'server' | 'event'
  text: string
}

/** Everything the status page shows about one server. */
export interface ServerView {
  id: string
  /** The command actually spawned — project copy, druk's install, or PATH. */
  command: string[]
  state: ServerState
  /** Why it failed, when it did. */
  error: string | null
  logs: ServerLogLine[]
  /** Documents open in the server right now, as project-relative paths. */
  docs: string[]
}

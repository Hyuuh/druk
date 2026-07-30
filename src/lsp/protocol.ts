/**
 * The slice of the Language Server Protocol druk speaks, hand-written rather than
 * imported: the `vscode-languageserver-*` packages carry the whole protocol, and
 * druk uses a dozen shapes of it. Field names and numeric codes follow the spec —
 * https://microsoft.github.io/language-server-protocol/ — do not "fix" them.
 */

export interface RpcMessage {
  jsonrpc?: '2.0'
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

/**
 * Both fields 0-based. `character` counts UTF-16 code units — the same thing a JS
 * string index counts, which is why these convert 1:1 to buffer columns. A future
 * `positionEncoding` negotiation could change that; nothing here negotiates one.
 */
export interface Position {
  line: number
  character: number
}

export interface Range {
  start: Position
  end: Position
}

export interface Diagnostic {
  range: Range
  /** 1 error, 2 warning, 3 info, 4 hint. Absent means error, as VS Code reads it. */
  severity?: number
  message: string
  source?: string
}

export interface PublishDiagnosticsParams {
  uri: string
  diagnostics: Diagnostic[]
}

export type ProblemSeverity = 'error' | 'warning' | 'info' | 'hint'

const SEVERITIES: ProblemSeverity[] = ['error', 'warning', 'info', 'hint']

export function severityOf(diagnostic: Diagnostic): ProblemSeverity {
  return SEVERITIES[(diagnostic.severity ?? 1) - 1] ?? 'error'
}

/** Lower ranks matter more; used when one line holds several problems. */
export const SEVERITY_RANK: Record<ProblemSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
}

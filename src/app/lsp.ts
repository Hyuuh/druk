import { fileURLToPath } from 'node:url'

import { createEffect, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'

import { filetypeForPath } from '../languages/highlight'
import { spawnLspClient } from '../lsp/client'
import type { LspClient } from '../lsp/client'
import { normalizeCompletion } from '../lsp/completion'
import type { CompletionReply } from '../lsp/completion'
import { isUnnecessary, severityOf } from '../lsp/protocol'
import type { CompletionItem, Diagnostic, ProblemSeverity } from '../lsp/protocol'
import { resolveServer } from '../lsp/servers'
import type { Settings } from './settings'
import type { Status } from './status'
import type { Workspace } from './workspace'

export interface Problem {
  path: string
  /** 0-based, like every position the editor bridge speaks. */
  line: number
  col: number
  /** Range end, for the underline; equal to the start when the server sent none. */
  endLine: number
  endCol: number
  severity: ProblemSeverity
  /** LSP's Unnecessary tag: unused code, dimmed instead of underlined. */
  unnecessary: boolean
  message: string
  source?: string
}

/**
 * Keystrokes a didChange waits for more of. Higher than the highlighter's 16ms:
 * a server re-checks the project on every sync, which is milliseconds of CPU
 * where the highlighter's is microseconds.
 */
const CHANGE_DEBOUNCE_MS = 150

/** Language servers: one per language, diagnostics per open file. */
export function createLsp(deps: { rootDir: string; settings: Settings; status: Status }) {
  const { rootDir, settings, status } = deps

  const [problems, setProblems] = createStore<Record<string, Problem[]>>({})
  /** By server id. `null` marks one that failed, so nothing respawns it. */
  const clients = new Map<string, LspClient | null>()

  const onDiagnostics = (uri: string, diagnostics: Diagnostic[]) => {
    let path: string
    try {
      path = fileURLToPath(uri)
    } catch {
      return // a scheme druk never opened; nothing to attach it to
    }
    setProblems(
      path,
      diagnostics
        .map(diagnostic => ({
          path,
          line: diagnostic.range.start.line,
          col: diagnostic.range.start.character,
          endLine: diagnostic.range.end.line,
          endCol: diagnostic.range.end.character,
          severity: severityOf(diagnostic),
          unnecessary: isUnnecessary(diagnostic),
          message: diagnostic.message,
          source: diagnostic.source,
        }))
        .toSorted((a, b) => a.line - b.line || a.col - b.col),
    )
  }

  const clearProblems = (path: string) => {
    if (problems[path]?.length) setProblems(path, [])
  }

  /** The running client for `path`'s language — spawned on first use. */
  const clientFor = (path: string): LspClient | null => {
    if (!settings.config.lsp) return null
    const resolved = resolveServer(filetypeForPath(path), settings.config.lspServers)
    if (!resolved) return null
    const known = clients.get(resolved.id)
    if (known !== undefined) return known
    const client = spawnLspClient({
      command: resolved.command,
      rootDir,
      onDiagnostics,
      onFail: reason => {
        clients.set(resolved.id, null)
        status.say(`LSP: ${resolved.command[0]} ${reason}`, 'warn')
      },
    })
    clients.set(resolved.id, client)
    return client
  }

  /**
   * Kill every server and forget the failure marks, so the next `clientFor`
   * starts fresh. Serves both App teardown and the settings toggle: turning LSP
   * back on respawns servers as files re-sync.
   */
  const dispose = () => {
    for (const client of clients.values()) client?.dispose()
    clients.clear()
    for (const path of Object.keys(problems)) clearProblems(path)
  }

  /** Set by `wireLspEffects`: push the debounced didChange for `path` out now. */
  let flushEdits: ((path: string) => void) | null = null
  const onFlushNeeded = (flush: (path: string) => void) => {
    flushEdits = flush
  }

  /**
   * Completion at a buffer position. The pending didChange goes first — the
   * request is aimed at what is on screen, and a server answering against text
   * 150ms stale would misplace every edit it returns.
   */
  const complete = async (
    path: string,
    line: number,
    col: number,
  ): Promise<CompletionReply | null> => {
    if (!settings.config.lsp || !settings.config.lspCompletion) return null
    const client = clientFor(path)
    if (!client?.ready()) return null
    flushEdits?.(path)
    return normalizeCompletion(await client.complete(path, { line, character: col }))
  }

  /**
   * Ask `path`'s server to fill in a chosen item's withheld fields — the
   * auto-import edits most servers leave off the list. Null means "insert the
   * item as it came".
   */
  const resolveCompletion = (
    path: string,
    item: CompletionItem,
  ): Promise<CompletionItem | null> => {
    if (!settings.config.lsp || !settings.config.lspCompletion) return Promise.resolve(null)
    const client = clientFor(path)
    if (!client?.ready()) return Promise.resolve(null)
    return client.resolveCompletion(item)
  }

  return { problems, clearProblems, clientFor, complete, resolveCompletion, onFlushNeeded, dispose }
}

export type Lsp = ReturnType<typeof createLsp>

/**
 * Keep every server's view of the open documents current. One effect over the
 * open tabs and their buffer contents; everything it sends is captured inside
 * the tracked run — only the didChange *send* is deferred, so a tab switch
 * during the debounce can never re-aim an edit at the wrong document.
 */
export function wireLspEffects(deps: { lsp: Lsp; settings: Settings; workspace: Workspace }) {
  const { lsp, settings, workspace } = deps

  interface Synced {
    client: LspClient
    /** Text and dirty flag as last reported, to tell edits and saves apart. */
    text: string
    dirty: boolean
  }
  const synced = new Map<string, Synced>()
  const pendingEdits = new Map<string, { entry: Synced; text: string }>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  const flushEdit = (path: string) => {
    const edit = pendingEdits.get(path)
    if (!edit) return
    pendingEdits.delete(path)
    edit.entry.client.changeDocument(path, edit.text)
    edit.entry.text = edit.text
  }

  lsp.onFlushNeeded(flushEdit)

  const flushAll = () => {
    flushTimer = null
    // flushEdit removes only the entry being visited, which Map iteration allows.
    for (const path of pendingEdits.keys()) flushEdit(path)
  }

  createEffect(() => {
    if (!settings.config.lsp) {
      // The toggle is a teardown, not a pause: servers die, marks clear, and the
      // sync state empties so turning it back on re-opens every document.
      pendingEdits.clear()
      synced.clear()
      lsp.dispose()
      return
    }

    const open = workspace.tabs()
    const openSet = new Set(open)

    for (const [path, entry] of synced) {
      if (openSet.has(path)) continue
      pendingEdits.delete(path)
      entry.client.closeDocument(path)
      synced.delete(path)
      // Not every server publishes an empty set on didClose; without this a
      // reopened file would show diagnostics from a buffer long gone.
      lsp.clearProblems(path)
    }

    for (const path of open) {
      const buffer = workspace.buffers[path]
      if (!buffer) continue
      // Read here, in the tracked run — these are the captured values.
      const text = buffer.content
      const dirty = buffer.dirty
      const known = synced.get(path)

      if (!known) {
        const client = lsp.clientFor(path)
        if (!client) continue
        client.openDocument(path, filetypeForPath(path) ?? 'plaintext', text)
        synced.set(path, { client, text, dirty })
        continue
      }

      if (text !== known.text) {
        pendingEdits.set(path, { entry: known, text })
        if (!flushTimer) flushTimer = setTimeout(flushAll, CHANGE_DEBOUNCE_MS)
      }
      if (known.dirty && !dirty) {
        // dirty fell: this run is a save. The pending edit goes first so the
        // didSave refers to the text that was actually written.
        flushEdit(path)
        known.client.saveDocument(path)
      }
      known.dirty = dirty
    }
  })

  onCleanup(() => clearTimeout(flushTimer ?? undefined))
}

/**
 * The problem at or after (`direction` 1) / before (−1) the cursor, wrapping
 * around the file. `list` is sorted by position, as `createLsp` stores it.
 */
export function problemFrom(
  list: Problem[],
  line: number,
  col: number,
  direction: 1 | -1,
): Problem | null {
  if (list.length === 0) return null
  const after = (problem: Problem) => problem.line - line || problem.col - col
  if (direction === 1) return list.find(problem => after(problem) > 0) ?? list[0]!
  return list.findLast(problem => after(problem) < 0) ?? list.at(-1)!
}

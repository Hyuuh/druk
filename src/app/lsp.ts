import { fileURLToPath } from 'node:url'

import { createEffect, createSignal, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'

import { filetypeForPath } from '../languages/highlight'
import { spawnLspClient } from '../lsp/client'
import type { LspClient } from '../lsp/client'
import { normalizeCompletion } from '../lsp/completion'
import type { CompletionReply } from '../lsp/completion'
import { normalizeDefinition } from '../lsp/definition'
import type { Target } from '../lsp/definition'
import { hasNodeRuntime, installServer, installedCommand, SERVER_ROOT } from '../lsp/install'
import { projectCommand } from '../lsp/project'
import { isUnnecessary, severityOf } from '../lsp/protocol'
import type { CompletionItem, Diagnostic, ProblemSeverity } from '../lsp/protocol'
import { installHint, resolveServer } from '../lsp/servers'
import type { PromptState } from './prompts'
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

/**
 * How long the dependency directories must sit still before the servers are
 * restarted. An install writes for as long as it takes, and a server spawned
 * into a half-written `node_modules` is the stale-diagnostics problem again —
 * so the wait is for the writing to stop, not for the first event.
 */
const DEPENDENCY_QUIET_MS = 2_000

/** Language servers: one per language, diagnostics per open file. */
export function createLsp(deps: {
  rootDir: string
  settings: Settings
  status: Status
  prompts: PromptState
}) {
  const { rootDir, settings, status, prompts } = deps

  const [problems, setProblems] = createStore<Record<string, Problem[]>>({})
  /** By server id. `null` marks one that failed, so nothing respawns it. */
  const clients = new Map<string, LspClient | null>()
  /**
   * Bumped when a server becomes spawnable again. `wireLspEffects` reads it, so
   * an install can re-open documents that were skipped while the server was
   * missing — nothing else in that effect changes when a server comes back.
   */
  const [generation, setGeneration] = createSignal(0)
  /**
   * Bumped by `restart`. `wireLspEffects` watches it to forget which documents
   * are open, which is what makes the fresh servers receive them all again.
   */
  const [restarts, setRestarts] = createSignal(0)
  /** Server ids already offered this session, so a decline is not re-asked. */
  const offered = new Set<string>()

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

  /**
   * What to do about a server that is not installed: offer to fetch it when druk
   * can, otherwise print the line that installs it by hand. Asked once per server
   * per session — `offered` outlives the failure mark, so a decline is final
   * until the next launch.
   */
  const reportMissing = (resolved: NonNullable<ReturnType<typeof resolveServer>>) => {
    const name = resolved.command[0]!
    const spec = resolved.install
    if (!spec) return status.say(`LSP: ${name} is not installed, or not on PATH`, 'warn')
    if (
      spec.kind === 'npm' &&
      settings.config.lspAutoInstall &&
      !offered.has(resolved.id) &&
      // The servers druk installs are node scripts; without node they would
      // download fine and then fail to spawn.
      hasNodeRuntime()
    ) {
      offered.add(resolved.id)
      return prompts.setPrompt({
        kind: 'installServer',
        id: resolved.id,
        name,
        packages: spec.packages,
      })
    }
    status.say(`LSP: ${name} not installed — ${installHint(spec)}`, 'warn')
  }

  /**
   * `initialize` options for one server. Only typescript has any: it drives a
   * separate `tsserver`, and which TypeScript that is deserves to be settable.
   * Left empty the server decides — it prefers the open project's own copy,
   * which is what a project pinning a compiler version wants, and only falls
   * back to the one druk installed.
   */
  const initializationOptionsFor = (id: string): unknown => {
    if (id !== 'typescript') return undefined
    const tsdk = settings.config.typescriptTsdk.trim()
    return tsdk ? { tsserver: { path: tsdk } } : undefined
  }

  /** The running client for `path`'s language — spawned on first use. */
  const clientFor = (path: string): LspClient | null => {
    if (!settings.config.lsp) return null
    const resolved = resolveServer(filetypeForPath(path), settings.config.lspServers)
    if (!resolved) return null
    const known = clients.get(resolved.id)
    if (known !== undefined) return known
    // The project's own server first — for TypeScript it is the only one that
    // can serve a 7.x project at all. Then a copy druk installed; PATH is
    // consulted only when there is neither, so a user's own install wins from
    // the moment they make one.
    const project = projectCommand(resolved.id, resolved.command, rootDir)
    const fetched = project ? null : installedCommand(resolved.command)
    const command = project ?? fetched ?? resolved.command
    const client = spawnLspClient({
      command,
      rootDir,
      initializationOptions: initializationOptionsFor(resolved.id),
      onDiagnostics,
      onFail: (reason, missing) => {
        clients.set(resolved.id, null)
        if (missing) return reportMissing(resolved)
        status.say(
          // A copy druk fetched can be broken in ways the user cannot see and did
          // not cause — a dependency that moved on, most of all. Naming the
          // directory is what makes that repairable without reading the source.
          // The project's own copy gets no such advice: deleting druk's would
          // not touch it.
          fetched
            ? `LSP: ${command[0]} ${reason} — delete ${SERVER_ROOT} to reinstall it`
            : `LSP: ${command[0]} ${reason}`,
          'warn',
        )
      },
    })
    clients.set(resolved.id, client)
    return client
  }

  /**
   * Fetch a server the user agreed to install, then let it spawn: the failure
   * mark goes, and the generation bump re-opens the documents that were skipped
   * while it was missing.
   */
  const install = async (id: string, name: string, packages: string[]) => {
    status.say(`Installing ${name}…`)
    const error = await installServer(packages)
    if (error) return status.say(`Could not install ${name}: ${error}`, 'error')
    // npm can exit 0 having produced no binary — a package whose bin moved, or
    // one installed for another platform. Saying "installed" then would send
    // the user round the same prompt on every launch with nothing to show why.
    if (!installedCommand([name])) {
      return status.say(`Installed ${name}, but no ${name} appeared in ${SERVER_ROOT}`, 'error')
    }
    clients.delete(id)
    setGeneration(generation() + 1)
    status.say(`Installed ${name}`)
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

  /**
   * Kill the servers and let the open documents spawn them again. The only cure
   * for a server whose view of the project is stale: druk registers no watched
   * files, so nothing else tells one that `node_modules` — or a config it read
   * at startup — has changed under it.
   */
  const restart = () => {
    const running = clients.size > 0
    dispose()
    setRestarts(restarts() + 1)
    return running
  }

  let depsTimer: ReturnType<typeof setTimeout> | null = null

  /** The watcher saw a dependency directory written. */
  const dependenciesChanged = () => {
    if (!settings.config.lsp) return
    if (depsTimer) clearTimeout(depsTimer)
    depsTimer = setTimeout(() => {
      depsTimer = null
      // Nothing spawned yet: the next `clientFor` reads the new tree anyway, and
      // saying so about servers the user never started would be noise.
      if (restart()) status.say('Dependencies changed — restarted language servers')
    }, DEPENDENCY_QUIET_MS)
  }

  onCleanup(() => clearTimeout(depsTimer ?? undefined))

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
   * Where the symbol at a buffer position is defined. The pending didChange
   * goes out first, for the reason completion flushes it: a server answering
   * against text 150ms stale would name a line that has since moved.
   */
  const definition = async (path: string, line: number, col: number): Promise<Target | null> => {
    if (!settings.config.lsp) return null
    const client = clientFor(path)
    if (!client?.ready()) return null
    flushEdits?.(path)
    return normalizeDefinition(await client.definition(path, { line, character: col }))
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

  return {
    problems,
    clearProblems,
    clientFor,
    complete,
    definition,
    resolveCompletion,
    onFlushNeeded,
    install,
    generation,
    restart,
    restarts,
    dependenciesChanged,
    dispose,
  }
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
  let lastRestart = lsp.restarts()

  const flushEdit = (path: string) => {
    const edit = pendingEdits.get(path)
    if (!edit) return
    pendingEdits.delete(path)
    edit.entry.client.changeDocument(path, edit.text)
    edit.entry.text = edit.text
    // Pull servers report nothing on their own: every sync is followed by the
    // question, or the marks would stay on the text they were computed for.
    edit.entry.client.pullDiagnostics(path)
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

    // Tracked for its side effect on `clientFor`: a server just installed can
    // now spawn, and the documents it should have opened are already open.
    lsp.generation()

    const restarts = lsp.restarts()
    if (restarts !== lastRestart) {
      lastRestart = restarts
      // `restart` has already killed the servers; forgetting what they knew is
      // what makes the loop below open every document into the fresh ones.
      pendingEdits.clear()
      synced.clear()
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
        client.pullDiagnostics(path)
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
        // A formatter may have rewritten the file, and a save is when a pull
        // server's project-wide errors are worth asking about again.
        known.client.pullDiagnostics(path)
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

/**
 * Which language server serves which filetype.
 *
 * druk knows about no server until an extension names one: the specs live in the
 * market (`extensions/<language>/extension.json` in this repository), so a server for
 * a new language reaches users the moment its pull request merges rather than at
 * the next release. What a spec holds is still only a command looked up on the
 * user's PATH — a missing one means no diagnostics for that language, though
 * druk offers to fetch the ones it can, an npm package or a release binary,
 * into a prefix of its own (see `./install`).
 *
 * The `id` is the key the `lspServers` config setting overrides — a user points
 * it at another command (`{ "typescript": ["deno", "lsp"] }`) or disables the
 * server with an empty array. The settings page toggles servers the same way.
 */

/**
 * How a missing server is obtained. `npm` and `download` are the cases druk can
 * carry out itself — a package install, or a release binary fetched from a URL
 * (see `./install.ts`); `manual` is a line to print, for servers that come with
 * a language toolchain. Servers with neither (clangd, zls, sourcekit-lsp) ship
 * with an SDK, and no one command installs them on every OS.
 */
export type ServerInstall =
  | { kind: 'npm'; packages: string[] }
  | { kind: 'manual'; command: string }
  | { kind: 'download'; url: string }

/** The kinds druk can install itself — what a confirm prompt ever carries. */
export type FetchableInstall = Exclude<ServerInstall, { kind: 'manual' }>

export interface ServerSpec {
  id: string
  command: string[]
  /** OpenTUI filetype ids (see src/languages) this server is spawned for. */
  filetypes: string[]
  install?: ServerInstall
  /**
   * The configuration object this server is given: answered to every
   * `workspace/configuration` item and pushed once as `didChangeConfiguration`.
   *
   * Opaque on purpose — it is the server's own settings shape, not druk's, and
   * a manifest is the only place that knows it. eslint's server is why this
   * exists: it lints nothing at all until it has been told `validate: "on"`.
   */
  settings?: unknown
}

/** Contributed by an extension, and dropped again when extensions reload. */
let fromExtensions: ServerSpec[] = []

export function registerServer(spec: ServerSpec): void {
  fromExtensions = [...fromExtensions.filter(server => server.id !== spec.id), spec]
}

export function clearExtensionServers(): void {
  fromExtensions = []
}

/**
 * Every server on offer — whatever the installed extensions registered, in load
 * order. A later extension claiming an id replaces the earlier one's spec, which is
 * how a project's own extension folder overrides a market extension for that language.
 */
export function servers(): ServerSpec[] {
  return fromExtensions
}

/** The line that tells a user how to install `spec` themselves. */
export function installHint(install: ServerInstall): string {
  if (install.kind === 'npm') return `npm i -g ${install.packages.join(' ')}`
  if (install.kind === 'download') return `Download it from ${install.url}`
  return install.command
}

/**
 * The server to run for `filetype`, with any user override applied. `install` is
 * dropped for an overridden command — it describes the default's package, and
 * would send the user to install something they deliberately replaced.
 */
export interface ResolvedServer {
  id: string
  command: string[]
  install?: ServerInstall
  settings?: unknown
}

const resolveOne = (
  spec: ServerSpec,
  overrides: Record<string, string[]>,
): ResolvedServer | null => {
  const override = overrides[spec.id]
  const command = override ?? spec.command
  if (command.length === 0) return null
  return {
    id: spec.id,
    command,
    install: override ? undefined : spec.install,
    settings: spec.settings,
  }
}

/**
 * Every server registered for `filetype`, in extension load order.
 *
 * More than one is the normal case, not an edge: a linter and a language server
 * both serve TypeScript, the way eslint and tsserver do in VS Code, and neither
 * is a substitute for the other. All of them are spawned and synced; which one
 * answers a *feature* request is `app/lsp.ts`'s business.
 */
export function resolveServers(
  filetype: string | undefined,
  overrides: Record<string, string[]>,
): ResolvedServer[] {
  if (!filetype) return []
  return servers()
    .filter(server => server.filetypes.includes(filetype))
    .map(spec => resolveOne(spec, overrides))
    .filter(resolved => resolved !== null)
}

/** The first server for `filetype` — what the settings page and its tests ask about. */
export function resolveServer(
  filetype: string | undefined,
  overrides: Record<string, string[]>,
): ResolvedServer | null {
  return resolveServers(filetype, overrides)[0] ?? null
}

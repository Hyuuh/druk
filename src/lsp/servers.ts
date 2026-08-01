/**
 * Which language server serves which filetype.
 *
 * druk knows about no server until a plugin names one: the specs live in the
 * market (`plugins/<language>/plugin.json` in this repository), so a server for
 * a new language reaches users the moment its pull request merges rather than at
 * the next release. What a spec holds is still only a command looked up on the
 * user's PATH — a missing one means no diagnostics for that language, though
 * druk offers to install the npm ones into a prefix of its own (see `./install`).
 *
 * The `id` is the key the `lspServers` config setting overrides — a user points
 * it at another command (`{ "typescript": ["deno", "lsp"] }`) or disables the
 * server with an empty array. The settings page toggles servers the same way.
 */

/**
 * How a missing server is obtained. `npm` is the case druk can carry out itself;
 * `manual` is a line to print, for servers that come with a language toolchain.
 * Servers with neither (clangd, zls, sourcekit-lsp) ship with an SDK, and no one
 * command installs them on every OS.
 */
export type ServerInstall =
  | { kind: 'npm'; packages: string[] }
  | { kind: 'manual'; command: string }

export interface ServerSpec {
  id: string
  command: string[]
  /** OpenTUI filetype ids (see src/languages) this server is spawned for. */
  filetypes: string[]
  install?: ServerInstall
}

/** Contributed by a plugin, and dropped again when plugins reload. */
let fromPlugins: ServerSpec[] = []

export function registerServer(spec: ServerSpec): void {
  fromPlugins = [...fromPlugins.filter(server => server.id !== spec.id), spec]
}

export function clearPluginServers(): void {
  fromPlugins = []
}

/**
 * Every server on offer — whatever the installed plugins registered, in load
 * order. A later plugin claiming an id replaces the earlier one's spec, which is
 * how a project's own plugin folder overrides a market plugin for that language.
 */
export function servers(): ServerSpec[] {
  return fromPlugins
}

/** The line that tells a user how to install `spec` themselves. */
export function installHint(install: ServerInstall): string {
  return install.kind === 'npm' ? `npm i -g ${install.packages.join(' ')}` : install.command
}

/**
 * The server to run for `filetype`, with any user override applied. `install` is
 * dropped for an overridden command — it describes the default's package, and
 * would send the user to install something they deliberately replaced.
 */
export function resolveServer(
  filetype: string | undefined,
  overrides: Record<string, string[]>,
): { id: string; command: string[]; install?: ServerInstall } | null {
  if (!filetype) return null
  const spec = servers().find(server => server.filetypes.includes(filetype))
  if (!spec) return null
  const override = overrides[spec.id]
  const command = override ?? spec.command
  if (command.length === 0) return null
  return { id: spec.id, command, install: override ? undefined : spec.install }
}

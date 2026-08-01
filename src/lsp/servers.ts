/**
 * Which language server serves which filetype. druk ships no servers: these are
 * commands looked up on the user's PATH, and a missing one just means no
 * diagnostics for that language — though druk offers to install the npm ones
 * into a prefix of its own (see `./install`).
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

const npm = (...packages: string[]): ServerInstall => ({ kind: 'npm', packages })
const manual = (command: string): ServerInstall => ({ kind: 'manual', command })

export const DEFAULT_SERVERS: ServerSpec[] = [
  {
    id: 'typescript',
    command: ['typescript-language-server', '--stdio'],
    filetypes: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    // typescript is pinned to 5: `typescript@latest` is now 7.x, the native Go
    // port, which ships a platform binary and no `tsserver.js` at all — the
    // thing typescript-language-server exists to drive. Installing it unpinned
    // gets a server that starts and then fails its handshake with "Could not
    // find a valid TypeScript installation".
    install: npm('typescript-language-server', 'typescript@5'),
  },
  {
    id: 'go',
    command: ['gopls'],
    filetypes: ['go'],
    install: manual('go install golang.org/x/tools/gopls@latest'),
  },
  {
    id: 'rust',
    command: ['rust-analyzer'],
    filetypes: ['rust'],
    install: manual('rustup component add rust-analyzer'),
  },
  {
    id: 'python',
    command: ['pyright-langserver', '--stdio'],
    filetypes: ['python'],
    install: npm('pyright'),
  },
  { id: 'clangd', command: ['clangd'], filetypes: ['c', 'cpp'] },
  { id: 'zig', command: ['zls'], filetypes: ['zig'] },
  { id: 'lua', command: ['lua-language-server'], filetypes: ['lua'] },
  {
    id: 'bash',
    command: ['bash-language-server', 'start'],
    filetypes: ['bash'],
    install: npm('bash-language-server'),
  },
  {
    id: 'ruby',
    command: ['solargraph', 'stdio'],
    filetypes: ['ruby'],
    install: manual('gem install solargraph'),
  },
  {
    id: 'php',
    command: ['intelephense', '--stdio'],
    filetypes: ['php'],
    install: npm('intelephense'),
  },
  { id: 'swift', command: ['sourcekit-lsp'], filetypes: ['swift'] },
  {
    id: 'css',
    command: ['vscode-css-language-server', '--stdio'],
    filetypes: ['css'],
    install: npm('vscode-langservers-extracted'),
  },
  {
    id: 'html',
    command: ['vscode-html-language-server', '--stdio'],
    filetypes: ['html'],
    install: npm('vscode-langservers-extracted'),
  },
  {
    id: 'json',
    command: ['vscode-json-language-server', '--stdio'],
    filetypes: ['json'],
    install: npm('vscode-langservers-extracted'),
  },
]

/** Contributed by a plugin, and dropped again when plugins reload. */
let fromPlugins: ServerSpec[] = []

export function registerServer(spec: ServerSpec): void {
  fromPlugins = [...fromPlugins.filter(server => server.id !== spec.id), spec]
}

export function clearPluginServers(): void {
  fromPlugins = []
}

/**
 * Every server on offer, plugins first: a plugin entry whose id or filetype
 * matches a built-in replaces it, which is how one teaches druk about a server
 * for a language it ships no entry for *and* how one swaps out the entry it
 * does ship.
 */
export function servers(): ServerSpec[] {
  const shadowed = new Set(fromPlugins.map(spec => spec.id))
  return [...fromPlugins, ...DEFAULT_SERVERS.filter(spec => !shadowed.has(spec.id))]
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

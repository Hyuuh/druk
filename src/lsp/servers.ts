/**
 * Which language server serves which filetype. druk ships no servers: these are
 * commands looked up on the user's PATH, and a missing one just means no
 * diagnostics for that language.
 *
 * The `id` is the key the `lspServers` config setting overrides — a user points
 * it at another command (`{ "typescript": ["deno", "lsp"] }`) or disables the
 * server with an empty array.
 */
export interface ServerSpec {
  id: string
  command: string[]
  /** OpenTUI filetype ids (see src/languages) this server is spawned for. */
  filetypes: string[]
}

export const DEFAULT_SERVERS: ServerSpec[] = [
  {
    id: 'typescript',
    command: ['typescript-language-server', '--stdio'],
    filetypes: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
  },
  { id: 'go', command: ['gopls'], filetypes: ['go'] },
  { id: 'rust', command: ['rust-analyzer'], filetypes: ['rust'] },
  { id: 'python', command: ['pyright-langserver', '--stdio'], filetypes: ['python'] },
  { id: 'clangd', command: ['clangd'], filetypes: ['c', 'cpp'] },
  { id: 'zig', command: ['zls'], filetypes: ['zig'] },
  { id: 'lua', command: ['lua-language-server'], filetypes: ['lua'] },
  { id: 'bash', command: ['bash-language-server', 'start'], filetypes: ['bash'] },
  { id: 'ruby', command: ['solargraph', 'stdio'], filetypes: ['ruby'] },
  { id: 'php', command: ['intelephense', '--stdio'], filetypes: ['php'] },
  { id: 'swift', command: ['sourcekit-lsp'], filetypes: ['swift'] },
  { id: 'css', command: ['vscode-css-language-server', '--stdio'], filetypes: ['css'] },
  { id: 'html', command: ['vscode-html-language-server', '--stdio'], filetypes: ['html'] },
  { id: 'json', command: ['vscode-json-language-server', '--stdio'], filetypes: ['json'] },
]

/** The server to run for `filetype`, with any user override applied. */
export function resolveServer(
  filetype: string | undefined,
  overrides: Record<string, string[]>,
): { id: string; command: string[] } | null {
  if (!filetype) return null
  const spec = DEFAULT_SERVERS.find(server => server.filetypes.includes(filetype))
  if (!spec) return null
  const command = overrides[spec.id] ?? spec.command
  return command.length > 0 ? { id: spec.id, command } : null
}

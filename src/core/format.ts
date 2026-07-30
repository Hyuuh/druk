/**
 * Format on save: run the user's own formatter over the file just written.
 * druk ships no formatter — the `formatters` setting maps extensions to a
 * command (prettier, eslint --fix, oxfmt, gofmt -w, …) that rewrites the file
 * in place, and the workspace pulls the result back into the buffer.
 */
import { spawn } from 'node:child_process'
import { extname } from 'node:path'

/** A formatter that hangs would otherwise hold the buffer's re-read forever. */
const FORMAT_TIMEOUT = 10_000

/**
 * The command for `path`, or null when nothing matches. Keys are comma-separated
 * extensions without the dot (`"ts,tsx"`); `"*"` matches any file but only when
 * no extension key did, so a catch-all and a specific entry can coexist.
 */
export function formatterFor(path: string, formatters: Record<string, string[]>): string[] | null {
  const ext = extname(path).slice(1).toLowerCase()
  let fallback: string[] | null = null
  for (const [key, command] of Object.entries(formatters)) {
    if (command.length === 0) continue
    if (key === '*') {
      fallback = command
      continue
    }
    if (ext && key.split(',').some(part => part.trim().toLowerCase() === ext)) return command
  }
  return fallback
}

/**
 * Stands in for the file's path inside a formatter command. Appending the path is
 * right for most tools, but not for the ones that want it before a flag or inside
 * an argument (`--stdin-filepath={}`), so the token is what makes those sayable.
 */
export const FILE_TOKEN = '{}'

/**
 * The arguments the formatter runs with: the token replaced wherever it appears,
 * or the path appended when the command never mentions it.
 */
export function formatArgs(command: string[], path: string): string[] {
  const args = command.slice(1)
  return args.some(arg => arg.includes(FILE_TOKEN))
    ? args.map(arg => arg.replaceAll(FILE_TOKEN, path))
    : [...args, path]
}

const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''

/**
 * Run `command` over `path`, from `cwd` so the tool finds its own project config.
 * Resolves to an error line for the status bar, or null on success — the caller
 * re-reads the file to see what the formatter did.
 */
export function runFormatter(command: string[], path: string, cwd: string): Promise<string | null> {
  return new Promise(resolve => {
    const [bin] = command
    const child = spawn(bin!, formatArgs(command, path), {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    let killed = false
    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGKILL')
    }, FORMAT_TIMEOUT)
    // 'error' (spawn failure) and 'close' can both fire; the first one answers.
    let settled = false
    const finish = (error: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(error)
    }
    child.on('error', err =>
      finish(
        'code' in err && err.code === 'ENOENT'
          ? `${bin} is not installed, or not on PATH`
          : err.message,
      ),
    )
    child.on('close', code => {
      if (killed) return finish(`${bin} timed out`)
      if (code === 0) return finish(null)
      return finish(firstLine(stderr || stdout) || `${bin} exited with code ${code}`)
    })
  })
}

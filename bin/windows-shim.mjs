import { rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * PowerShell can resolve npm's extensionless POSIX shim before druk.cmd. Windows then
 * opens the extensionless file with ShellExecute instead of starting the editor.
 * npm_config_prefix is the directory that contains global Windows shims.
 *
 * @param {{ platform?: NodeJS.Platform, global?: string, prefix?: string }} options
 */
export function removeWindowsBareShim({
  platform = process.platform,
  global = process.env.npm_config_global,
  prefix = process.env.npm_config_prefix,
} = {}) {
  if (platform !== 'win32' || global !== 'true' || !prefix) return
  try {
    rmSync(join(prefix, 'druk'))
  } catch {
    // Best-effort: druk.cmd and druk.ps1 remain the supported Windows entry points.
  }
}

/**
 * Removing the launcher PowerShell cannot start.
 *
 * A global install on Windows leaves npm three launchers — `druk`, `druk.cmd` and
 * `druk.ps1`. PowerShell matches the extensionless one before it ever consults PATHEXT
 * and hands it to ShellExecute, which has no association for a file without an
 * extension: `druk` opens the "how do you want to open this file?" dialog instead of
 * the editor. Deleting it leaves the two launchers cmd.exe and PowerShell both resolve.
 *
 * The cost is MSYS shells — Git Bash and Cygwin run the extensionless sh shim and do no
 * PATHEXT resolution of their own, so `druk` stops being a command there. That is the
 * trade the dialog forces: the two native shells are the way in for nearly everyone.
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * npm exports `npm_config_global_prefix` to every script it runs, but `npm_config_prefix`
 * only when the prefix differs from its default — so the latter is a fallback and never
 * the test. On Windows the global launchers sit in the prefix itself, not `prefix/bin`.
 *
 * @param {{ platform?: NodeJS.Platform, global?: string, location?: string, prefix?: string }} options
 */
export function removeWindowsBareShim({
  platform = process.platform,
  global: isGlobal = process.env.npm_config_global,
  location = process.env.npm_config_location,
  prefix = process.env.npm_config_global_prefix || process.env.npm_config_prefix,
} = {}) {
  if (platform !== 'win32' || !prefix) return
  if (isGlobal !== 'true' && location !== 'global') return
  try {
    rmSync(join(prefix, 'druk'))
  } catch {
    // Best-effort: druk.cmd and druk.ps1 remain the supported Windows entry points.
  }
}

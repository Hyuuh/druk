#!/usr/bin/env node
/**
 * Hands off to the platform binary that npm installed as an optional dependency.
 *
 * This shim is the only JavaScript in the published package: druk itself is a
 * self-contained executable, so it needs neither Bun nor node_modules to run. The shim
 * exists because npm has no other way to pick one binary per platform.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

const platform = process.platform === 'win32' ? 'windows' : process.platform
const target = `${platform}-${process.arch}`
const pkg = `druk-${target}`
const exe = platform === 'windows' ? 'druk.exe' : 'druk'

function resolveBinary() {
  // Beside the shim: where postinstall puts it when the optional dependency was
  // skipped — by --no-optional, a lockfile from another OS, or a blocked fetch.
  const rescued = join(dirname(fileURLToPath(import.meta.url)), exe)
  if (existsSync(rescued)) return rescued
  try {
    return join(dirname(require.resolve(`${pkg}/package.json`)), 'bin', exe)
  } catch {}
  // Nothing published to install from when this repo is linked into a global bin, so
  // fall back to whatever `bun run build` last produced.
  const local = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist', target, exe)
  return existsSync(local) ? local : null
}

const binary = resolveBinary()
if (!binary) {
  process.stderr.write(
    `druk: no binary for ${target} (looked for the ${pkg} package, then dist/${target}/${exe}).\n` +
      `If your platform is supported, reinstall without --no-optional:\n` +
      `  npm install -g druk\n`,
  )
  process.exit(1)
}

const { status, signal, error } = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' })

if (error) {
  process.stderr.write(`druk: could not run ${binary}: ${error.message}\n`)
  process.exit(1)
}
// Re-raise rather than exit(0): a caller checking why druk stopped has to see the
// signal, and $? for a signalled child is 128 + signum, not 0.
if (signal) process.kill(process.pid, signal)
process.exit(status ?? 1)

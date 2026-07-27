#!/usr/bin/env node
/**
 * Hands off to the platform binary, fetching it first if it is not here yet.
 *
 * This shim is the only JavaScript druk ships: the editor is a self-contained
 * executable that needs neither Bun nor node_modules. See binary.mjs for why the
 * executable arrives from the GitHub release rather than from npm.
 */
import { spawnSync } from 'node:child_process'

import { exe, fetchBinary, findBinary, supported, target, version } from './binary.mjs'

let binary = findBinary()

if (!binary) {
  if (!supported) {
    process.stderr.write(`druk: no binary is published for ${target}.\n`)
    process.exit(1)
  }
  // Install skipped its scripts, or had no network then. Say so — this takes seconds
  // and silence would look like a hang.
  process.stderr.write(`druk: fetching the ${target} binary for ${version}…\n`)
  binary = await fetchBinary()
}

if (!binary) {
  process.stderr.write(
    `druk: could not fetch the ${target} binary for ${version}.\n` +
      `Download druk-${target} from https://github.com/letstri/druk/releases/tag/v${version}\n` +
      `and put it on your PATH as ${exe}, or install with:\n` +
      `  curl -fsSL https://druk.letstri.dev/install | bash\n`,
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

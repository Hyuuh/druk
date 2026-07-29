#!/usr/bin/env bun
import './core/assets'
import { flagOutput, resolveTarget } from './core/cli'
import { runUpgrade } from './core/upgrade'

/*
 * Only argument handling lives here; the app is a dynamic import at the bottom.
 * That split is what makes the asset staging in ./core/assets effective: bundled
 * statically, Bun's scope hoisting runs @opentui/core's top-level code *before*
 * this entry module's — source import order notwithstanding — so the env var it
 * needs would be set after it had already looked. A dynamic import cannot be
 * hoisted past this file's own statements. It also keeps `druk --version` from
 * evaluating the whole UI graph.
 */

const flag = flagOutput(process.argv[2])
if (flag !== null) {
  process.stdout.write(flag)
  process.exit(0)
}

// Before the path handling: `update` is a command, not a directory to open.
if (process.argv[2] === 'update') {
  process.exit(await runUpgrade())
}

const target = resolveTarget(process.argv[2], process.cwd())
if (!target) {
  process.stderr.write(`druk: no such file or directory: ${process.argv[2]}\n`)
  process.exit(1)
}

await (await import('./main')).main(target)

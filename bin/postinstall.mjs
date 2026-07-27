#!/usr/bin/env node
/**
 * Make sure the binary for this machine is here, whatever npm did.
 *
 * The platform binary normally arrives as an optional dependency, which is how every
 * compiled CLI on npm does it (esbuild, biome, opencode). Optional means "skip on
 * failure", though, and it is skipped for more than an unsupported platform: an
 * install run with --no-optional, a lockfile made on another OS, or a proxy that
 * refuses one package all leave the shim with nothing to run. Fetching the package
 * directly here costs one npm call and turns a broken install into a working one.
 *
 * Failure is silent by design: a machine druk has no binary for must still be able to
 * finish `npm install` of something that merely depends on it. The shim is what
 * reports the problem, and only if someone actually runs druk.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

const platform = process.platform === 'win32' ? 'windows' : process.platform
const target = `${platform}-${process.arch}`
const name = `druk-${target}`
const exe = platform === 'windows' ? 'druk.exe' : 'druk'
const version = pkg.optionalDependencies?.[name]

// Nothing is published for this platform, so there is nothing to repair.
if (version) {
  const destination = join(here, exe)
  if (!existsSync(destination) && !resolves()) fetchIt()
}

/** True when npm already put the platform package where the shim will find it. */
function resolves() {
  try {
    return existsSync(join(dirname(require.resolve(`${name}/package.json`)), 'bin', exe))
  } catch {
    return false
  }
}

function fetchIt() {
  const temp = mkdtempSync(join(tmpdir(), 'druk-install-'))
  try {
    // --ignore-scripts: the platform packages have none, and running scripts from a
    // package fetched inside a postinstall is not a thing to start doing.
    const npm = spawnSync(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-save',
        '--loglevel=error',
        '--prefix',
        temp,
        `${name}@${version}`,
      ],
      // Piped, not inherited: a failure here is not the user's problem to read about
      // mid-install, and npm's 404 wall would look like the install itself broke.
      { stdio: 'pipe', windowsHide: true },
    )
    if (npm.status !== 0) return
    const from = join(temp, 'node_modules', name, 'bin', exe)
    if (!existsSync(from)) return
    mkdirSync(here, { recursive: true })
    copyFileSync(from, join(here, exe))
  } catch {
    // Left to the shim to report; see the note at the top.
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

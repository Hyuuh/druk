#!/usr/bin/env node
/**
 * Fetch the binary at install time, so the first run is instant.
 *
 * Nothing here is load-bearing: the shim fetches too, on first run, for installs that
 * skipped scripts or had no network at the time. Failure is therefore silent and the
 * exit code is always zero — installing something that merely depends on druk must not
 * break because a download did.
 */
import { fetchBinary, findBinary, supported, target } from './binary.mjs'
import { removeWindowsBareShim } from './windows-shim.mjs'

// Before the download, not after: an install cancelled during a slow fetch would
// otherwise leave the launcher PowerShell cannot start.
removeWindowsBareShim()

// Bounded: an install must never hang on a stalled download (undici waits on a
// trickling body for hours, and pnpm shows only "Running postinstall script…").
// Giving up here costs nothing — the shim fetches again on first run.
if (supported && !findBinary()) {
  process.stderr.write(`druk: fetching the ${target} binary…\n`)
  await fetchBinary({ timeout: 60_000 })
}

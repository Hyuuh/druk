#!/usr/bin/env node
/**
 * Fetch the binary at install time, so the first run is instant.
 *
 * Nothing here is load-bearing: the shim fetches too, on first run, for installs that
 * skipped scripts or had no network at the time. Failure is therefore silent and the
 * exit code is always zero — installing something that merely depends on druk must not
 * break because a download did.
 */
import { fetchBinary, findBinary, supported } from './binary.mjs'

if (supported && !findBinary()) await fetchBinary()

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Give every test process its own config home, before anything reads it.
 *
 * Two reasons, and the second is what makes `--parallel` safe. `src/core/config.ts`
 * resolves `CONFIG_FILE` from this at module load, and `sessions.json` is a single
 * file rewritten whole on every tab change — so without this the suite wrote to the
 * developer's real `~/.config/druk`, and parallel workers would clobber each other's
 * sessions mid-write.
 *
 * A preload, not a `beforeAll`: the path is captured when the module is first
 * imported, which happens before any hook runs.
 */
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'druk-test-config-'))

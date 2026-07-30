import { afterEach } from 'bun:test'
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

/**
 * Destroy every harness a test `launch()`ed and didn't clean up itself.
 *
 * `renderer.destroy()` is what runs Solid's `onCleanup` — closing `App`'s fs
 * watchers and stopping its git-polling timers. Without this sweep those stay
 * open for the rest of the worker process's life, so a file with many `launch()`
 * calls compounds watchers/timers test over test until the process stalls or
 * gets OOM-killed.
 */
afterEach(async () => {
  // Imported lazily, on purpose: a static import would hoist `helpers` — and,
  // through <App/>, `src/core/config.ts` — above the env assignment, capturing
  // the developer's real ~/.config/druk as CONFIG_FILE for the whole process.
  const { liveHarnesses } = await import('./helpers')
  for (const t of liveHarnesses) t.renderer.destroy()
  liveHarnesses.clear()
})

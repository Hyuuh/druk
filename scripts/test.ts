/**
 * Runs the suite one test file per process, sequentially.
 *
 * Not `bun test` (one process): the files interfere — ~140 tests fail on
 * leaked stdin/signal state that separate processes would isolate, and
 * `--isolate`'s fresh global is not enough. Not `bun test --parallel`
 * either: its concurrent workers can busy-spin at 100% CPU forever on
 * macOS ARM (oven-sh/bun#27766, still present in 1.3.14) — the spin is
 * synchronous, so bun's own per-test timeout never fires and only SIGKILL
 * ends the worker. A single bun process at a time has never triggered it;
 * the per-file cap below is a backstop, not an expected path.
 */
import { spawnSync } from 'bun'

const FILE_CAP_MS = 90 * 1000

const files = [...new Bun.Glob('test/*.test.{ts,tsx}').scanSync()].toSorted()
const failed: string[] = []
const started = Date.now()

for (const file of files) {
  const run = spawnSync(['bun', 'test', file], {
    stdout: 'inherit',
    stderr: 'inherit',
    timeout: FILE_CAP_MS,
    killSignal: 'SIGKILL',
  })
  if (run.exitCode !== 0) {
    failed.push(file + (run.exitedDueToTimeout ? ' (hung, killed)' : ''))
  }
}

const seconds = Math.round((Date.now() - started) / 1000)
if (failed.length > 0) {
  console.error(`\n${failed.length} of ${files.length} files failed in ${seconds}s:`)
  for (const file of failed) console.error(`  ${file}`)
  process.exit(1)
}
process.stdout.write(`\n${files.length} files passed in ${seconds}s\n`)

import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { launch, runCommand } from './helpers'

const LONG = '49-tanstack-start-setupmiddleware-callback-imports-are-not-pruned-from-the-client-bundle'

function repo(...branches: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'druk-ovf-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(dir, 'a.ts'), 'one\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  for (const name of branches) git('branch', name)
  return dir
}

test('long branch name does not wrap the picker', async () => {
  const dir = repo(LONG)
  const bare = mkdtempSync(join(tmpdir(), 'druk-ovf-bare-'))
  execFileSync('git', ['init', '-q', '--bare', bare])
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir })
  execFileSync('git', ['push', '-q', '--set-upstream', 'origin', LONG], { cwd: dir })

  const t = await launch(dir, {}, { width: 100, height: 40 })
  await runCommand(t, 'Switch branch')
  const frame = t.captureCharFrame()
  console.log(frame)
  expect(frame).toBeTruthy()
}, 20000)

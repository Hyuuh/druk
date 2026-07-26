import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { testRender } from '@opentui/solid'

import { App } from '../src/app/App'
import { DEFAULTS } from '../src/core/config'
import type { Config } from '../src/core/config'

export type Harness = Awaited<ReturnType<typeof launch>>

/** Temp project used by a test. `files` maps relative paths to contents. */
export function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'druk-'))
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content)
  }
  return dir
}

export async function launch(dir: string, config: Partial<Config> = {}) {
  const t = await testRender(
    () => App({ rootDir: dir, initialConfig: { ...DEFAULTS, checkUpdates: false, ...config } }),
    { width: 80, height: 20 },
  )
  await settle(t)
  return t
}

/**
 * The reconciler flushes on a macrotask, so a frame captured immediately after
 * an event still shows the previous state. Yield before rendering.
 */
export async function settle(t: { flush: () => Promise<void> }): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await t.flush()
}

/** Send keys, then let the reconciler catch up. */
export async function press(t: Harness, action: (input: Harness['mockInput']) => void) {
  action(t.mockInput)
  await settle(t)
}

/**
 * Escape is the prefix of every arrow/function-key sequence, so the terminal
 * parser holds it until it knows no sequence follows. Real typing supplies that
 * gap; tests have to wait for it explicitly.
 */
export async function pressEscape(t: Harness) {
  t.mockInput.pressEscape()
  await new Promise(resolve => setTimeout(resolve, 60))
  await settle(t)
}

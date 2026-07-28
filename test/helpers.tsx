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

export async function launch(
  dir: string,
  config: Partial<Config> = {},
  /** Terminal size, for anything that has to degrade on a small screen. */
  size: { width?: number; height?: number } = {},
  /** `openFile` renders single-file mode, as `druk <file>` does. */
  options: { openFile?: string; openLine?: number } = {},
) {
  const t = await testRender(
    () =>
      App({
        rootDir: dir,
        openFile: options.openFile ?? null,
        openLine: options.openLine ?? null,
        initialConfig: { ...DEFAULTS, checkUpdates: false, ...config },
      }),
    {
      width: size.width ?? 80,
      height: size.height ?? 20,
      // Mirror src/index.tsx. OpenTUI defaults this on and tears the renderer down
      // itself, so without it a Ctrl+C test measures the harness, not the app.
      exitOnCtrlC: false,
    },
  )
  await settle(t)
  return t
}

/**
 * The reconciler flushes on a macrotask, so a frame captured immediately after
 * an event still shows the previous state. Yield before rendering.
 */
export async function settle(
  t: { flush: () => Promise<void> },
  /** Wait longer when something debounced (a scan, the watcher) has to fire first. */
  waitMs = 0,
): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, waitMs))
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

/** Run a palette leaf by typing enough of its label to select it. */
export async function runCommand(t: Harness, label: string) {
  await press(t, input => input.pressKey('p', { ctrl: true }))
  await press(t, input => void input.typeText(label))
  await press(t, input => input.pressEnter())
}

#!/usr/bin/env bun
import './core/assets'
import { render } from '@opentui/solid'

import { App } from './app/App'
import { flagOutput, resolveTarget } from './core/cli'
import { loadConfig } from './core/config'
import { runUpgrade } from './core/upgrade'
import { setTheme } from './themes'

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
const { rootDir, openFile } = target

// Apply the saved theme before the first render.
const config = loadConfig()
setTheme(config.theme)

await render(
  () => <App rootDir={rootDir} openFile={openFile} openLine={target.line} initialConfig={config} />,
  {
    useMouse: true,
    // Without motion reporting the terminal never hands drags to the app, so every
    // click-drag paints the terminal's own selection over the UI instead.
    enableMouseMovement: true,
    // Ctrl+C is handled in App, not here: it copies when there is a selection and
    // quits otherwise. OpenTUI's own exit would bypass the unsaved-buffer prompt and
    // drop the work.
    exitOnCtrlC: false,
    targetFps: 30,
  },
)

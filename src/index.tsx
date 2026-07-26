#!/usr/bin/env bun
import './core/assets'
import { resolve } from 'node:path'

import { render } from '@opentui/solid'

import { App } from './app/App'
import { loadConfig } from './core/config'
import { setTheme } from './themes'

const rootDir = resolve(process.argv[2] ?? process.cwd())

// Apply the saved theme before the first render.
const config = loadConfig()
setTheme(config.theme)

await render(() => <App rootDir={rootDir} initialConfig={config} />, {
  useMouse: true,
  // Without motion reporting the terminal never hands drags to the app, so every
  // click-drag paints the terminal's own selection over the UI instead.
  enableMouseMovement: true,
  // Ctrl+C copies here; quitting is Ctrl+Q. Leaving this on would drop unsaved
  // buffers the moment someone copies out of habit.
  exitOnCtrlC: false,
  targetFps: 30,
})

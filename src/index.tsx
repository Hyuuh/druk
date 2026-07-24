#!/usr/bin/env bun
import './assets'
import { resolve } from 'node:path'

import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'

import { App } from './App'
import { loadConfig } from './config'
import { setTheme } from './theme'

const arg = process.argv[2]
const rootDir = resolve(arg ?? process.cwd())

// Apply the saved theme before the first render.
const config = loadConfig()
setTheme(config.theme)

const renderer = await createCliRenderer({
  useMouse: true,
  exitOnCtrlC: true,
  targetFps: 30,
})

createRoot(renderer).render(<App rootDir={rootDir} initialTheme={config.theme} />)

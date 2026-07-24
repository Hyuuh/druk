#!/usr/bin/env bun
import './assets'
import { resolve } from 'node:path'

import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'

import { App } from './App'

const arg = process.argv[2]
const rootDir = resolve(arg ?? process.cwd())

const renderer = await createCliRenderer({
  useMouse: true,
  exitOnCtrlC: true,
  targetFps: 30,
})

createRoot(renderer).render(<App rootDir={rootDir} />)

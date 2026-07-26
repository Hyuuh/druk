import { expect, mock, test } from 'bun:test'
import * as childProcess from 'node:child_process'

const spawned: string[][] = []
const realSpawnSync = childProcess.spawnSync

mock.module('node:child_process', () => ({
  ...childProcess,
  spawnSync: (cmd: string, args?: string[], options?: object) => {
    spawned.push([cmd, ...(args ?? [])])
    return realSpawnSync(cmd, args as string[], options as never)
  },
}))

const { fixture, launch, press } = await import('./helpers')

test('SCRATCH spawnSync counting', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'b.ts': 'const b = 2\n' })
  spawned.length = 0
  const t = await launch(dir)
  console.log(`launch: ${spawned.length} spawns`, spawned.map(s => s.slice(0, 3).join(' ')))

  spawned.length = 0
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  console.log(`open file: ${spawned.length} spawns`, spawned.map(s => s.slice(0, 3).join(' ')))

  spawned.length = 0
  for (let n = 0; n < 5; n++) await press(t, i => i.typeText('x'))
  console.log(`5 keystrokes: ${spawned.length} spawns`, spawned.map(s => s.slice(0, 3).join(' ')))

  expect(true).toBe(true)
}, 60000)

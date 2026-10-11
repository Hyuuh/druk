import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDir } from './temp'

export interface FakeFile {
  path: string
  additions: number
  deletions: number
  viewed: 'VIEWED' | 'UNVIEWED' | 'DISMISSED'
}

export interface FakeState {
  pr: Record<string, unknown> | null
  files: FakeFile[]
  // Every mark and unmark, as `mark:<path>` / `unmark:<path>`.
  log: string[]
  refuse: boolean
}

// Answers the three calls druk makes, off a JSON file the test can read back.
const SCRIPT = (state: string) => `#!${process.execPath}
const { readFileSync, writeFileSync } = require('node:fs')
const state = JSON.parse(readFileSync(${JSON.stringify(state)}, 'utf8'))
const args = process.argv.slice(2)
const field = (name) => {
  const at = args.findIndex((arg, i) => arg.startsWith(name + '=') && /^-[fF]$/.test(args[i - 1] ?? ''))
  return at === -1 ? null : args[at].slice(name.length + 1)
}
if (args[0] === 'pr' && args[1] === 'view') {
  if (!state.pr) {
    process.stderr.write('no pull requests found for branch "feature"\\n')
    process.exit(1)
  }
  process.stdout.write(JSON.stringify(state.pr))
  process.exit(0)
}
if (args[0] === 'api' && args[1] === 'graphql') {
  const query = field('query') ?? ''
  if (query.startsWith('mutation')) {
    if (state.refuse) {
      process.stderr.write('GraphQL: Resource not accessible by integration\\n')
      process.exit(1)
    }
    const path = field('path')
    const mark = query.includes('unmarkFileAsViewed') ? 'unmark' : 'mark'
    state.log.push(mark + ':' + path)
    for (const file of state.files) {
      if (file.path === path) file.viewed = mark === 'mark' ? 'VIEWED' : 'UNVIEWED'
    }
    writeFileSync(${JSON.stringify(state)}, JSON.stringify(state))
    process.stdout.write('{"data":{}}')
    process.exit(0)
  }
  const nodes = state.files.map((file) => ({ ...file, viewerViewedState: file.viewed }))
  process.stdout.write(JSON.stringify({ data: { repository: { pullRequest: { files: {
    pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } } }))
  process.exit(0)
}
process.stderr.write('unexpected gh call: ' + args.join(' ') + '\\n')
process.exit(2)
`

export function fakeGh(initial: Omit<FakeState, 'log' | 'refuse'>) {
  const dir = tempDir('druk-gh-')
  const state = join(dir, 'state.json')
  const bin = join(dir, 'gh')
  const write = (next: FakeState) => writeFileSync(state, JSON.stringify(next))
  write({ ...initial, log: [], refuse: false })
  writeFileSync(bin, SCRIPT(state))
  chmodSync(bin, 0o755)
  const read = (): FakeState => JSON.parse(readFileSync(state, 'utf-8'))
  return {
    bin,
    read,
    update: (change: Partial<FakeState>) => write({ ...read(), ...change }),
  }
}

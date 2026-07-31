import { afterAll, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const dist = join(root, 'dist')
const hadDist = existsSync(dist)
mkdirSync(dist, { recursive: true })
const backup = mkdtempSync(join(dist, '.release-notices-'))
const preserved = ['npm', 'release', 'windows-x64'].filter(name => existsSync(join(dist, name)))
for (const name of preserved) renameSync(join(dist, name), join(backup, name))
const target = join(dist, 'windows-x64')

afterAll(() => {
  for (const name of ['npm', 'release', 'windows-x64']) {
    rmSync(join(dist, name), { recursive: true, force: true })
  }
  for (const name of preserved) renameSync(join(backup, name), join(dist, name))
  rmSync(backup, { recursive: true })
  if (!hadDist) rmSync(dist)
})

test('release artifacts carry PDFium notices', () => {
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'druk.exe'), 'test binary')

  const result = Bun.spawnSync({
    cmd: [process.execPath, 'run', 'scripts/release.ts', 'windows-x64'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(result.exitCode).toBe(0)

  const archive = readFileSync(join(root, 'dist/release/druk-windows-x64.zip')).toString('latin1')
  expect(archive).toContain('THIRD_PARTY_NOTICES.md')
  expect(archive).toContain('PDFIUM_LICENSE')
  const npm = join(root, 'dist/npm/druk')
  expect(existsSync(join(npm, 'THIRD_PARTY_NOTICES.md'))).toBe(true)
  expect(existsSync(join(npm, 'PDFIUM_LICENSE'))).toBe(true)
  const notice = readFileSync(join(npm, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  expect(notice).toContain('Copyright (c) 2012-2023 Scott Chacon and others')
  expect(notice).toContain('Permission is hereby granted')
  expect(notice).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
  expect(JSON.parse(readFileSync(join(npm, 'package.json'), 'utf8')).files).toEqual([
    'bin',
    'THIRD_PARTY_NOTICES.md',
    'PDFIUM_LICENSE',
  ])
})

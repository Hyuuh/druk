import { expect, test } from 'bun:test'
import { createSignal } from 'solid-js'
import { testRender } from '@opentui/solid'

import { DiffView } from '../src/ui/DiffView'
import { parseDiff } from '../src/core/diff'

function bigDiff(files: number, linesPerFile: number): string {
  const out: string[] = []
  for (let f = 0; f < files; f++) {
    out.push(`diff --git a/src/file${f}.ts b/src/file${f}.ts`)
    out.push('index 1111111..2222222 100644')
    out.push(`--- a/src/file${f}.ts`)
    out.push(`+++ b/src/file${f}.ts`)
    out.push(`@@ -1,${linesPerFile} +1,${linesPerFile} @@`)
    for (let i = 0; i < linesPerFile; i++) {
      out.push(
        i % 3 === 0
          ? `-const old${i} = ${i}`
          : i % 3 === 1
            ? `+const neu${i} = ${i}`
            : ` untouched line ${i}`,
      )
    }
  }
  return out.join('\n') + '\n'
}

function countRenderables(node: any): number {
  let n = 1
  for (const child of node.getChildren?.() ?? []) n += countRenderables(child)
  return n
}

async function settle(t: { flush: () => Promise<void> }) {
  await new Promise(r => setTimeout(r, 0))
  await t.flush()
}

const FILES = Number(process.env.PF ?? 10)
const PER = Number(process.env.PL ?? 100)

test(`DiffView ${FILES}x${PER}`, async () => {
  const diff = bigDiff(FILES, PER)
  const rows = parseDiff(diff).length
  const [open, setOpen] = createSignal(false)
  const t = await testRender(
    () => (
      <box>
        {open() ? <DiffView title="d" diff={diff} onClose={() => {}} /> : <text content="idle" />}
      </box>
    ),
    { width: 120, height: 40 },
  )
  await settle(t)
  const before = countRenderables((t.renderer as any).root)
  Bun.gc(true)
  const memBefore = process.memoryUsage().heapUsed
  const t0 = performance.now()
  setOpen(true)
  await settle(t)
  const elapsed = performance.now() - t0
  const after = countRenderables((t.renderer as any).root)
  Bun.gc(true)
  const memAfter = process.memoryUsage().heapUsed

  const t1 = performance.now()
  await t.renderOnce()
  const frameMs = performance.now() - t1

  console.log(
    `RESULT rows=${rows} renderables=${after - before} openMs=${elapsed.toFixed(1)} frameMs=${frameMs.toFixed(1)} heapMB=${((memAfter - memBefore) / 1e6).toFixed(1)} rss=${(process.memoryUsage().rss / 1e6).toFixed(0)}MB`,
  )
  expect(rows).toBeGreaterThan(0)
}, 300000)

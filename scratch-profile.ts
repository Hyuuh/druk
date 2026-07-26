/** Scratch: breaks the pre-first-frame work into phases. Deleted after measuring. */
const ms = () => Bun.nanoseconds() / 1e6

const rows: [string, number][] = []
let prev = ms()
const mark = (label: string) => {
  const t = ms()
  rows.push([label, t - prev])
  prev = t
}

const bunBoot = prev
const rootDir = process.argv[2] ?? process.cwd()

await import('./src/core/assets')
mark('import ./core/assets  (existsSync walk + OTUI_ASSET_ROOT)')

await import('@opentui/solid')
mark('import @opentui/solid  (pulls @opentui/core + FFI dylib)')

const { loadConfig } = await import('./src/core/config')
mark('import ./core/config')

const config = loadConfig()
mark('loadConfig()  (one readFileSync)')

const { setTheme } = await import('./src/themes')
mark('import ./themes')

setTheme(config.theme)
mark('setTheme()')

await import('./src/app/App')
mark('import ./app/App  (git, fs, search, highlight, every ui/*)')

const { loadSession } = await import('./src/core/session')
const { readFile, mtimeOf } = await import('./src/core/fs')
const { currentBranch, statusMap, upstreamOf, diffLines } = await import('./src/core/git')
const { flattenVisible } = await import('./src/core/fs')
mark('(re-import of already-loaded modules — should be ~0)')

const saved = loadSession(rootDir)
mark(`loadSession('${rootDir}')  -> ${saved.tabs.length} tabs, ${saved.expanded.length} expanded`)

let bytes = 0
for (const p of saved.tabs) {
  try {
    bytes += readFile(p).length
    mtimeOf(p)
  } catch {}
}
mark(`read ${saved.tabs.length} restored tab files (${(bytes / 1024).toFixed(0)} KB)`)

const branch = currentBranch(rootDir)
mark(`currentBranch()  -> ${branch}  [spawnSync git, signal init]`)

const nodes = flattenVisible(rootDir, new Set(saved.expanded), config.showHidden)
mark(`flattenVisible()  -> ${nodes.length} rows`)

// These run in effects that fire during the first flush, before the frame settles.
const st = statusMap(rootDir)
mark(`statusMap()  -> ${st.size} entries  [2x spawnSync git]`)

upstreamOf(rootDir)
mark('upstreamOf()  [1-2x spawnSync git]')

if (saved.activePath) diffLines(saved.activePath)
mark('diffLines(active)  [1x spawnSync git]')

const total = ms()
console.log(`\n=== startup phase breakdown for ${rootDir} ===`)
console.log(`  ${bunBoot.toFixed(1).padStart(7)} ms  bun boot + this script's own start`)
for (const [label, dt] of rows) {
  if (dt < 0.05) continue
  console.log(`  ${dt.toFixed(1).padStart(7)} ms  ${label}`)
}
console.log(`  ${'-'.repeat(7)}`)
console.log(`  ${total.toFixed(1).padStart(7)} ms  total (excludes the actual render)`)

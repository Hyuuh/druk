import { afterAll, describe, expect, test } from 'bun:test'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { createServer } from 'node:http'

// Accepts the request and never responds: headers never arrive.
const silent = createServer(() => {})
// Headers arrive, the body never finishes — the shape of a stalled mirror.
const stalled = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/octet-stream' })
  res.write('partial')
})
silent.listen(0, '127.0.0.1')
stalled.listen(0, '127.0.0.1')
await Promise.all([once(silent, 'listening'), once(stalled, 'listening')])

function port(server: Server) {
  const address = server.address()
  if (address && typeof address === 'object') return address.port
  throw new Error('server is not listening on a TCP port')
}

function closeServer(server: Server) {
  server.closeAllConnections()
  // Bun's http close reports ERR_SERVER_NOT_RUNNING even after a clean
  // listen/close pair (verified on 1.3.14); anything else is a real failure.
  return new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error && !('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')) reject(error)
      else resolve()
    })
  })
}

afterAll(async () => {
  await Promise.all([closeServer(silent), closeServer(stalled)])
})

// binary.mjs bakes DRUK_DOWNLOAD_BASE into its URL at module evaluation, so each
// base needs its own import: env first, then a cache-busted dynamic import.
async function fetchBinaryAgainst(server: Server) {
  process.env.DRUK_DOWNLOAD_BASE = `http://127.0.0.1:${port(server)}`
  const { fetchBinary } = await import(`../bin/binary.mjs?base=${port(server)}`)
  return fetchBinary
}

describe('fetchBinary timeout', () => {
  test('gives up when the server never answers', async () => {
    const fetchBinary = await fetchBinaryAgainst(silent)
    const started = Date.now()
    expect(await fetchBinary({ timeout: 250 })).toBeNull()
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  test('gives up when the body stalls after headers', async () => {
    const fetchBinary = await fetchBinaryAgainst(stalled)
    const started = Date.now()
    expect(await fetchBinary({ timeout: 250 })).toBeNull()
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})

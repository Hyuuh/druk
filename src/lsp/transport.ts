/**
 * JSON-RPC base-protocol framing: `Content-Length: N\r\n\r\n` then N bytes of
 * UTF-8 JSON. Pure functions over bytes — the client owns the process — so this
 * is testable without spawning anything.
 */
import type { RpcMessage } from './protocol'

export function encodeMessage(message: object): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

/**
 * A stateful sink for stdout chunks. Chunk boundaries mean nothing: a message may
 * arrive split anywhere, or several to a chunk, so bytes are buffered until a
 * whole frame is in hand. `Content-Length` is measured in bytes, not characters —
 * slicing the Buffer (never a string) is what keeps multi-byte text intact.
 */
export function createDecoder(onMessage: (message: RpcMessage) => void): (chunk: Buffer) => void {
  let buffered: Buffer = Buffer.alloc(0)
  /** Body bytes still owed once headers are parsed; -1 while reading headers. */
  let expected = -1

  return chunk => {
    buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk])
    for (;;) {
      if (expected < 0) {
        const end = buffered.indexOf('\r\n\r\n')
        if (end < 0) return
        const headers = buffered.subarray(0, end).toString('ascii')
        buffered = buffered.subarray(end + 4)
        const match = /content-length:\s*(\d+)/i.exec(headers)
        // A header block without a length cannot be framed past — but rather than
        // wedging the stream forever, keep scanning for the next block.
        if (!match) continue
        expected = Number(match[1])
      }
      if (buffered.length < expected) return
      const body = buffered.subarray(0, expected)
      buffered = buffered.subarray(expected)
      expected = -1
      try {
        onMessage(JSON.parse(body.toString('utf8')) as RpcMessage)
      } catch {
        // Unparseable JSON from a server is its bug; dropping the frame keeps us up.
      }
    }
  }
}

const PCM_CHUNK_SIZE = 32000
const PCM_CHUNK_INTERVAL_MS = 80

export async function loadPcmFile(path: string): Promise<ArrayBuffer> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`Failed to load ${path}`)
  return res.arrayBuffer()
}

/**
 * Feed the clip to the SDK in chunks, the way a live TTS stream would arrive.
 *
 * The chunking here is what matters, not the file: `send` accepts any PCM16 at
 * the configured sample rate, so a microphone or TTS stream feeds it the same
 * way — hand it bytes as they arrive and mark the final chunk with `end`.
 * Opus uplink encoding runs off the main thread, so pacing here does not block
 * rendering.
 */
export function sendPcmChunks(
  data: ArrayBuffer,
  send: (chunk: Uint8Array, end: boolean) => void,
  onDone?: () => void,
): () => void {
  const bytes = new Uint8Array(data)
  let offset = 0
  let cancelled = false

  const next = () => {
    if (cancelled) return
    if (offset >= bytes.length) {
      send(new Uint8Array(0), true)
      onDone?.()
      return
    }
    const end = Math.min(offset + PCM_CHUNK_SIZE, bytes.length)
    send(bytes.slice(offset, end), false)
    offset = end
    setTimeout(next, PCM_CHUNK_INTERVAL_MS)
  }

  next()
  return () => { cancelled = true }
}

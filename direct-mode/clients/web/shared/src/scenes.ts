/**
 * The two Direct Mode scenes.
 *
 * They differ only in where the audio comes from — a bundled file, or an agent
 * answering the microphone — and both hand it to the same `AvatarSession.send()`.
 * Keeping them side by side here is the point: the second is the first with a
 * different source.
 */
import type { AvatarSession } from './avatar'
import { fetchSampleAudio } from './backend'
import { MicrophoneCapture, base64ToBytes, bytesToBase64 } from './audio'

/** How much audio to hand over at a time. ~64ms at 16 kHz PCM16. */
const CHUNK_BYTES = 2048

/**
 * Scene one: play a clip that ships with the demo.
 *
 * No conversation, no model credentials — just bytes going to Motion Server. This is
 * the smallest thing that proves the SDK, the token and the avatar all work, which is
 * why it is the scene to try first.
 */
export async function playSampleAudio(
  session: AvatarSession,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const audio = await fetchSampleAudio()
  const total = audio.byteLength

  // Streamed in chunks rather than sent whole, because that is what a real source
  // looks like: a TTS service hands over audio as it synthesizes it, and the API
  // is the same either way.
  for (let offset = 0; offset < total; offset += CHUNK_BYTES) {
    const end = Math.min(offset + CHUNK_BYTES, total)
    const isLast = end >= total
    session.send(audio.slice(offset, end), isLast)
    onProgress?.(Math.round((end / total) * 100))
    // Yield between chunks so the render loop keeps running; a tight loop over a
    // long clip freezes the first frames.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

export interface RealtimeCallbacks {
  onReady?: () => void
  /** The agent started answering. */
  onSpeaking?: () => void
  /** The agent finished a reply. */
  onTurnEnd?: () => void
  onTranscript?: (role: 'user' | 'assistant', text: string) => void
  onError?: (message: string) => void
  onClosed?: () => void
}

/**
 * Scene two: talk to the avatar.
 *
 * The microphone goes to the backend, the backend's agent answers, and its speech
 * comes back as PCM which goes to Motion Server exactly like the sample clip does.
 * The conversation runs server-side, so no model credentials reach the browser.
 *
 * There is no LiveKit SDK here on purpose: the agent's audio arrives over this plain
 * WebSocket rather than an RTC track (see the server's realtime.py).
 */
export class RealtimeScene {
  private socket: WebSocket | null = null
  private mic: MicrophoneCapture | null = null
  private ready = false

  constructor(
    private readonly session: AvatarSession,
    private readonly callbacks: RealtimeCallbacks = {},
  ) {}

  get isReady(): boolean {
    return this.ready
  }

  get micActive(): boolean {
    return this.mic?.active ?? false
  }

  /** Connect and wait for the agent to come up. */
  async connect(language = 'en'): Promise<void> {
    const config = this.session.config
    if (!config) throw new Error('Connect the avatar first')

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(config.realtimeUrl)
      this.socket = socket

      const timer = window.setTimeout(
        () => reject(new Error('Timed out waiting for the agent')),
        20_000,
      )

      socket.onopen = () => socket.send(JSON.stringify({ type: 'start', language }))

      socket.onmessage = (event) => {
        let msg: any
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }
        switch (msg.type) {
          case 'ready':
            window.clearTimeout(timer)
            this.ready = true
            this.callbacks.onReady?.()
            resolve()
            break
          case 'audio': {
            // The reply, on its way to Motion Server. `end` stays false: a turn is
            // many of these, and turn_end is what closes it.
            const bytes = base64ToBytes(msg.audio || '')
            if (bytes.length) {
              this.callbacks.onSpeaking?.()
              this.session.send(bytes.buffer as ArrayBuffer, false)
            }
            break
          }
          case 'turn_end':
            // The empty final send is what tells the SDK the turn is over, so the
            // avatar returns to idle instead of holding the last mouth shape.
            this.session.send(new ArrayBuffer(0), true)
            this.callbacks.onTurnEnd?.()
            break
          case 'interrupt':
            // The user talked over the reply; drop what has not played yet.
            this.session.interrupt()
            break
          case 'transcript':
            this.callbacks.onTranscript?.(msg.role, msg.text)
            break
          case 'error':
            window.clearTimeout(timer)
            this.callbacks.onError?.(msg.message || 'Agent error')
            reject(new Error(msg.message || 'Agent error'))
            break
        }
      }

      socket.onerror = () => {
        window.clearTimeout(timer)
        reject(new Error(`Cannot reach the agent at ${config.realtimeUrl}`))
      }

      socket.onclose = () => {
        this.ready = false
        this.callbacks.onClosed?.()
      }
    })
  }

  /** Open the microphone. The agent decides on its own when a turn has ended. */
  async startMic(): Promise<void> {
    if (!this.socket || !this.ready || this.mic) return
    const sampleRate = this.session.config?.sampleRate ?? 16_000
    const mic = new MicrophoneCapture(sampleRate)
    this.mic = mic
    await mic.start((chunk) => {
      if (this.socket?.readyState !== WebSocket.OPEN) return
      this.socket.send(
        JSON.stringify({ type: 'mic_audio', audio: bytesToBase64(new Uint8Array(chunk)) }),
      )
    })
  }

  async stopMic(): Promise<void> {
    await this.mic?.stop()
    this.mic = null
  }

  /** Speak a typed line, for testing without a microphone. */
  say(text: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'text', text }))
    }
  }

  interrupt(): void {
    this.session.interrupt()
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'interrupt' }))
    }
  }

  async close(): Promise<void> {
    await this.stopMic()
    this.socket?.close()
    this.socket = null
    this.ready = false
  }
}

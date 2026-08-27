/**
 * The realtime scene's link to the backend agent.
 *
 * Direct Mode either way: the client owns the Motion Server connection and drives
 * the avatar itself. The scenes differ only in where the audio comes from —
 *
 *   pre-recorded  a bundled .pcm file  ──────────────────►  controller.send()
 *   realtime      mic ──ws──► agent (ASR/LLM/TTS) ──ws──►  controller.send()
 *
 * — so both end at the same call and the rendering side is untouched.
 *
 * There is no LiveKit SDK here on purpose. The agent runs server-side without a
 * room: `AgentSession` only builds a RoomIO when its audio input and output are
 * unset, and the backend sets both (see servers/python/realtime.py), so its speech
 * comes back over this plain WebSocket as PCM16.
 */
import { fetchConfig } from '@direct-core'

/** PCM16 mono, matching the rate the SDK was initialized with. */
export const SAMPLE_RATE = 16000

export interface RealtimeCallbacks {
  onReady?: () => void
  /** A reply started arriving. */
  onSpeaking?: () => void
  /** The agent finished a reply. */
  onTurnEnd?: () => void
  onTranscript?: (role: 'user' | 'assistant', text: string) => void
  onError?: (message: string) => void
  onClosed?: () => void
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // In chunks: spreading a whole buffer into fromCharCode blows the stack once the
  // audio is more than a second or so long.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function floatToPcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return buffer
}

function resampleMono(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return input
  const outputLength = Math.max(1, Math.round((input.length * outputRate) / inputRate))
  const output = new Float32Array(outputLength)
  const ratio = (input.length - 1) / Math.max(1, outputLength - 1)
  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio
    const index = Math.floor(position)
    const next = Math.min(index + 1, input.length - 1)
    const fraction = position - index
    output[i] = input[index] * (1 - fraction) + input[next] * fraction
  }
  return output
}

/**
 * Microphone capture at the SDK's configured rate.
 *
 * The browser hands audio over at the device's own rate — 44.1 or 48 kHz — so it is
 * resampled here rather than at the far end.
 */
class MicrophoneCapture {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null

  get active(): boolean {
    return this.context !== null
  }

  async start(onChunk: (pcm16: ArrayBuffer) => void): Promise<void> {
    if (this.context) return

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(this.stream)
    this.processor = this.context.createScriptProcessor(4096, 1, 1)
    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      // Silence the monitor path: the processor has to be connected to the
      // destination to run at all, and without this the mic echoes to the speakers.
      event.outputBuffer.getChannelData(0).fill(0)
      const resampled = resampleMono(input, this.context?.sampleRate ?? SAMPLE_RATE, SAMPLE_RATE)
      if (resampled.length) onChunk(floatToPcm16(resampled))
    }

    this.source.connect(this.processor)
    this.processor.connect(this.context.destination)
  }

  async stop(): Promise<void> {
    this.processor?.disconnect()
    this.source?.disconnect()
    // We started the capture, so we stop it — otherwise the tab's recording
    // indicator stays lit after the scene is closed.
    this.stream?.getTracks().forEach((track) => track.stop())
    await this.context?.close()
    this.processor = null
    this.source = null
    this.stream = null
    this.context = null
  }
}

/** What the avatar side has to provide: somewhere to put audio, and a way to stop. */
export interface AvatarSink {
  send: (pcm16: ArrayBuffer, end: boolean) => void
  interrupt: () => void
}

export class RealtimeClient {
  private socket: WebSocket | null = null
  private mic = new MicrophoneCapture()
  private ready = false

  constructor(
    private readonly avatar: AvatarSink,
    private readonly callbacks: RealtimeCallbacks = {},
  ) {}

  get isReady(): boolean {
    return this.ready
  }

  get micActive(): boolean {
    return this.mic.active
  }

  /** Connect, and resolve once the agent is up and listening. */
  async connect(url: string, language = 'en'): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url)
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
              this.avatar.send(bytes.buffer as ArrayBuffer, false)
            }
            break
          }
          case 'turn_end':
            // The empty final send is what tells the SDK the turn is over, so the
            // avatar returns to idle rather than holding the last mouth shape.
            this.avatar.send(new ArrayBuffer(0), true)
            this.callbacks.onTurnEnd?.()
            break
          case 'interrupt':
            // The user talked over the reply; drop what has not played yet.
            this.avatar.interrupt()
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
        reject(new Error(`Cannot reach the agent at ${url}`))
      }

      socket.onclose = () => {
        this.ready = false
        this.callbacks.onClosed?.()
      }
    })
  }

  /** Open the mic. The agent decides on its own when a turn has ended. */
  async startMic(): Promise<void> {
    if (!this.socket || !this.ready || this.mic.active) return
    await this.mic.start((chunk) => {
      if (this.socket?.readyState !== WebSocket.OPEN) return
      this.socket.send(
        JSON.stringify({ type: 'mic_audio', audio: bytesToBase64(new Uint8Array(chunk)) }),
      )
    })
  }

  async stopMic(): Promise<void> {
    await this.mic.stop()
  }

  /** Speak a fixed line, for trying the scene without a microphone. */
  say(text: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'text', text }))
    }
  }

  interrupt(): void {
    this.avatar.interrupt()
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

/** Where the agent's WebSocket lives, as reported by the backend. */
export async function fetchRealtimeUrl(): Promise<string> {
  const config = await fetchConfig()
  return config.realtimeUrl
}

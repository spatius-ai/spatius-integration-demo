/**
 * PCM helpers. Everything on this path is PCM16 mono at the SDK's configured rate.
 */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // In chunks: String.fromCharCode with a whole buffer spread across arguments blows
  // the stack once the audio is more than a second or so long.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
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
 * Microphone capture, resampled to whatever rate the SDK was configured with.
 *
 * The browser hands over audio at the device's own rate — 44.1 or 48 kHz, not the
 * 16 kHz the pipeline wants — so it is resampled here rather than at the far end.
 */
export class MicrophoneCapture {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null

  constructor(private readonly targetSampleRate: number) {}

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
      // destination to run at all, and without this the mic is echoed to the speakers.
      event.outputBuffer.getChannelData(0).fill(0)
      const resampled = resampleMono(
        input,
        this.context?.sampleRate ?? this.targetSampleRate,
        this.targetSampleRate,
      )
      if (resampled.length) onChunk(floatToPcm16(resampled))
    }

    this.source.connect(this.processor)
    this.processor.connect(this.context.destination)
  }

  async stop(): Promise<void> {
    this.processor?.disconnect()
    this.source?.disconnect()
    // We started the capture, so we stop it — otherwise the tab's recording indicator
    // stays lit after the scene is closed.
    this.stream?.getTracks().forEach((track) => track.stop())
    await this.context?.close()
    this.processor = null
    this.source = null
    this.stream = null
    this.context = null
  }
}

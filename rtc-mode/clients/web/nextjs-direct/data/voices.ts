/**
 * The voices offered on the LiveKit path.
 *
 * These are LiveKit Inference model names, written into `TTS_MODEL` on the server. The
 * Agora path has no equivalent list: its voice belongs to the agent published in the
 * Agora console, and nothing sent from a client can change it — the config page points
 * at the console there instead.
 *
 * Grouped by the voice each model defaults to, since that is the first thing anyone
 * picking one cares about; the model name says nothing about it.
 *
 * Two samples each, in `public/`, both recorded from that model reading the same line
 * in that language. The sample follows the conversation language picked above it: a
 * model that reads English well may carry an accent into Chinese, so previewing the
 * wrong language answers a question nobody asked.
 */
export interface VoiceOption {
  /** The LiveKit Inference model name, stored as TTS_MODEL. */
  value: string
  /** Recordings of this model, under public/, keyed by language. */
  samples: { en: string; zh: string }
  voice: 'male' | 'female'
  /** Anything worth flagging about the reading, such as an unusual accent. */
  note?: 'cantonese'
}

/** Which language a preview should be played in. Matches the app's own `Lang`. */
export type VoiceLang = 'en' | 'zh'

/** Both files for one model; the Chinese one is the original, the English one `_en`. */
function samples(stem: string): { en: string; zh: string } {
  return { zh: `/voice-${stem}.wav`, en: `/voice-${stem}_en.wav` }
}

export const VOICE_OPTIONS: readonly VoiceOption[] = [
  { value: 'fishaudio/s2.1-pro', samples: samples('fishaudio_s21_pro'), voice: 'female' },
  { value: 'fishaudio/s2-pro', samples: samples('fishaudio_s2_pro'), voice: 'female' },
  {
    value: 'elevenlabs/eleven_multilingual_v2',
    samples: samples('elevenlabs_eleven_multilingual_v2'),
    voice: 'female',
  },
  { value: 'elevenlabs/eleven_v3', samples: samples('elevenlabs_eleven_v3'), voice: 'female' },
  {
    value: 'elevenlabs/eleven_flash_v2_5',
    samples: samples('elevenlabs_eleven_flash_v2_5'),
    voice: 'female',
    note: 'cantonese',
  },
  { value: 'cartesia/sonic-3', samples: samples('cartesia_sonic_3'), voice: 'male' },
  { value: 'cartesia/sonic-2', samples: samples('cartesia_sonic_2'), voice: 'male' },
  { value: 'cartesia/sonic-turbo', samples: samples('cartesia_sonic_turbo'), voice: 'male' },
  { value: 'inworld/inworld-tts-2', samples: samples('inworld_inworld_tts_2'), voice: 'male' },
  { value: 'inworld/inworld-tts-1.5', samples: samples('inworld_inworld_tts_15'), voice: 'male' },
] as const

/** What the server's own default is, so an unset TTS_MODEL still shows as selected. */
export const DEFAULT_VOICE = 'cartesia/sonic-2'

/**
 * Plays one sample at a time.
 *
 * Only one clip may be audible: clicking two voices in a row should have the second
 * displace the first, or they overlap and neither can be judged. One `<audio>` per clip
 * is kept, so a second click on the same voice starts instantly rather than buffering
 * again.
 */
export class VoicePreview {
  private current: HTMLAudioElement | null = null
  private cache = new Map<string, HTMLAudioElement>()
  /** Which voice is playing, or '' when nothing is. */
  playing = ''

  /**
   * Start a sample, or stop it if that one is already playing.
   *
   * @param lang - which language to preview in, normally the conversation language
   *   selected above the list.
   * @param onChange - called with the new `playing` value, including when a clip ends
   *   on its own, so a caller can re-render its play buttons.
   */
  toggle(option: VoiceOption, lang: VoiceLang, onChange: (playing: string) => void): void {
    const wasPlaying = this.playing === option.value
    this.stop()
    onChange('')
    // Clicking the same one again just stops it.
    if (wasPlaying) return

    const src = option.samples[lang] ?? option.samples.en
    // Keyed by file rather than by model: the same model has one recording per
    // language, and keying by model alone would replay whichever was heard first after
    // the language is switched.
    let audio = this.cache.get(src)
    if (!audio) {
      audio = new Audio(src)
      this.cache.set(src, audio)
    }
    audio.onended = () => {
      if (this.playing !== option.value) return
      this.playing = ''
      this.current = null
      onChange('')
    }
    this.current = audio
    this.playing = option.value
    onChange(option.value)
    void audio.play().catch(() => {
      // A sample that will not play — a missing file, a browser that blocks it — should
      // leave the button back at rest rather than stuck showing "stop".
      if (this.playing !== option.value) return
      this.playing = ''
      this.current = null
      onChange('')
    })
  }

  stop(): void {
    if (this.current) {
      this.current.pause()
      this.current.currentTime = 0
    }
    this.current = null
    this.playing = ''
  }
}

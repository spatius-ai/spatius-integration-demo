import { fetchConfig, saveConfig } from '../utils/rtcSession'
import { VOICE_OPTIONS, DEFAULT_VOICE, VoicePreview } from '../data/voices'

const DASH_URL = 'https://app.spatius.ai'
const LIVEKIT_URL = 'https://cloud.livekit.io'
const STORAGE_KEY = 'avatarkit-livekit-demo-config'

/** Which language the conversation runs in. */
export type Lang = 'en' | 'zh'

export interface AppConfig {
  language: Lang
  avatarId: string
}

export function createConfiguration(onReady: (config: AppConfig) => void): HTMLElement {
  let language: Lang = 'en'
  let voice = DEFAULT_VOICE
  let playing = ''
  let avatarId = ''
  let saving = false
  let error: string | null = null

  // One player for the whole page, so switching voices displaces rather than overlaps.
  const preview = new VoicePreview()

  // Which language was last picked is this browser's own business, so it stays
  // local; the credentials come from the server, which holds the one shared copy.
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const cached = JSON.parse(raw)
      if (cached.language === 'en' || cached.language === 'zh') language = cached.language
    }
  } catch { /* ignore */ }

  const root = document.createElement('div')
  root.className = 'config-view'
  root.innerHTML = `
    <div class="config-layout">
      <div class="config-container">
        <h1>AvatarKit LiveKit Demo</h1>
        <p class="config-subtitle">
          The avatar joins the call itself — audio and motion both arrive over the LiveKit
          room, and nothing streams through the server.
        </p>

        <div class="config-form">
          <div class="field">
            <label>App ID <span class="required">*</span></label>
            <input data-field="appId" placeholder="app_xxx" spellcheck="false" />
            <span class="field-hint">
              Find it on the
              <a href="${DASH_URL}" target="_blank" rel="noreferrer">Developer Platform</a>.
            </span>
          </div>

          <div class="field">
            <label>API Key <span class="required">*</span></label>
            <input data-field="apiKey" type="password" placeholder="sk-..." spellcheck="false" />
            <span class="field-hint">
              Held by the server, which the avatar uses to join the room — it never
              reaches this page in use. Entering it here is a convenience of the demo.
            </span>
          </div>

          <!--
            Recognition, synthesis and the persona are all fixed when the agent
            session is built, so this is chosen here rather than switched inside
            the room.
          -->
          <div class="field">
            <label>Conversation language</label>
            <div class="scene-toggle lang-toggle">
              <button type="button" data-lang="en"><strong>English</strong></button>
              <button type="button" data-lang="zh"><strong>中文</strong></button>
            </div>
            <span class="field-hint">
              Sets speech recognition, the voice, and the assistant's persona.
            </span>
          </div>

          <div class="field-group">
            <h2 class="group-title">LiveKit</h2>
            <p class="group-hint">
              Carries the call. Models go through LiveKit Inference, so no OpenAI or
              Deepgram account of your own is needed.
            </p>

            <div class="field">
              <label>Server URL <span class="required">*</span></label>
              <input data-field="livekitUrl" placeholder="wss://your-project.livekit.cloud" spellcheck="false" />
            </div>

            <div class="field">
              <label>API Key <span class="required">*</span></label>
              <input data-field="livekitKey" placeholder="APIxxxxxxxx" spellcheck="false" />
            </div>

            <div class="field">
              <label>API Secret <span class="required">*</span></label>
              <input data-field="livekitSecret" type="password" placeholder="Your API secret" spellcheck="false" />
              <span class="field-hint">Shown only once, at creation — copy it there and then.</span>
            </div>

            <!--
              The voice. These are LiveKit Inference model names, and each has a sample
              recorded from it — the model name says nothing about how it reads, so
              picking one blind is guesswork.

              Built once, here, from VOICE_OPTIONS; render() only ever flips classes and
              button glyphs on these rows. Rebuilding the list on each render would
              destroy the button between mousedown and mouseup, and the click would
              never fire.
            -->
            <div class="field">
              <label>Voice</label>
              <div class="voice-list">
                ${VOICE_OPTIONS.map(
                  (o) => `
                <label class="voice-option" data-voice="${o.value}">
                  <input type="radio" name="voice" value="${o.value}" />
                  <span class="voice-name">
                    ${o.value}
                    <em>${o.voice === 'male' ? 'male' : 'female'}</em>
                    ${o.note === 'cantonese' ? '<em>Cantonese</em>' : ''}
                  </span>
                  <!-- A button rather than part of the label: hearing a voice should
                       not also select it. -->
                  <button type="button" class="voice-play" data-play="${o.value}" aria-label="Preview">▶</button>
                </label>`,
                ).join('')}
              </div>
              <span class="field-hint">
                Samples play in the conversation language selected above. The accent
                comes from the voice rather than that setting, so a model that reads one
                language well may carry an accent into the other — which is what there
                is to listen for.
              </span>
            </div>
          </div>

          <div class="config-error" data-error hidden></div>

          <button class="primary init-btn" data-enter disabled>Enter the room</button>
        </div>
      </div>

      <div class="config-guides">
        <a class="config-guide" href="${DASH_URL}" target="_blank" rel="noreferrer">
          <img src="/api-key-guide.png" alt="Where to find your App ID and API Key" />
          <span class="guide-caption">App ID and API Key</span>
        </a>

        <a class="config-guide" href="${LIVEKIT_URL}" target="_blank" rel="noreferrer">
          <!-- Two steps: open Settings, then look at API keys. -->
          <div class="guide-shots">
            <img src="/livekit-guide-1.jpg" alt="LiveKit Cloud: open project settings" />
            <img src="/livekit-guide-2.jpg" alt="LiveKit Cloud: API keys" />
          </div>
          <span class="guide-caption">LiveKit URL, API Key and Secret</span>
        </a>
      </div>
    </div>
  `

  const input = (name: string) => root.querySelector<HTMLInputElement>(`[data-field="${name}"]`)!
  const enterBtn = root.querySelector<HTMLButtonElement>('[data-enter]')!
  const errorBox = root.querySelector<HTMLElement>('[data-error]')!

  function canEnter() {
    return Boolean(
      input('appId').value.trim() &&
        input('apiKey').value.trim() &&
        input('livekitUrl').value.trim() &&
        input('livekitKey').value.trim() &&
        input('livekitSecret').value.trim(),
    )
  }

  function render() {
    root.querySelectorAll<HTMLElement>('[data-lang]').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.lang === language)
    })
    root.querySelectorAll<HTMLElement>('[data-voice]').forEach((el) => {
      const selected = el.dataset.voice === voice
      el.classList.toggle('on', selected)
      const radio = el.querySelector<HTMLInputElement>('input[type="radio"]')
      if (radio) radio.checked = selected
    })
    root.querySelectorAll<HTMLElement>('[data-play]').forEach((btn) => {
      const isPlaying = btn.dataset.play === playing
      btn.textContent = isPlaying ? '■' : '▶'
      btn.setAttribute('aria-label', isPlaying ? 'Stop' : 'Preview')
    })
    enterBtn.disabled = !canEnter() || saving
    enterBtn.textContent = saving ? 'Saving…' : 'Enter the room'
    errorBox.hidden = !error
    errorBox.textContent = error ?? ''
  }

  root.querySelectorAll<HTMLElement>('[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => {
      language = btn.dataset.lang as Lang
      // Switching the conversation language switches which recording each play button
      // reaches for, so anything mid-sample is now the wrong language and is cut off.
      preview.stop()
      playing = ''
      render()
    })
  })
  root.querySelectorAll<HTMLElement>('[data-voice]').forEach((row) => {
    row.addEventListener('click', (event) => {
      // The play button lives inside this row and has its own handler; without this
      // the row would select the voice as well as previewing it.
      if ((event.target as HTMLElement).closest('[data-play]')) return
      voice = row.dataset.voice as string
      render()
    })
  })
  root.querySelectorAll<HTMLElement>('[data-play]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault()
      const option = VOICE_OPTIONS.find((o) => o.value === btn.dataset.play)
      if (!option) return
      preview.toggle(option, language, (p) => {
        playing = p
        render()
      })
    })
  })
  root.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((el) => {
    el.addEventListener('input', render)
  })

  fetchConfig()
    .then((saved) => {
      input('appId').value = saved.SPATIUS_APP_ID || ''
      input('apiKey').value = saved.SPATIUS_API_KEY || ''
      input('livekitUrl').value = saved.LIVEKIT_URL || ''
      input('livekitKey').value = saved.LIVEKIT_API_KEY || ''
      input('livekitSecret').value = saved.LIVEKIT_API_SECRET || ''
      voice = saved.TTS_MODEL || DEFAULT_VOICE
      avatarId = saved.avatarId || ''
      render()
    })
    .catch(() => {
      // A server that is down is not worth an error here — Enter reports it
      // properly if it is still down by then.
    })

  enterBtn.addEventListener('click', async () => {
    if (!canEnter() || saving) return
    saving = true
    error = null
    render()
    try {
      // Saved before entering, not after: these were typed one field at a time, and
      // a failure past this point should not mean entering them all again.
      await saveConfig({
        SPATIUS_APP_ID: input('appId').value.trim(),
        SPATIUS_API_KEY: input('apiKey').value.trim(),
        LIVEKIT_URL: input('livekitUrl').value.trim(),
        LIVEKIT_API_KEY: input('livekitKey').value.trim(),
        LIVEKIT_API_SECRET: input('livekitSecret').value.trim(),
        TTS_MODEL: voice,
      })
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ language }))
      } catch { /* ignore */ }
      // Stopped on the way out: a sample still playing would otherwise carry on over
      // the room this is about to enter.
      preview.stop()
      onReady({ language, avatarId })
    } catch (e: any) {
      error = e?.message ?? 'Could not save the configuration'
    } finally {
      saving = false
      render()
    }
  })

  render()
  return root
}

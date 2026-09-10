import { fetchConfig, saveConfig } from '../utils/rtcSession'

const DASH_URL = 'https://app.spatius.ai'
const AGORA_URL = 'https://console.agora.io'
const STORAGE_KEY = 'avatarkit-agora-demo-config'

/** Which language the conversation runs in. */
export type Lang = 'en' | 'zh'

export interface AppConfig {
  language: Lang
  avatarId: string
}

export function createConfiguration(onReady: (config: AppConfig) => void): HTMLElement {
  let language: Lang = 'en'
  let avatarId = ''
  let saving = false
  let error: string | null = null

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
        <h1>AvatarKit Agora Demo</h1>
        <p class="config-subtitle">
          The avatar joins the call itself — audio and motion both arrive over the Agora
          channel, and nothing streams through the server.
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
              Held by the server, which the avatar uses to join the channel — it never
              reaches this page in use. Entering it here is a convenience of the demo.
            </span>
          </div>

          <!--
            Recognition and the persona are fixed when the agent is started, so this is
            chosen here rather than switched inside the room.
          -->
          <div class="field">
            <label>Conversation language</label>
            <div class="scene-toggle lang-toggle">
              <button type="button" data-lang="en"><strong>English</strong></button>
              <button type="button" data-lang="zh"><strong>中文</strong></button>
            </div>
            <span class="field-hint">
              Sets speech recognition and the assistant's persona. The voice belongs to
              the agent in Agora's console.
            </span>
          </div>

          <div class="field-group">
            <h2 class="group-title">Agora</h2>
            <p class="group-hint">
              Carries the call and hosts the conversation. Recognition, the model and
              the voice are configured on the agent in Agora's console, not here.
            </p>

            <div class="field">
              <label>App ID <span class="required">*</span></label>
              <input data-field="agoraAppId" placeholder="Your Agora App ID" spellcheck="false" />
            </div>

            <div class="field">
              <label>App Certificate <span class="required">*</span></label>
              <input data-field="agoraCertificate" type="password" placeholder="Your App Certificate" spellcheck="false" />
              <span class="field-hint">
                Enable the App Certificate on the project's page — tokens cannot be
                signed without it. It is a different value from the App ID; the console
                masks it, so check what you copied.
              </span>
            </div>

            <div class="field">
              <label>Agent (pipeline) ID <span class="required">*</span></label>
              <input data-field="agoraPipelineId" placeholder="Published agent id" spellcheck="false" />
              <span class="field-hint">
                Create an agent under Conversational AI → Agents, set its prompt and
                models, publish it, and paste its id here. Leave its speech recognition
                at the console defaults — the server sends that same setup with every
                session.
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

        <!--
          Four steps, in the same order as the three fields on the left: pick the
          project under Projects -> take the App ID and certificate -> find the agent
          under Agents -> publish it and take the pipeline id.

          Four wrap into two rows on their own: .guide-shots is a wrapping flex row
          with a 460px basis, so a quarter-width column — at which the console's own
          labels stop being readable — never happens.
        -->
        <a class="config-guide" href="${AGORA_URL}" target="_blank" rel="noreferrer">
          <div class="guide-shots">
            <img src="/agora-guide-1.jpg" alt="Agora Console: pick a project" />
            <img src="/agora-guide-2.jpg" alt="Agora Console: App ID and certificate" />
            <img src="/agora-guide-3.jpg" alt="Agora Console: find the agent" />
            <img src="/agora-guide-4.jpg" alt="Agora Console: publish it and copy the id" />
          </div>
          <span class="guide-caption">App ID, App Certificate and the agent (pipeline) id</span>
        </a>

        <!--
          The voice and the sample rate, both on the agent's Models tab. Neither can be
          set from this page: the voice belongs to the published agent, and the sample
          rate has to match whatever that agent's TTS emits.
        -->
        <a class="config-guide" href="${AGORA_URL}" target="_blank" rel="noreferrer">
          <div class="guide-shots">
            <img src="/agora-voice-guide.jpg" alt="Agora Console: the agent's voice" />
            <img src="/agora-guide-5.jpg" alt="Agora Console: the TTS sample rate" />
          </div>
          <span class="guide-caption">
            The voice lives on the agent — Agents -> Models -> TTS. Its sample rate must
            equal <code>AGORA_AVATAR_SAMPLE_RATE</code> in the server's
            <code>.env</code>: the avatar does not resample, and a mismatch is silent.
          </span>
        </a>

        <a class="config-guide" href="${AGORA_URL}" target="_blank" rel="noreferrer">
          <img src="/agora-asr-guide.jpg" alt="Agora Console: the speech recognition settings" />
          <span class="guide-caption">
            Leave the recognition vendor and model at the console defaults (Deepgram
            nova-3); they must match <code>ASR_VENDOR</code> / <code>ASR_MODEL</code>
            in the server's <code>agora.py</code>.
          </span>
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
        input('agoraAppId').value.trim() &&
        input('agoraCertificate').value.trim() &&
        input('agoraPipelineId').value.trim(),
    )
  }

  function render() {
    root.querySelectorAll<HTMLElement>('[data-lang]').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.lang === language)
    })
    enterBtn.disabled = !canEnter() || saving
    enterBtn.textContent = saving ? 'Saving…' : 'Enter the room'
    errorBox.hidden = !error
    errorBox.textContent = error ?? ''
  }

  root.querySelectorAll<HTMLElement>('[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => {
      language = btn.dataset.lang as Lang
      render()
    })
  })
  root.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((el) => {
    el.addEventListener('input', render)
  })

  fetchConfig()
    .then((saved) => {
      input('appId').value = saved.SPATIUS_APP_ID || ''
      input('apiKey').value = saved.SPATIUS_API_KEY || ''
      input('agoraAppId').value = saved.AGORA_APP_ID || ''
      input('agoraCertificate').value = saved.AGORA_APP_CERTIFICATE || ''
      input('agoraPipelineId').value = saved.AGORA_PIPELINE_ID || ''
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
        AGORA_APP_ID: input('agoraAppId').value.trim(),
        AGORA_APP_CERTIFICATE: input('agoraCertificate').value.trim(),
        AGORA_PIPELINE_ID: input('agoraPipelineId').value.trim(),
      })
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ language }))
      } catch { /* ignore */ }
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

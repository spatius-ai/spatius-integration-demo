import { fetchConfig, saveConfig, type Transport } from '../utils/rtcSession'
import { VOICE_OPTIONS, DEFAULT_VOICE, VoicePreview } from '../data/voices'

const DASH_URL = 'https://app.spatius.ai'
const LIVEKIT_URL = 'https://cloud.livekit.io'
const AGORA_URL = 'https://console.agora.io'
const STORAGE_KEY = 'avatarkit-rtc-config'

/** Which language the conversation runs in. */
export type Lang = 'en' | 'zh'

export interface AppConfig {
  language: Lang
  avatarId: string
}

export function createConfiguration(onReady: (config: AppConfig) => void): HTMLElement {
  let language: Lang = 'en'
  let transport: Transport = 'livekit'
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
        <h1>AvatarKit RTC Mode Demo</h1>
        <p class="config-subtitle">
          The avatar joins the call itself — audio and motion both arrive over RTC,
          and nothing streams through the server.
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
            Which RTC stack carries the call. The room behaves identically either
            way — same avatar, same conversation — and only the credentials below
            change with it.
          -->
          <div class="field">
            <label>Transport</label>
            <div class="scene-toggle">
              <button type="button" data-transport="livekit">
                <strong>LiveKit</strong><span>Runs on your machine</span>
              </button>
              <button type="button" data-transport="agora">
                <strong>Agora</strong><span>Hosted by ConvoAI</span>
              </button>
            </div>
            <span class="field-hint">
              LiveKit runs the conversation here and routes models through LiveKit
              Inference. Agora's Conversational AI Engine hosts it instead, with the
              models and voice configured in its console.
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

          <!--
            Both groups are in the DOM from the start and one is hidden, rather than
            being built and torn down as the transport changes: what is typed into the
            other set survives a switch, and nothing here is ever re-rendered.
          -->
          <div class="field-group" data-group="livekit">
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
              The voice, which only this path can choose: on Agora it belongs to the
              agent published in the console. These are LiveKit Inference model names,
              and each has a sample recorded from it — the model name says nothing about
              how it reads, so picking one blind is guesswork.

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

          <div class="field-group" data-group="agora" hidden>
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
                signed without it.
              </span>
            </div>

            <div class="field">
              <label>Agent (pipeline) ID <span class="required">*</span></label>
              <input data-field="agoraPipelineId" placeholder="Published agent id" spellcheck="false" />
              <span class="field-hint">
                Create an agent under Conversational AI → Agents, set its prompt and
                models, publish it, and paste its id here. Note that the speech
                recognition credential ids are hard-coded in the server's
                <code>agora.py</code> — running against your own agent means replacing
                them.
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

        <!-- The guide follows the transport, so it never points at a console the
             fields above do not belong to. -->
        <a class="config-guide" data-guide="livekit" href="${LIVEKIT_URL}" target="_blank" rel="noreferrer">
          <!-- Two steps: open Settings, then look at API keys. -->
          <div class="guide-shots">
            <img src="/livekit-guide-1.jpg" alt="LiveKit Cloud: open project settings" />
            <img src="/livekit-guide-2.jpg" alt="LiveKit Cloud: API keys" />
          </div>
          <span class="guide-caption">LiveKit URL, API Key and Secret</span>
        </a>

        <!--
          Four steps, in the same order as the three fields on the left: pick the
          project under Projects -> take the App ID and certificate -> find the agent
          under Agents -> publish it and take the pipeline id.

          Four wrap into two rows on their own: .guide-shots is a wrapping flex row
          with a 460px basis, so a quarter-width column — at which the console's own
          labels stop being readable — never happens.
        -->
        <a class="config-guide" data-guide="agora" href="${AGORA_URL}" target="_blank" rel="noreferrer" hidden>
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
        <a class="config-guide" data-guide="agora" href="${AGORA_URL}" target="_blank" rel="noreferrer" hidden>
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

        <a class="config-guide" data-guide="agora" href="${AGORA_URL}" target="_blank" rel="noreferrer" hidden>
          <img src="/agora-asr-guide.jpg" alt="Agora Console: the speech recognition credential" />
          <span class="guide-caption">
            The recognition vendor, model and credential id must match the ones
            hard-coded in the server's <code>agora.py</code>.
          </span>
        </a>
      </div>
    </div>
  `

  const input = (name: string) => root.querySelector<HTMLInputElement>(`[data-field="${name}"]`)!
  const enterBtn = root.querySelector<HTMLButtonElement>('[data-enter]')!
  const errorBox = root.querySelector<HTMLElement>('[data-error]')!

  function canEnter() {
    // Only the chosen transport's credentials are required: the other's are
    // irrelevant to this session, and demanding both would mean signing up with two
    // vendors to run a demo that uses one.
    const transportReady =
      transport === 'agora'
        ? Boolean(
            input('agoraAppId').value.trim() &&
              input('agoraCertificate').value.trim() &&
              input('agoraPipelineId').value.trim(),
          )
        : Boolean(
            input('livekitUrl').value.trim() &&
              input('livekitKey').value.trim() &&
              input('livekitSecret').value.trim(),
          )
    return Boolean(input('appId').value.trim() && input('apiKey').value.trim()) && transportReady
  }

  function render() {
    root.querySelectorAll<HTMLElement>('[data-lang]').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.lang === language)
    })
    root.querySelectorAll<HTMLElement>('[data-transport]').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.transport === transport)
    })
    root.querySelectorAll<HTMLElement>('[data-group]').forEach((el) => {
      el.hidden = el.dataset.group !== transport
    })
    root.querySelectorAll<HTMLElement>('[data-guide]').forEach((el) => {
      el.hidden = el.dataset.guide !== transport
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
  root.querySelectorAll<HTMLElement>('[data-transport]').forEach((btn) => {
    btn.addEventListener('click', () => {
      transport = btn.dataset.transport as Transport
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
      if (saved.TRANSPORT === 'agora' || saved.TRANSPORT === 'livekit') {
        transport = saved.TRANSPORT
      }
      input('appId').value = saved.SPATIUS_APP_ID || ''
      input('apiKey').value = saved.SPATIUS_API_KEY || ''
      input('livekitUrl').value = saved.LIVEKIT_URL || ''
      input('livekitKey').value = saved.LIVEKIT_API_KEY || ''
      input('livekitSecret').value = saved.LIVEKIT_API_SECRET || ''
      input('agoraAppId').value = saved.AGORA_APP_ID || ''
      input('agoraCertificate').value = saved.AGORA_APP_CERTIFICATE || ''
      input('agoraPipelineId').value = saved.AGORA_PIPELINE_ID || ''
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
      //
      // Both transports' fields go up regardless of which is selected: a blank one is
      // ignored server-side, and sending the lot means switching back later finds the
      // other set still filled in.
      await saveConfig({
        TRANSPORT: transport,
        SPATIUS_APP_ID: input('appId').value.trim(),
        SPATIUS_API_KEY: input('apiKey').value.trim(),
        LIVEKIT_URL: input('livekitUrl').value.trim(),
        LIVEKIT_API_KEY: input('livekitKey').value.trim(),
        LIVEKIT_API_SECRET: input('livekitSecret').value.trim(),
        TTS_MODEL: voice,
        AGORA_APP_ID: input('agoraAppId').value.trim(),
        AGORA_APP_CERTIFICATE: input('agoraCertificate').value.trim(),
        AGORA_PIPELINE_ID: input('agoraPipelineId').value.trim(),
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

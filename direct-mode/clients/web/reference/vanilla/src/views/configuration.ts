import { AvatarSDK, DrivingServiceMode, LogLevel } from '@spatius/avatarkit'
import { fetchConfig, fetchSessionToken, saveConfig } from '@direct-core'

const DASH_URL = 'https://app.spatius.ai'
const LIVEKIT_URL = 'https://cloud.livekit.io'
const STORAGE_KEY = 'avatarkit-playground-config'

/**
 * Which scene the playground opens in. Both drive the avatar through the same
 * `controller.send()` — they differ only in where the audio comes from.
 */
export type Scene = 'sample' | 'realtime'

/** Which language the realtime conversation runs in. */
export type Lang = 'en' | 'zh'

export interface AppConfig {
  appId: string
  sessionToken: string
  region: string
  scene: Scene
  /**
   * Recognition, synthesis and the agent's persona all follow this, and all three
   * are fixed when the agent session is built — which is why it is chosen here
   * rather than switched inside the scene.
   */
  language: Lang
  /** Only the realtime scene reaches an agent, so this is absent for the other. */
  livekit?: {
    url: string
    apiKey: string
    apiSecret: string
  }
}

interface CachedConfig {
  appId?: string
  language?: Lang
  apiKey?: string
  env?: string
  scene?: Scene
  livekitUrl?: string
  livekitKey?: string
  livekitSecret?: string
}

function loadCached(): CachedConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as CachedConfig
  } catch { /* ignore */ }
  return {}
}

function saveCache(config: CachedConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch { /* ignore */ }
}

const REGIONS = ['auto', 'us-west', 'cn-beijing'] as const

// 'auto' lets the SDK pick the closest serving region at initialize time.
function normalizeRegion(env?: string) {
  return REGIONS.includes(env as typeof REGIONS[number]) ? env! : 'auto'
}

export function createConfiguration(
  mode: DrivingServiceMode,
  onInitialized: (config: AppConfig) => void,
): HTMLElement {
  const cached = loadCached()

  // Which scene was last open is this browser's own business, so it stays local.
  let scene: Scene = cached.scene ?? 'sample'
  let language: Lang = cached.language ?? 'en'
  let loading = false
  let error: string | null = null

  const root = document.createElement('div')
  root.className = 'config-view'
  root.innerHTML = `
    <div class="config-layout">
      <div class="config-container">
        <h1>AvatarKit Direct Mode Demo</h1>
        <p class="config-subtitle">
          The client drives the avatar directly. Pick where its audio comes from.
        </p>

        <div class="config-form">
          <!--
            The scene goes first: it decides which fields follow. Asking for
            credentials before knowing which are needed would show LiveKit's three
            to everyone, most of whom never open the realtime scene.
          -->
          <div class="field">
            <label>Scene</label>
            <div class="scene-toggle">
              <button type="button" data-scene="sample">
                <strong>Pre-recorded audio</strong>
                <span>Play a bundled clip</span>
              </button>
              <button type="button" data-scene="realtime">
                <strong>Realtime audio</strong>
                <span>Talk to the avatar</span>
              </button>
            </div>
          </div>

          <div class="field">
            <label>App ID <span class="required">*</span></label>
            <input data-field="appId" placeholder="app_xxx" spellcheck="false" />
            <span class="field-hint">
              Passed to <code>AvatarSDK.initialize()</code>. Find it on the
              <a href="${DASH_URL}" target="_blank" rel="noreferrer">Developer Platform</a>.
            </span>
          </div>

          <!--
            The API Key, not a Session Token: the server exchanges it for one on
            every connect, so a token that expired while the page sat open renews
            itself instead of having to be pasted again.
          -->
          <div class="field">
            <label>API Key <span class="required">*</span></label>
            <input data-field="apiKey" type="password" placeholder="sk-..." spellcheck="false" />
            <span class="field-hint">
              The server exchanges it for a short-lived Session Token — in your own
              app, keep it server-side rather than entering it here.
            </span>
          </div>

          <div class="field">
            <label>Region</label>
            <select data-field="env">
              ${REGIONS.map(r => `<option value="${r}">${r}</option>`).join('')}
            </select>
          </div>

          <!--
            Only the realtime scene reaches an agent, so these appear with it rather
            than sitting empty and required-looking for everyone else.

            Chosen here rather than inside the scene: recognition, synthesis and
            the persona are all fixed when the agent session is built, so this is
            not something that can be switched on a running conversation.
          -->
          <div class="field" data-realtime-only>
            <label>Conversation language</label>
            <div class="scene-toggle lang-toggle">
              <button type="button" data-lang="en"><strong>English</strong></button>
              <button type="button" data-lang="zh"><strong>中文</strong></button>
            </div>
            <span class="field-hint">
              Sets speech recognition, the voice, and the assistant's persona.
            </span>
          </div>

          <div class="field-group" data-realtime-only>
            <h2 class="group-title">LiveKit</h2>
            <p class="group-hint">
              Runs the conversation. Models go through LiveKit Inference, so no
              OpenAI or Deepgram account of your own is needed.
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
          </div>

          <div class="config-error" data-error hidden></div>

          <button class="primary init-btn" data-init disabled>Initialize SDK</button>
        </div>
      </div>

      <!--
        One guide per credential set, stacked in the order the fields are asked for.
        The Spatius one is always there; LiveKit's is added by the realtime scene
        rather than replacing it, since that scene needs both.
      -->
      <div class="config-guides">
        <a class="config-guide" href="${DASH_URL}" target="_blank" rel="noreferrer">
          <img src="/api-key-guide.png" alt="Where to find your App ID and Token" />
          <span class="guide-caption">App ID and Session Token</span>
        </a>

        <a class="config-guide" data-realtime-only href="${LIVEKIT_URL}" target="_blank" rel="noreferrer">
          <div class="guide-shots">
            <img src="/livekit-guide-1.jpg" alt="LiveKit Cloud: open project settings" />
            <img src="/livekit-guide-2.jpg" alt="LiveKit Cloud: API keys" />
          </div>
          <span class="guide-caption">LiveKit URL, API Key and Secret</span>
        </a>
      </div>
    </div>
  `

  const input = (name: string) =>
    root.querySelector<HTMLInputElement>(`[data-field="${name}"]`)!
  const select = root.querySelector<HTMLSelectElement>('[data-field="env"]')!
  const initBtn = root.querySelector<HTMLButtonElement>('[data-init]')!
  const errorBox = root.querySelector<HTMLElement>('[data-error]')!

  select.value = normalizeRegion(cached.env)

  function isRealtime() {
    return scene === 'realtime'
  }

  // The realtime scene needs an agent to answer with, so LiveKit's three come on
  // top of the API Key. The sample scene plays a bundled clip and needs none.
  function canInit() {
    const base = input('appId').value.trim() && input('apiKey').value.trim()
    if (!base) return false
    if (!isRealtime()) return true
    return Boolean(
      input('livekitUrl').value.trim() &&
      input('livekitKey').value.trim() &&
      input('livekitSecret').value.trim(),
    )
  }

  function render() {
    root.querySelectorAll<HTMLElement>('[data-scene]').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.scene === scene)
    })
    root.querySelectorAll<HTMLElement>('[data-lang]').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.lang === language)
    })
    root.querySelectorAll<HTMLElement>('[data-realtime-only]').forEach((el) => {
      el.hidden = !isRealtime()
    })
    initBtn.disabled = !canInit() || loading
    initBtn.textContent = loading ? 'Initializing...' : 'Initialize SDK'
    errorBox.hidden = !error
    errorBox.textContent = error ?? ''
  }

  root.querySelectorAll<HTMLElement>('[data-scene]').forEach((btn) => {
    btn.addEventListener('click', () => {
      scene = btn.dataset.scene as Scene
      render()
    })
  })
  root.querySelectorAll<HTMLElement>('[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => {
      language = btn.dataset.lang as Lang
      render()
    })
  })
  root.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((el) => {
    el.addEventListener('input', render)
  })

  // Credentials come from the server, which holds the one shared copy — saved
  // from any client, including a phone that has no .env to edit. localStorage
  // only fills in what the server has not got.
  fetchConfig()
    .then((saved) => {
      input('appId').value = saved.SPATIUS_APP_ID || cached.appId || ''
      input('apiKey').value = saved.SPATIUS_API_KEY || cached.apiKey || ''
      input('livekitUrl').value = saved.LIVEKIT_URL || cached.livekitUrl || ''
      input('livekitKey').value = saved.LIVEKIT_API_KEY || cached.livekitKey || ''
      input('livekitSecret').value = saved.LIVEKIT_API_SECRET || cached.livekitSecret || ''
      if (saved.SPATIUS_REGION) select.value = normalizeRegion(saved.SPATIUS_REGION)
      render()
    })
    .catch(() => {
      // The server being down is not worth an error here — the fields still work,
      // and Initialize reports it properly if it is still down by then.
      input('appId').value = cached.appId || ''
      input('apiKey').value = cached.apiKey || ''
      input('livekitUrl').value = cached.livekitUrl || ''
      input('livekitKey').value = cached.livekitKey || ''
      input('livekitSecret').value = cached.livekitSecret || ''
      render()
    })

  initBtn.addEventListener('click', async () => {
    if (!canInit() || loading) return
    loading = true
    error = null
    render()

    const appId = input('appId').value.trim()
    const apiKey = input('apiKey').value.trim()
    const env = select.value
    const livekitUrl = input('livekitUrl').value.trim()
    const livekitKey = input('livekitKey').value.trim()
    const livekitSecret = input('livekitSecret').value.trim()

    try {
      // Save before connecting, not after: these were typed one field at a time,
      // and a failure past this point should not mean entering them all again.
      // A failed save is not worth blocking on — it only costs the prefill.
      await saveConfig({
        SPATIUS_APP_ID: appId,
        SPATIUS_API_KEY: apiKey,
        SPATIUS_REGION: env === 'auto' ? '' : env,
        ...(isRealtime()
          ? {
              LIVEKIT_URL: livekitUrl,
              LIVEKIT_API_KEY: livekitKey,
              LIVEKIT_API_SECRET: livekitSecret,
            }
          : {}),
      }).catch((e) => console.warn('[config] save failed', e))

      // Minted server-side, so the API Key is not held in the browser beyond this
      // exchange — and an expired token renews on the next connect.
      const session = await fetchSessionToken(apiKey)

      await AvatarSDK.initialize(appId, {
        // Omitting region entirely is what triggers the SDK's automatic pick.
        ...(env === 'auto' ? {} : { region: env }),
        drivingServiceMode: mode,
        audioFormat: { channelCount: 1, sampleRate: 16000 },
        logLevel: LogLevel.all,
      })
      AvatarSDK.setSessionToken(session.sessionToken)
      saveCache({ appId, apiKey, env, scene, language, livekitUrl, livekitKey, livekitSecret })
      onInitialized({
        appId,
        sessionToken: session.sessionToken,
        region: env,
        scene,
        language,
        livekit: isRealtime()
          ? { url: livekitUrl, apiKey: livekitKey, apiSecret: livekitSecret }
          : undefined,
      })
    } catch (e: any) {
      error = e.message || 'Initialization failed'
    } finally {
      loading = false
      render()
    }
  })

  render()
  return root
}

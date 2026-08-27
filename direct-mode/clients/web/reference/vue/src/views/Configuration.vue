<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { AvatarSDK, DrivingServiceMode, LogLevel } from '@spatius/avatarkit'
import { fetchConfig, fetchSessionToken, saveConfig } from '@direct-core'
import type { AppConfig, Lang, Scene } from '../App.vue'

const DASH_URL = 'https://app.spatius.ai'
const LIVEKIT_URL = 'https://cloud.livekit.io'

const props = defineProps<{ mode: DrivingServiceMode }>()
const emit = defineEmits<{ initialized: [config: AppConfig] }>()

const STORAGE_KEY = 'avatarkit-playground-config'

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

const appId = ref('')
const apiKey = ref('')
const env = ref<string>('auto')

// Which scene to open. Both drive the avatar the same way — the difference is
// where the audio comes from, and the realtime one needs an agent to produce it.
const scene = ref<Scene>('sample')
const language = ref<Lang>('en')
const livekitUrl = ref('')
const livekitKey = ref('')
const livekitSecret = ref('')

const loading = ref(false)
const error = ref<string | null>(null)

let cancelled = false

onMounted(() => {
  // Which scene was last open is this browser's own business, so it stays local.
  const cached = loadCached()
  if (cached.scene) scene.value = cached.scene
  if (cached.language) language.value = cached.language
  env.value = normalizeRegion(cached.env)

  // Credentials come from the server, which holds the one shared copy — saved
  // from any client, including a phone that has no .env to edit. localStorage
  // only fills in what the server has not got.
  fetchConfig()
    .then((saved) => {
      if (cancelled) return
      appId.value = saved.SPATIUS_APP_ID || cached.appId || ''
      apiKey.value = saved.SPATIUS_API_KEY || cached.apiKey || ''
      livekitUrl.value = saved.LIVEKIT_URL || cached.livekitUrl || ''
      livekitKey.value = saved.LIVEKIT_API_KEY || cached.livekitKey || ''
      livekitSecret.value = saved.LIVEKIT_API_SECRET || cached.livekitSecret || ''
      if (saved.SPATIUS_REGION) env.value = normalizeRegion(saved.SPATIUS_REGION)
    })
    .catch(() => {
      // The server being down is not worth an error here — the fields still work,
      // and Initialize reports it properly if it is still down by then.
      if (cancelled) return
      appId.value = cached.appId || ''
      apiKey.value = cached.apiKey || ''
      livekitUrl.value = cached.livekitUrl || ''
      livekitKey.value = cached.livekitKey || ''
      livekitSecret.value = cached.livekitSecret || ''
    })
})

onUnmounted(() => {
  cancelled = true
})

const isRealtime = computed(() => scene.value === 'realtime')

// The realtime scene needs an agent to answer with, so LiveKit's three come on
// top of the API Key. The sample scene plays a bundled clip and needs none.
const canInit = computed(
  () =>
    Boolean(appId.value.trim() && apiKey.value.trim()) &&
    (!isRealtime.value ||
      Boolean(livekitUrl.value.trim() && livekitKey.value.trim() && livekitSecret.value.trim())),
)

async function handleInit() {
  if (!canInit.value) return
  loading.value = true
  error.value = null
  try {
    // Save before connecting, not after: these were typed one field at a time,
    // and a failure past this point should not mean entering them all again.
    // A failed save is not worth blocking on — it only costs the prefill.
    await saveConfig({
      SPATIUS_APP_ID: appId.value.trim(),
      SPATIUS_API_KEY: apiKey.value.trim(),
      SPATIUS_REGION: env.value === 'auto' ? '' : env.value,
      ...(isRealtime.value
        ? {
            LIVEKIT_URL: livekitUrl.value.trim(),
            LIVEKIT_API_KEY: livekitKey.value.trim(),
            LIVEKIT_API_SECRET: livekitSecret.value.trim(),
          }
        : {}),
    }).catch((e) => console.warn('[config] save failed', e))

    // Minted server-side, so the API Key is not held in the browser beyond this
    // exchange — and an expired token renews on the next connect.
    const session = await fetchSessionToken(apiKey.value.trim())

    await AvatarSDK.initialize(appId.value.trim(), {
      // Omitting region entirely is what triggers the SDK's automatic pick.
      ...(env.value === 'auto' ? {} : { region: env.value }),
      drivingServiceMode: props.mode,
      audioFormat: { channelCount: 1, sampleRate: 16000 },
      logLevel: LogLevel.all,
    })
    AvatarSDK.setSessionToken(session.sessionToken)
    saveCache({
      appId: appId.value.trim(),
      apiKey: apiKey.value.trim(),
      env: env.value,
      scene: scene.value,
      language: language.value,
      livekitUrl: livekitUrl.value.trim(),
      livekitKey: livekitKey.value.trim(),
      livekitSecret: livekitSecret.value.trim(),
    })
    emit('initialized', {
      appId: appId.value.trim(),
      sessionToken: session.sessionToken,
      region: env.value,
      scene: scene.value,
      language: language.value,
      livekit: isRealtime.value
        ? {
            url: livekitUrl.value.trim(),
            apiKey: livekitKey.value.trim(),
            apiSecret: livekitSecret.value.trim(),
          }
        : undefined,
    })
  } catch (e: any) {
    error.value = e.message || 'Initialization failed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="config-view">
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
              <button type="button" :class="!isRealtime ? 'on' : ''" @click="scene = 'sample'">
                <strong>Pre-recorded audio</strong>
                <span>Play a bundled clip</span>
              </button>
              <button type="button" :class="isRealtime ? 'on' : ''" @click="scene = 'realtime'">
                <strong>Realtime audio</strong>
                <span>Talk to the avatar</span>
              </button>
            </div>
          </div>

          <div class="field">
            <label>App ID <span class="required">*</span></label>
            <input v-model="appId" placeholder="app_xxx" spellcheck="false" />
            <span class="field-hint">
              Passed to <code>AvatarSDK.initialize()</code>. Find it on the
              <a :href="DASH_URL" target="_blank" rel="noreferrer">Developer Platform</a>.
            </span>
          </div>

          <!--
            The API Key, not a Session Token: the server exchanges it for one on
            every connect, so a token that expired while the page sat open renews
            itself instead of having to be pasted again.
          -->
          <div class="field">
            <label>API Key <span class="required">*</span></label>
            <input v-model="apiKey" type="password" placeholder="sk-..." spellcheck="false" />
            <span class="field-hint">
              The server exchanges it for a short-lived Session Token — in your own
              app, keep it server-side rather than entering it here.
            </span>
          </div>

          <div class="field">
            <label>Region</label>
            <select v-model="env">
              <option v-for="r in REGIONS" :key="r" :value="r">{{ r }}</option>
            </select>
          </div>

          <!--
            Only the realtime scene reaches an agent, so these appear with it rather
            than sitting empty and required-looking for everyone else.

            Chosen here rather than inside the scene: recognition, synthesis and
            the persona are all fixed when the agent session is built, so this is
            not something that can be switched on a running conversation. Get it
            wrong and speech is transcribed as the other language — the avatar
            then answers something nobody said.
          -->
          <div class="field" v-if="isRealtime">
            <label>Conversation language</label>
            <div class="scene-toggle lang-toggle">
              <button type="button" :class="language === 'en' ? 'on' : ''" @click="language = 'en'">
                <strong>English</strong>
              </button>
              <button type="button" :class="language === 'zh' ? 'on' : ''" @click="language = 'zh'">
                <strong>中文</strong>
              </button>
            </div>
            <span class="field-hint">
              Sets speech recognition, the voice, and the assistant's persona.
            </span>
          </div>

          <div class="field-group" v-if="isRealtime">
            <h2 class="group-title">LiveKit</h2>
            <p class="group-hint">
              Runs the conversation. Models go through LiveKit Inference, so no
              OpenAI or Deepgram account of your own is needed.
            </p>

            <div class="field">
              <label>Server URL <span class="required">*</span></label>
              <input
                v-model="livekitUrl"
                placeholder="wss://your-project.livekit.cloud"
                spellcheck="false"
              />
            </div>

            <div class="field">
              <label>API Key <span class="required">*</span></label>
              <input v-model="livekitKey" placeholder="APIxxxxxxxx" spellcheck="false" />
            </div>

            <div class="field">
              <label>API Secret <span class="required">*</span></label>
              <input
                v-model="livekitSecret"
                type="password"
                placeholder="Your API secret"
                spellcheck="false"
              />
              <span class="field-hint">
                Shown only once, at creation — copy it there and then.
              </span>
            </div>
          </div>

          <div class="config-error" v-if="error">{{ error }}</div>

          <button class="primary init-btn" :disabled="!canInit || loading" @click="handleInit">
            {{ loading ? 'Initializing...' : 'Initialize SDK' }}
          </button>
        </div>
      </div>

      <!--
        One guide per credential set, stacked in the order the fields are asked for.
        The Spatius one is always there; LiveKit's is added by the realtime scene
        rather than replacing it, since that scene needs both.
      -->
      <div class="config-guides">
        <a class="config-guide" :href="DASH_URL" target="_blank" rel="noreferrer">
          <img src="/api-key-guide.png" alt="Where to find your App ID and Token" />
          <span class="guide-caption">App ID and Session Token</span>
        </a>

        <a
          class="config-guide"
          v-if="isRealtime"
          :href="LIVEKIT_URL"
          target="_blank"
          rel="noreferrer"
        >
          <!-- Two steps: open Settings, then look at API keys. -->
          <div class="guide-shots">
            <img src="/livekit-guide-1.jpg" alt="LiveKit Cloud: open project settings" />
            <img src="/livekit-guide-2.jpg" alt="LiveKit Cloud: API keys" />
          </div>
          <span class="guide-caption">LiveKit URL, API Key and Secret</span>
        </a>
      </div>
    </div>
  </div>
</template>

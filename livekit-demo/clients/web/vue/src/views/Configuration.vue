<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { fetchConfig, saveConfig } from '../utils/rtcSession'
import { VOICE_OPTIONS, DEFAULT_VOICE, VoicePreview } from '../data/voices'
import type { AppConfig, Lang } from '../App.vue'

const DASH_URL = 'https://app.spatius.ai'
const LIVEKIT_URL = 'https://cloud.livekit.io'
const STORAGE_KEY = 'avatarkit-livekit-demo-config'

const emit = defineEmits<{ ready: [config: AppConfig] }>()

const appId = ref('')
const apiKey = ref('')
const livekitUrl = ref('')
const livekitKey = ref('')
const livekitSecret = ref('')
const voice = ref(DEFAULT_VOICE)
const playing = ref('')
const language = ref<Lang>('en')
const avatarId = ref('')
const saving = ref(false)
const error = ref<string | null>(null)

// One player for the whole page, so switching voices displaces rather than overlaps.
// Not a ref: it holds an <audio> cache that Vue's deep proxy has no business wrapping.
const preview = new VoicePreview()

// Switching the conversation language switches which recording each play button reaches
// for, so anything mid-sample is now the wrong language and is cut off.
watch(language, () => {
  preview.stop()
  playing.value = ''
})

let cancelled = false

onMounted(() => {
  // Which language was last picked is this browser's own business, so it stays
  // local; the credentials come from the server, which holds the one shared copy.
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const cached = JSON.parse(raw)
      if (cached.language === 'en' || cached.language === 'zh') language.value = cached.language
    }
  } catch { /* ignore */ }

  fetchConfig()
    .then((saved) => {
      if (cancelled) return
      appId.value = saved.SPATIUS_APP_ID || ''
      apiKey.value = saved.SPATIUS_API_KEY || ''
      livekitUrl.value = saved.LIVEKIT_URL || ''
      livekitKey.value = saved.LIVEKIT_API_KEY || ''
      livekitSecret.value = saved.LIVEKIT_API_SECRET || ''
      voice.value = saved.TTS_MODEL || DEFAULT_VOICE
      avatarId.value = saved.avatarId || ''
    })
    .catch(() => {
      // A server that is down is not worth an error here — Enter reports it
      // properly if it is still down by then.
    })
})

onUnmounted(() => {
  cancelled = true
  // Stopped on the way out: leaving the page mid-sample would otherwise keep playing
  // over the room it just entered.
  preview.stop()
})

const canEnter = computed(() =>
  Boolean(
    appId.value.trim() &&
      apiKey.value.trim() &&
      livekitUrl.value.trim() &&
      livekitKey.value.trim() &&
      livekitSecret.value.trim(),
  ),
)

async function handleEnter() {
  if (!canEnter.value) return
  saving.value = true
  error.value = null
  try {
    // Saved before entering, not after: these were typed one field at a time, and
    // a failure past this point should not mean entering them all again.
    await saveConfig({
      SPATIUS_APP_ID: appId.value.trim(),
      SPATIUS_API_KEY: apiKey.value.trim(),
      LIVEKIT_URL: livekitUrl.value.trim(),
      LIVEKIT_API_KEY: livekitKey.value.trim(),
      LIVEKIT_API_SECRET: livekitSecret.value.trim(),
      TTS_MODEL: voice.value,
    })
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ language: language.value }))
    } catch { /* ignore */ }
    emit('ready', { language: language.value, avatarId: avatarId.value })
  } catch (e: any) {
    error.value = e?.message ?? 'Could not save the configuration'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="config-view">
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
            <input v-model="appId" placeholder="app_xxx" spellcheck="false" />
            <span class="field-hint">
              Find it on the
              <a :href="DASH_URL" target="_blank" rel="noreferrer">Developer Platform</a>.
            </span>
          </div>

          <div class="field">
            <label>API Key <span class="required">*</span></label>
            <input v-model="apiKey" type="password" placeholder="sk-..." spellcheck="false" />
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

          <div class="field-group">
            <h2 class="group-title">LiveKit</h2>
            <p class="group-hint">
              Carries the call. Models go through LiveKit Inference, so no OpenAI or
              Deepgram account of your own is needed.
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

            <!--
              The voice. These are LiveKit Inference model names, and each has a sample
              recorded from it — the model name says nothing about how it reads, so
              picking one blind is guesswork.
            -->
            <div class="field">
              <label>Voice</label>
              <div class="voice-list">
                <label
                  v-for="option in VOICE_OPTIONS"
                  :key="option.value"
                  class="voice-option"
                  :class="voice === option.value ? 'on' : ''"
                >
                  <input v-model="voice" type="radio" name="voice" :value="option.value" />
                  <span class="voice-name">
                    {{ option.value }}
                    <em>{{ option.voice === 'male' ? 'male' : 'female' }}</em>
                    <em v-if="option.note === 'cantonese'">Cantonese</em>
                  </span>
                  <!-- A button rather than part of the label: hearing a voice should
                       not also select it. -->
                  <button
                    type="button"
                    class="voice-play"
                    :aria-label="playing === option.value ? 'Stop' : 'Preview'"
                    @click.prevent="preview.toggle(option, language, (p) => (playing = p))"
                  >
                    {{ playing === option.value ? '■' : '▶' }}
                  </button>
                </label>
              </div>
              <span class="field-hint">
                Samples play in the conversation language selected above. The accent
                comes from the voice rather than that setting, so a model that reads one
                language well may carry an accent into the other — which is what there is
                to listen for.
              </span>
            </div>
          </div>

          <div class="config-error" v-if="error">{{ error }}</div>

          <button class="primary init-btn" :disabled="!canEnter || saving" @click="handleEnter">
            {{ saving ? 'Saving…' : 'Enter the room' }}
          </button>
        </div>
      </div>

      <div class="config-guides">
        <a class="config-guide" :href="DASH_URL" target="_blank" rel="noreferrer">
          <img src="/api-key-guide.png" alt="Where to find your App ID and API Key" />
          <span class="guide-caption">App ID and API Key</span>
        </a>

        <a class="config-guide" :href="LIVEKIT_URL" target="_blank" rel="noreferrer">
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

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onUnmounted } from 'vue'
import type { AvatarController } from '@spatius/avatarkit'
import type { AvatarInstance } from '../composables/useAvatarSDK'
import type { Scene } from '../App.vue'
import RealtimePanel from './RealtimePanel.vue'
import { BackendClient, fetchConfig } from '../utils/backendClient'

interface AvatarSlot {
  uid: string
  index: number
  name: string
}

/**
 * The SDK callbacks worth watching, in the order they first fire over a session's
 * life: load, first frame, then the per-turn ones.
 *
 * Listed whether or not this demo acts on the value — which hooks exist is part of
 * what a reference client is meant to show, and a row that only appears once it has
 * fired is a row nobody knows to expect. A value of `—` means "registered, nothing
 * reported yet".
 *
 * Two public callbacks are deliberately absent, since a row that can only ever read
 * "ok" teaches nothing:
 *   onPlaybackStall   only fires under FrameStarvationMode.strictSync, and the
 *                     default mode lets audio keep playing through starvation
 *   onAnimationState  reports the animation library, which is not public yet
 * Both are still registered in useAvatarSDK, so wiring a row back on is one entry.
 *
 * There is no connection row: in Backend Mode the server holds the Motion Server
 * connection, so `onConnectionState` never fires on this side.
 */
const STATUS_ROWS: {
  key: string
  label: string
  callback: string
  help: string
  read: (a: AvatarInstance) => string | null
}[] = [
  {
    key: 'download',
    label: 'Download',
    callback: 'AvatarManager.load(id, onProgress)',
    help: 'Model download progress, 0-100%. Only fires on a cache miss — a second load of the same avatar resolves straight away.',
    read: a => (a.loading ? `${Math.round(a.loadProgress * 100)}%` : 'complete'),
  },
  {
    key: 'rendered',
    label: 'First frame',
    callback: 'AvatarView.onFirstRendering',
    help: 'Fires once, when the avatar has actually been drawn. This is the moment to take a loading overlay down.',
    read: a => (a.rendered ? 'rendered' : 'waiting'),
  },
  {
    key: 'conversation',
    label: 'Conversation',
    callback: 'AvatarController.onConversationState',
    help: 'Playback state: idle, playing or paused. The controls over the avatar follow this.',
    read: a => a.conversationState,
  },
  {
    key: 'fps',
    label: 'Frame rate',
    callback: 'AvatarController.onFrameRateInfo',
    help: 'Rolling render rate over a 2-second window. Off by default and free while off; this demo enables it via frameRateMonitorEnabled.',
    read: a => (a.fps === null ? null : `${a.fps} fps`),
  },
  {
    key: 'error',
    label: 'Error',
    callback: 'AvatarController.onError',
    help: 'SDK failures — a malformed frame, a rendering problem. Worth surfacing rather than leaving to the console.',
    read: a => a.error ?? 'none',
  },
]

const props = defineProps<{
  activeAvatar: AvatarInstance | null
  activeController: AvatarController | null
  multiMode?: boolean
  avatarSlots?: AvatarSlot[]
  activeUid?: string | null
  /** Which scene is open — it decides what drives the avatar below the status bar. */
  scene: Scene
  /** The realtime scene's conversation language, chosen on the config page. */
  language: string
}>()

const emit = defineEmits<{
  slotSelect: [uid: string]
  notify: [text: string, kind?: 'error' | 'warning']
}>()

const connected = ref(false)
// shallowRef, not ref: a plain ref proxies the instance deeply, which both
// strips its private fields from the inferred type and wraps a live WebSocket
// in a reactive proxy. Only the identity of the client needs to be reactive.
const client = shallowRef<BackendClient | null>(null)
/** Which clip is playing, so only its own button says so. */
const playingClip = ref<string | null>(null)
const clips = ref<{ name: string; clip: string }[]>([])
const clipsHint = ref('')

const hasAvatar = computed(() => !!props.activeAvatar?.view && !props.activeAvatar.loading)
const sending = computed(() => playingClip.value !== null)

// The clips live on the server, so the list comes from there rather than being
// repeated here — dropping a .pcm file into its assets directory is enough.
onMounted(() => {
  fetchConfig()
    .then((config) => {
      clips.value = config.clips ?? []
      clipsHint.value = config.clipsHint ?? ''
    })
    .catch(() => {
      // Not worth reporting: the connection itself surfaces a server that is down.
    })
})

// The controller changes when a different character is selected, and the client
// outlives that — so it is handed the current one rather than closing over it.
watch(
  () => props.activeController,
  (controller) => {
    client.value?.setController(controller)
  },
)

/**
 * Open the connection as soon as there is an avatar to render into.
 *
 * Nothing to ask the user here: in Backend Mode this is a WebSocket to the demo's
 * own server, not a session that costs anything, and every control below is dead
 * until it exists. Direct Mode has a Start button because there the client opens
 * the Motion Server connection itself.
 */
watch(
  [hasAvatar, () => props.activeController],
  ([ready, controller]) => {
    if (!ready || !controller || client.value) return

    const next = new BackendClient({
      onError: (message) => emit('notify', message),
      onClosed: () => {
        connected.value = false
        playingClip.value = null
        client.value = null
      },
    })
    next.setController(controller)
    client.value = next

    next
      .connect()
      .then(() => {
        if (client.value !== next) return
        if (props.activeAvatar?.characterId) next.setAvatar(props.activeAvatar.characterId)
        connected.value = true
      })
      .catch((e) => {
        if (client.value !== next) return
        emit('notify', e?.message ?? 'Could not reach the Backend Mode server')
        client.value = null
      })
  },
  { immediate: true },
)

// Which avatar the server should drive, kept in step with what is on screen.
watch(
  [connected, () => props.activeAvatar?.characterId],
  ([isConnected, characterId]) => {
    if (isConnected && characterId) client.value?.setAvatar(characterId)
  },
)

/**
 * The audio context has to be created inside a user gesture — a browser will not
 * allow it otherwise, and the avatar then renders in silence with nothing
 * reported. So it is done on the first press of whatever the scene's button is,
 * rather than needing a button of its own.
 */
async function ensureAudioContext() {
  await props.activeController?.initializeAudioContext()
}

async function playSample(clip: string) {
  if (!client.value) return
  await ensureAudioContext()
  playingClip.value = clip
  client.value.playSample(clip)
  // The server streams the clip and reports nothing when it finishes, so this is
  // released on the next conversation state change rather than by a reply.
}

// The avatar going back to idle is what says the clip has finished playing.
let idleTimer: number | null = null
watch(
  [sending, () => props.activeAvatar?.conversationState],
  ([isSending, state]) => {
    if (idleTimer !== null) {
      window.clearTimeout(idleTimer)
      idleTimer = null
    }
    if (isSending && state === 'idle') {
      idleTimer = window.setTimeout(() => {
        playingClip.value = null
        idleTimer = null
      }, 500)
    }
  },
)

onUnmounted(() => {
  if (idleTimer !== null) window.clearTimeout(idleTimer)
  client.value?.close()
  client.value = null
})

function isErrorRow(key: string, value: string | null) {
  return key === 'error' && value && value !== 'none'
}
</script>

<template>
  <div class="control-panel">
    <h3>Controls</h3>

    <div class="status-bar" v-if="activeAvatar">
      <div
        v-for="row in STATUS_ROWS"
        :key="row.key"
        :class="['status-row', { error: isErrorRow(row.key, row.read(activeAvatar)) }]"
      >
        <span class="status-label">
          {{ row.label }}
          <span class="status-help" tabindex="0">
            ?
            <span class="status-tip" role="tooltip">
              <code>{{ row.callback }}</code>
              <span>{{ row.help }}</span>
            </span>
          </span>
        </span>
        <span
          :class="[
            'status-value',
            isErrorRow(row.key, row.read(activeAvatar)) ? 'error-text' : '',
            row.read(activeAvatar) === null ? 'status-idle' : '',
          ]"
        >
          {{ row.read(activeAvatar) ?? '—' }}
        </span>
      </div>
    </div>

    <div class="slot-selector" v-if="multiMode && avatarSlots && avatarSlots.length > 0">
      <h4>Active Avatar</h4>
      <div class="slot-list">
        <button
          v-for="s in avatarSlots"
          :key="s.uid"
          :class="['slot-btn', { active: s.uid === activeUid }]"
          @click="emit('slotSelect', s.uid)"
        >
          <span class="slot-index">{{ s.index }}</span>
          <span class="slot-name">{{ s.name }}</span>
        </button>
      </div>
    </div>

    <p class="panel-hint" v-if="!hasAvatar">Load a character first</p>

    <!-- What drives the avatar, and the only thing that differs between the two
         scenes. Both are driven server-side and arrive here as the same audio +
         motion messages. -->
    <RealtimePanel
      v-if="hasAvatar && scene === 'realtime'"
      :client="client"
      :connected="connected"
      :language="language"
      :onBeforeStart="ensureAudioContext"
      @notify="(text, kind) => emit('notify', text, kind)"
    />

    <div class="audio-list" v-if="hasAvatar && scene !== 'realtime'">
      <h4>
        Pre-recorded audio
        <span class="audio-hint" v-if="clipsHint" :title="clipsHint">?</span>
      </h4>
      <button
        v-for="c in clips"
        :key="c.clip"
        class="secondary full-width audio-btn"
        :disabled="!connected || sending"
        @click="playSample(c.clip)"
      >
        {{ playingClip === c.clip ? '...' : `▶ ${c.name}` }}
      </button>
      <p class="realtime-hint">
        The clips live on the server and never pass through this page: one is
        streamed straight into the avatar, and what arrives here is the encoded
        audio and motion to render.
      </p>
    </div>
  </div>
</template>

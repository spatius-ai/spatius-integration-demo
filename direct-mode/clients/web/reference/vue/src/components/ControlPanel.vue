<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { AvatarController } from '@spatius/avatarkit'
import type { AvatarInstance } from '../composables/useAvatarSDK'
import type { Scene } from '../App.vue'
import RealtimePanel from './RealtimePanel.vue'
import { PCM_ASSETS, AUDIO_SOURCE_HINT } from '../data/audioAssets'
import { loadPcmFile, sendPcmChunks } from '../utils/audio'

interface AvatarSlot {
  uid: string
  index: number
  name: string
}

/**
 * The SDK callbacks worth watching, in the order they first fire over a session's
 * life: load, first frame, connect, then the per-turn ones.
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
    help: 'Fires once, when the avatar has actually been drawn. This — not "connected" — is the moment to take a loading overlay down.',
    read: a => (a.rendered ? 'rendered' : 'waiting'),
  },
  {
    key: 'connection',
    label: 'Connection',
    callback: 'AvatarController.onConnectionState',
    help: 'The Motion Server connection: disconnected → connecting → connected, or failed. Audio sent before connected is dropped.',
    read: a => a.connectionState,
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
    help: 'SDK failures — an expired session token, an unrecognised avatar id, a lost connection. Worth surfacing rather than leaving to the console.',
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
  /** Hands the stop-sending callback up, so the on-stage controls can interrupt
   *  a clip this panel started. */
  registerCancel: [cancel: (() => void) | null]
}>()

// Track which clip is playing, not just that one is: swapping every button's
// label at once resizes them and reflows the panel, which stutters the canvas.
const sendingPath = ref<string | null>(null)
const sending = computed(() => sendingPath.value !== null)

const connected = computed(() => props.activeAvatar?.connectionState === 'connected')
// Note the first clause: with no avatar at all, `activeAvatar?.view` is undefined
// rather than null, so a `!== null` test passes and every control below turns on
// before there is anything to control.
const hasAvatar = computed(() => !!props.activeAvatar?.view && !props.activeAvatar.loading)

async function handleStart() {
  if (!props.activeController) return
  try {
    await (props.activeController as any).initializeAudioContext()
    await props.activeController.start()
  } catch (e: any) {
    console.error('Start failed:', e)
    emit('notify', `Failed to connect: ${e?.message ?? e}`)
  }
}

async function handleSendPcm(path: string) {
  // Direct Mode has no session until start() runs, so audio sent now would be
  // dropped silently. Say so instead of leaving a dead button.
  if (!connected.value) {
    emit('notify', 'Please click Start to connect before sending audio.', 'warning')
    return
  }
  const controller = props.activeController
  if (!controller || sending.value) return
  sendingPath.value = path
  try {
    // The audio context is already warmed up by handleStart; doing it here
    // again stalls the first frames of playback.
    const data = await loadPcmFile(path)
    // Wrapped so interrupting from the stage controls also clears this panel's
    // "sending" state — otherwise the clip stops but its button stays on '...'.
    const stop = sendPcmChunks(
      data,
      (chunk, end) => controller.send(chunk.buffer as ArrayBuffer, end),
      () => (sendingPath.value = null),
    )
    emit('registerCancel', () => {
      stop()
      sendingPath.value = null
    })
  } catch (e: any) {
    console.error('Send failed:', e)
    emit('notify', `Failed to send audio: ${e?.message ?? e}`)
    sendingPath.value = null
  }
}

watch(connected, (isConnected) => {
  if (!isConnected) emit('registerCancel', null)
})

function statusValueClass(key: string, value: string | null) {
  return [
    'status-value',
    key === 'connection' ? props.activeAvatar?.connectionState : '',
    key === 'error' && value ? 'error-text' : '',
    value === null ? 'status-idle' : '',
  ]
}
</script>

<template>
  <div class="control-panel">
    <h3>Controls</h3>

    <!-- Above the status bar: connecting is the first thing to do once a character
         is loaded, and the status below is what reports whether it worked.

         Pulsed until it is pressed, for the same reason the character list is:
         with an avatar on screen but no session, sending audio silently does
         nothing, which reads as a broken demo rather than a missing step.

         Only ever one pulse at a time — the whole point is to say which single
         thing to do next, and this button renders only once a character is
         loaded, by which time the list has stopped. -->
    <button
      v-if="hasAvatar"
      :class="['primary', 'full-width', connected ? '' : 'needs-pick']"
      :disabled="connected"
      @click="handleStart"
    >
      {{ connected ? 'Connected' : 'Start' }}
    </button>

    <div class="status-bar" v-if="activeAvatar">
      <div
        v-for="row in STATUS_ROWS"
        :key="row.key"
        :class="['status-row', { error: row.key === 'error' && row.read(activeAvatar) }]"
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
        <span :class="statusValueClass(row.key, row.read(activeAvatar))">
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
         scenes: a list of clips to send, or a microphone whose replies come back
         from the agent. Both end at controller.send(). -->
    <RealtimePanel
      v-if="hasAvatar && scene === 'realtime'"
      :controller="activeController"
      :connected="connected"
      :language="language"
      @notify="(text, kind) => emit('notify', text, kind)"
    />

    <div class="audio-list" v-if="hasAvatar && scene !== 'realtime'">
      <h4>
        Audio Files
        <span class="audio-hint" :title="AUDIO_SOURCE_HINT">?</span>
      </h4>
      <button
        v-for="a in PCM_ASSETS"
        :key="a.path"
        class="secondary full-width audio-btn"
        :disabled="sending"
        @click="handleSendPcm(a.path)"
      >
        {{ sendingPath === a.path ? '...' : `▶ ${a.name}` }}
      </button>
    </div>

    <!-- Pause / resume / interrupt live over the avatar itself — they act on
         what is on screen, and only the ones that would do something show. -->
  </div>
</template>

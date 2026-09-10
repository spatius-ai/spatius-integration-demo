<script setup lang="ts">
import { computed } from 'vue'
import type { AvatarController } from '@spatius/avatarkit'
import type { AvatarInstance } from '../composables/useAvatarSDK'
import RealtimePanel from './RealtimePanel.vue'

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
}>()

const emit = defineEmits<{
  slotSelect: [uid: string]
  notify: [text: string, kind?: 'error' | 'warning']
}>()

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

    <!-- What drives the avatar: a microphone whose replies come back from the
         agent as PCM, handed straight to controller.send(). -->
    <RealtimePanel
      v-if="hasAvatar"
      :controller="activeController"
      :connected="connected"
      @notify="(text, kind) => emit('notify', text, kind)"
    />

    <!-- Pause / resume / interrupt live over the avatar itself — they act on
         what is on screen, and only the ones that would do something show. -->
  </div>
</template>

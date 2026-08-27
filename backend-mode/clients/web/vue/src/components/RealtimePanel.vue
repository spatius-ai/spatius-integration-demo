<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { MicrophonePcmCapture } from '../utils/audioCapture'
import type { BackendClient } from '../utils/backendClient'

interface Turn {
  role: 'user' | 'assistant'
  text: string
}

const MIC_SAMPLE_RATE = 16000

const props = defineProps<{
  /** The one connection to the server; null until it has been opened. */
  client: BackendClient | null
  connected: boolean
  /**
   * Which language the conversation runs in, chosen on the config page.
   *
   * Not switchable here: recognition, synthesis and the persona are all fixed when
   * the agent session is built, so changing it means a new session.
   */
  language: string
  /** Creates the audio context, which a browser only allows inside a user gesture. */
  onBeforeStart: () => Promise<void>
}>()

const emit = defineEmits<{ notify: [text: string, kind?: 'error' | 'warning'] }>()

/**
 * The realtime scene's controls: one microphone, in place of the clip button.
 *
 * Everything conversational happens on the server — the mic goes up as PCM, the
 * agent's reply is driven into the avatar there, and what comes back is the same
 * encoded audio + motion the pre-recorded scene produces.
 */
const agentReady = ref(false)
const starting = ref(false)
const micOn = ref(false)
/**
 * Whether the microphone has ever been opened in this session.
 *
 * Drives the green ring, which points at the mic once the avatar is connected
 * and stops for good after the first press — same as the character list and
 * Start. Not `!micOn`, or the ring would return on every mute, long after the
 * user has learned where the button is.
 */
const micUsed = ref(false)
const speaking = ref(false)
const transcript = ref<Turn[]>([])
const typed = ref('')

let mic: MicrophonePcmCapture | null = null

// The client is created by ControlPanel once an avatar is loaded, so this panel
// attaches its own handlers when it appears rather than at construction.
// ControlPanel's own callbacks (errors, close) are left alone.
watch(
  () => props.client,
  (client, previous) => {
    if (previous) {
      previous.callbacks.onSpeaking = undefined
      previous.callbacks.onTranscript = undefined
    }
    if (!client) return
    client.callbacks.onSpeaking = () => (speaking.value = true)
    client.callbacks.onTranscript = (role, text) => {
      transcript.value = [...transcript.value, { role, text }]
    }
  },
  { immediate: true },
)

// A dropped connection takes the agent with it.
watch(
  () => props.connected,
  (connected) => {
    if (connected) return
    agentReady.value = false
    micOn.value = false
    void mic?.stop()
    mic = null
  },
)

onUnmounted(() => {
  void mic?.stop()
  mic = null
  if (props.client) {
    props.client.callbacks.onSpeaking = undefined
    props.client.callbacks.onTranscript = undefined
  }
})

async function ensureAgent(): Promise<boolean> {
  if (!props.client || !props.connected) {
    emit('notify', 'Still connecting to the server — try again in a moment.', 'warning')
    return false
  }
  if (agentReady.value) return true

  // Brought up on the first press rather than on mount: it costs a model session,
  // and someone who only wants the pre-recorded scene should not pay for one by
  // loading the page.
  starting.value = true
  try {
    await props.onBeforeStart()
    // Awaited rather than fired off: microphone audio pushed before the agent
    // exists is dropped, which presents as a mic that records nothing.
    await props.client.startAgent(props.language)
    agentReady.value = true
    return true
  } catch (e: any) {
    emit('notify', e?.message ?? 'The agent did not start')
    return false
  } finally {
    starting.value = false
  }
}

async function toggleMic() {
  if (!(await ensureAgent())) return

  if (micOn.value) {
    await mic?.stop()
    mic = null
    micOn.value = false
    return
  }

  try {
    const capture = new MicrophonePcmCapture(MIC_SAMPLE_RATE)
    mic = capture
    await capture.start((chunk) => {
      props.client?.pushMicAudio(chunk.buffer as ArrayBuffer)
    })
    micOn.value = true
    micUsed.value = true
  } catch (e: any) {
    mic = null
    emit(
      'notify',
      e?.name === 'NotAllowedError'
        ? 'Microphone permission was denied.'
        : (e?.message ?? 'Could not open the microphone'),
    )
  }
}

async function sendTyped() {
  const text = typed.value.trim()
  if (!text) return
  if (!(await ensureAgent())) return
  props.client?.say(text)
  typed.value = ''
}

const micState = computed(() =>
  !props.connected
    ? 'Connecting to the server…'
    : starting.value
      ? 'Starting the agent…'
      : micOn.value
        ? 'Listening — just talk, the agent decides when your turn ends.'
        : agentReady.value
          ? 'Microphone off.'
          : 'Tap to start talking.',
)
</script>

<template>
  <div class="realtime-panel">
    <h4>
      Microphone
      <span v-if="speaking" class="speaking-dot" title="The avatar is speaking" />
    </h4>

    <button
      :class="['mic-btn', { on: micOn }, props.connected && !micUsed ? 'needs-pick' : '']"
      :disabled="!connected || starting"
      @click="toggleMic"
      :title="micOn ? 'Stop the microphone' : 'Start talking'"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
        <path
          d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.09A6 6 0 0 0 18 11z"
        />
      </svg>
    </button>

    <p class="mic-state">{{ micState }}</p>

    <!-- A way to try the scene without a microphone — a machine with no input
         device, or a quick check that the agent replies. -->
    <form class="realtime-text" @submit.prevent="sendTyped">
      <input v-model="typed" placeholder="…or type a line to speak" :disabled="!connected" />
      <button type="submit" class="secondary" :disabled="!typed.trim() || !connected">
        Say
      </button>
    </form>

    <div class="transcript" v-if="transcript.length > 0">
      <p v-for="(turn, i) in transcript" :key="i" :class="turn.role">
        <strong>{{ turn.role === 'user' ? 'You' : 'Avatar' }}</strong>
        {{ turn.text }}
      </p>
    </div>

    <p class="realtime-hint">
      The conversation runs on the server — ASR, LLM and TTS — and the reply is
      driven into the avatar there. This page only renders the audio and motion
      that come back.
    </p>
  </div>
</template>

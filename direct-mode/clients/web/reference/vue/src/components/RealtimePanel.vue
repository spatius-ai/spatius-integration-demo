<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from 'vue'
import type { AvatarController } from '@spatius/avatarkit'
import { RealtimeClient, fetchRealtimeUrl } from '../utils/realtimeClient'

interface Turn {
  role: 'user' | 'assistant'
  text: string
}

const props = defineProps<{
  controller: AvatarController | null
  /** No session yet, so there is nowhere for a reply to go. */
  connected: boolean
  /**
   * Which language the conversation runs in, chosen on the config page.
   *
   * Not switchable here: recognition, synthesis and the persona are all fixed when
   * the agent session is built, so changing it means a new session — which is what
   * going back to the config page does anyway.
   */
  language: string
}>()

const emit = defineEmits<{ notify: [text: string, kind?: 'error' | 'warning'] }>()

/**
 * The realtime scene's controls: one microphone, in place of the clip list.
 *
 * Everything conversational happens on the backend — the mic goes up as PCM, the
 * agent's speech comes back the same way, and this hands it to the same
 * `controller.send()` the pre-recorded scene uses.
 */
const agentReady = ref(false)
const connecting = ref(false)
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

let client: RealtimeClient | null = null

async function connectAgent() {
  if (client || connecting.value) return
  connecting.value = true
  try {
    const url = await fetchRealtimeUrl()
    const next = new RealtimeClient(
      {
        // Read from props at call time rather than captured: the client is built
        // once, and a callback closing over the controller from this moment would
        // keep sending to a stale one.
        send: (pcm, end) => props.controller?.send(pcm, end),
        interrupt: () => props.controller?.interrupt(),
      },
      {
        onSpeaking: () => (speaking.value = true),
        onTurnEnd: () => (speaking.value = false),
        onTranscript: (role, text) => (transcript.value = [...transcript.value, { role, text }]),
        onError: (message) => emit('notify', message),
        onClosed: () => {
          agentReady.value = false
          micOn.value = false
        },
      },
    )
    client = next
    await next.connect(url, props.language)
    agentReady.value = true
  } catch (e: any) {
    emit('notify', e?.message ?? 'Could not reach the agent')
    await client?.close()
    client = null
  } finally {
    connecting.value = false
  }
}

async function toggleMic() {
  if (!props.connected) {
    emit('notify', 'Click Start to connect the avatar first.', 'warning')
    return
  }
  // The agent is brought up on the first press rather than on mount: it costs a
  // model session, and someone who only wants the pre-recorded scene should not
  // pay for one by loading the page.
  if (!client) {
    await connectAgent()
    if (!client) return
  }

  if (micOn.value) {
    await client.stopMic()
    micOn.value = false
  } else {
    try {
      await client.startMic()
      micOn.value = true
      micUsed.value = true
    } catch (e: any) {
      emit(
        'notify',
        e?.name === 'NotAllowedError'
          ? 'Microphone permission was denied.'
          : (e?.message ?? 'Could not open the microphone'),
      )
    }
  }
}

async function sendTyped() {
  const text = typed.value.trim()
  if (!text) return
  if (!props.connected) {
    emit('notify', 'Click Start to connect the avatar first.', 'warning')
    return
  }
  if (!client) {
    await connectAgent()
    if (!client) return
  }
  client.say(text)
  typed.value = ''
}

// Close the agent when the avatar's session goes away, so a dropped connection
// does not leave a model session running with nowhere to send its audio.
watch(
  () => props.connected,
  (connected) => {
    if (!connected && client) {
      void client.close()
      client = null
      agentReady.value = false
      micOn.value = false
    }
  },
)

onUnmounted(() => {
  void client?.close()
  client = null
})

const micState = computed(() =>
  connecting.value
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
      :disabled="connecting"
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

    <!-- A way to try the scene without a microphone — a headless browser, a
         machine with no input device, or a quick check that the agent replies. -->
    <form class="realtime-text" @submit.prevent="sendTyped">
      <input v-model="typed" placeholder="…or type a line to speak" />
      <button type="submit" class="secondary" :disabled="!typed.trim()">Say</button>
    </form>

    <div class="transcript" v-if="transcript.length > 0">
      <p v-for="(turn, i) in transcript" :key="i" :class="turn.role">
        <strong>{{ turn.role === 'user' ? 'You' : 'Avatar' }}</strong>
        {{ turn.text }}
      </p>
    </div>

    <p class="realtime-hint">
      The conversation runs on the backend — ASR, LLM and TTS — and its speech
      arrives here as PCM over a WebSocket. That audio goes to
      <code>controller.send()</code>, exactly like the pre-recorded clips do.
    </p>
  </div>
</template>

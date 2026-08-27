<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { AppConfig } from '../App.vue'
import { RtcSession, stopSessionOnUnload } from '../utils/rtcSession'
import CharacterList from '../components/CharacterList.vue'
import Toast from '../components/Toast.vue'
import { useToast } from '../composables/useToast'

const props = defineProps<{ config: AppConfig }>()

/**
 * The room, laid out like the other two modes: characters on the left, the avatar in
 * the middle, controls on the right.
 *
 * What differs is that there is nothing to send. In RTC Mode the avatar is in the
 * call, so the panel holds a microphone and nothing else: no clips to play, and no
 * pause or interrupt, because there is no local playback to act on.
 */
const stageRef = ref<HTMLDivElement | null>(null)
const { messages, push: notify, dismiss } = useToast()

let session: RtcSession | null = null

const avatarId = ref<string | null>(null)
const characterName = ref('')
const status = ref('Pick a character to enter the room.')
const rendered = ref(false)
const connecting = ref(false)
const micOn = ref(false)
/**
 * Whether the agent is in the room and listening.
 *
 * Distinct from `rendered`, which only says the avatar has been drawn — that
 * happens several seconds earlier. Gating the microphone on the wrong one of the
 * two let it be opened into an empty room: the button went live, nothing was
 * listening, and it took a second press once the agent finally arrived.
 */
const agentReady = ref(false)
/**
 * Whether the microphone has ever been opened in this room.
 *
 * Drives the green ring, which points at the mic the moment it becomes usable and
 * stops for good once it has been pressed — same as the character list and Start.
 * Not `!micOn`, or the ring would come back every time the mic is muted, long
 * after the user has learned where it is.
 */
const micUsed = ref(false)

async function enter(id: string, name: string) {
  if (session || !stageRef.value) return
  avatarId.value = id
  characterName.value = name
  connecting.value = true

  const next = new RtcSession({
    onProgress: (text) => (status.value = text),
    onDownload: (percent) => (status.value = `Downloading avatar… ${percent}%`),
    onRendered: () => (rendered.value = true),
    onError: (message) => notify(message),
  })
  session = next

  // True once this session has been replaced or torn down. Every await below
  // checks it, so the steps that follow do not run against a disconnected one.
  const superseded = () => session !== next

  try {
    await next.start(stageRef.value, id, props.config.language)
    if (superseded()) return
    status.value = 'Connecting the agent…'

    // Not awaited: the avatar is on screen and the panel is usable as soon as
    // the room is up, and the agent takes seconds longer to come round. Holding
    // `enter()` open until then left the right-hand panel empty for the whole
    // wait, so the room looked like it had failed to load.
    //
    // "The agent joined" is not the thing to wait for either — at join time its
    // session is still starting up and speech arriving then is dropped, which
    // presents as a room that connects but never answers. waitForAgent() waits
    // for the ready attribute the worker sets after that.
    void next.waitForAgent().then((joined) => {
      if (superseded()) return
      if (!joined) {
        // Almost always the worker: it is a separate process, and if it failed
        // to start there is nothing in the room to talk to.
        notify('The agent did not join — check the server log for the worker.')
        status.value = 'No agent in the room. The avatar cannot hear or answer you.'
        return
      }
      // The microphone is left to the button. Opening it here as well gave the
      // same action two entry points racing each other, and the browser wants a
      // user gesture for it anyway.
      agentReady.value = true
      status.value = 'Ready — tap the microphone to talk.'
    })
  } catch (e: any) {
    if (superseded()) return
    notify(e?.message ?? 'Could not enter the room')
    status.value = 'Could not enter the room.'
    await next.stop()
    session = null
    avatarId.value = null
  } finally {
    if (!superseded()) connecting.value = false
  }
}

/**
 * Sessions bill from the moment they are created, so leaving has to close the room
 * rather than waiting for its timeout to reap it.
 */
function onUnload() {
  const id = session?.id
  if (id) stopSessionOnUnload(id)
}

onMounted(() => {
  window.addEventListener('pagehide', onUnload)
})

onUnmounted(() => {
  window.removeEventListener('pagehide', onUnload)
  void session?.stop()
  session = null
})

async function toggleMic() {
  // agentReady as well as the disabled attribute: opening the microphone into a
  // room with nothing listening is the failure this ordering exists to prevent,
  // and a guard in the handler holds even if the button is reached another way.
  if (!session || !agentReady.value) return
  try {
    // Asked of the session rather than read from `micOn`: the two can drift, and
    // acting on the stale one means publishing an already-open microphone, which
    // the SDK rejects.
    if (session.micActive) {
      await session.unpublishMic()
      micOn.value = false
      status.value = 'Microphone closed — the avatar cannot hear you.'
    } else {
      await session.publishMic()
      micOn.value = true
      micUsed.value = true
      status.value = 'Just talk — the agent decides when your turn ends.'
    }
  } catch (e: any) {
    notify(e?.message ?? 'Could not switch the microphone')
  }
}
</script>

<template>
  <div class="playground">
    <div class="playground-left">
      <CharacterList
        :loadingId="connecting ? avatarId : null"
        :loadProgress="0"
        :empty="!avatarId"
        @select="enter"
      />
    </div>

    <div class="playground-center">
      <div class="center-header">
        <span class="avatar-count">{{ characterName || 'RTC Mode' }}</span>
      </div>

      <div class="canvas-stage">
        <div class="avatar-canvas grid-1">
          <div class="canvas-cell active-cell">
            <div ref="stageRef" class="canvas-container" />
            <div class="canvas-empty" v-if="!avatarId">Select a character to get started</div>
            <div class="canvas-loading" v-if="avatarId && !rendered">{{ status }}</div>
          </div>
        </div>

        <!-- Nothing over the avatar here. The other two modes put pause and
             interrupt there because they drive playback; in RTC Mode the avatar is
             in the call and there is no local playback to act on — closing the
             microphone is the only control, and it lives in the panel. -->
      </div>
    </div>

    <div class="playground-right">
      <div class="control-panel">
        <h3>Controls</h3>

        <!-- No status bar here. The other two modes list the SDK callbacks that
             report on driving the avatar; in RTC Mode nothing is driven from this
             page — the avatar is in the call — so there is nothing to report. -->

        <!-- Shown as soon as the avatar is on screen, not once the agent is ready:
             the agent takes seconds longer, and an empty panel for that whole time
             read as a room that had failed to load. The button is here but inert
             until there is something in the room to hear it. -->
        <div class="realtime-panel" v-if="rendered">
          <h4>Microphone</h4>

          <button
            :class="['mic-btn', { on: micOn }, agentReady && !micUsed ? 'needs-pick' : '']"
            @click="toggleMic"
            :disabled="!agentReady"
            :title="
              !agentReady
                ? 'Waiting for the agent to join'
                : micOn
                  ? 'Mute the microphone'
                  : 'Unmute the microphone'
            "
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
              <path
                d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.09A6 6 0 0 0 18 11z"
              />
            </svg>
          </button>

          <p class="mic-state">{{ status }}</p>
        </div>

        <p class="status" v-else>{{ status }}</p>

        <p class="realtime-hint">
          RTC Mode is the one path where the avatar joins the call itself: audio
          travels on an RTC track and the motion rides along encoded in the video
          stream. Nothing is driven from this page, and nothing streams through the
          server — it only issues the credentials to join.
        </p>
      </div>
    </div>

    <Toast :messages="messages" @dismiss="dismiss" />
  </div>
</template>

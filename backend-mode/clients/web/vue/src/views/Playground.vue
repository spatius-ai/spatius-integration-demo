<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { DrivingServiceMode } from '@spatius/avatarkit'
import type { AppConfig } from '../App.vue'
import { useAvatarManager } from '../composables/useAvatarSDK'
import { useToast } from '../composables/useToast'
import CharacterList from '../components/CharacterList.vue'
import ControlPanel from '../components/ControlPanel.vue'
import StageControls from '../components/StageControls.vue'
import Toast from '../components/Toast.vue'

defineProps<{ mode: DrivingServiceMode; config: AppConfig }>()

const MAX_AVATARS = 4

const multiMode = ref(false)
const loadingCharId = ref<string | null>(null)
const canvasRef = ref<HTMLDivElement | null>(null)
const containerRefs = new Map<string, HTMLDivElement>()

const { messages, push: notify, dismiss } = useToast()

const {
  avatars,
  activeUid,
  activeAvatar,
  activeController,
  setActiveUid,
  loadAvatar,
  removeAvatar,
  removeAll,
} = useAvatarManager(notify)

/**
 * Interrupting only has to stop the local playback here: the audio is produced on
 * the server, and it stops sending when the session tells it to — there is no
 * local sender to cancel, which is what Direct Mode needs a handle for.
 */
function handleInterrupt() {
  activeController.value?.interrupt()
}

// Update active-cell highlight when activeUid changes
watch(activeUid, (uid) => {
  containerRefs.forEach((cell, cellUid) => {
    cell.classList.toggle('active-cell', cellUid === uid)
  })
})

function handleRemoveAvatar(uid: string) {
  const cell = containerRefs.get(uid)
  if (cell) cell.remove()
  containerRefs.delete(uid)
  removeAvatar(uid)
  // Re-number remaining badges
  let idx = 1
  containerRefs.forEach((c) => {
    const badge = c.querySelector('.cell-badge')
    if (badge) badge.textContent = String(idx++)
  })
}

async function handleCharacterSelect(charId: string, charName: string) {
  if (loadingCharId.value) return
  if (avatars.value.length >= MAX_AVATARS && multiMode.value) return

  if (!multiMode.value) {
    removeAll()
    containerRefs.forEach(cell => cell.remove())
    containerRefs.clear()
  }

  loadingCharId.value = charId

  const cell = document.createElement('div')
  cell.className = 'canvas-cell active-cell'

  // Loading overlay (spinner + progress)
  const overlay = document.createElement('div')
  overlay.className = 'cell-loading-overlay'
  overlay.innerHTML = '<div class="cell-spinner"></div><div class="cell-progress-text">0%</div>'
  cell.appendChild(overlay)

  // Slot index for this avatar
  const slotIndex = multiMode.value ? avatars.value.length + 1 : 1

  // Index badge (top-left)
  const badge = document.createElement('div')
  badge.className = 'cell-badge'
  badge.textContent = String(slotIndex)
  cell.appendChild(badge)

  // Close button (top-right), only in multi mode
  if (multiMode.value) {
    const closeBtn = document.createElement('button')
    closeBtn.className = 'cell-close'
    closeBtn.textContent = '✕'
    closeBtn.onclick = (e) => {
      e.stopPropagation()
      for (const [uid, c] of containerRefs) {
        if (c === cell) {
          handleRemoveAvatar(uid)
          break
        }
      }
    }
    cell.appendChild(closeBtn)
  }

  // Click cell to select
  cell.onclick = () => {
    for (const [uid, c] of containerRefs) {
      if (c === cell) {
        setActiveUid(uid)
        break
      }
    }
  }

  const container = document.createElement('div')
  container.style.width = '100%'
  container.style.height = '100%'
  cell.appendChild(container)

  canvasRef.value?.appendChild(cell)
  await nextTick()
  await new Promise(r => requestAnimationFrame(r))

  try {
    const uid = await loadAvatar(charId, charName, container, (progress) => {
      const text = overlay.querySelector('.cell-progress-text')
      if (text) text.textContent = `${Math.round(progress)}%`
    })
    containerRefs.set(uid, cell)
    // Remove loading overlay
    overlay.remove()
  } catch (e: any) {
    console.error('Load failed:', e)
    notify(`Failed to load avatar: ${e?.message ?? e}`)
    cell.remove()
  } finally {
    loadingCharId.value = null
  }
}

function handleMultiToggle() {
  if (multiMode.value && avatars.value.length > 1) {
    avatars.value.forEach((a) => {
      if (a.uid !== activeUid.value) {
        const cell = containerRefs.get(a.uid)
        if (cell) cell.remove()
        containerRefs.delete(a.uid)
        removeAvatar(a.uid)
      }
    })
  }
  multiMode.value = !multiMode.value
}

const gridClass = computed(() => (multiMode.value ? 'grid-4' : 'grid-1'))

// Build slot selector for control panel in multi mode
const avatarSlots = computed(() =>
  avatars.value.map((a, i) => ({ uid: a.uid, index: i + 1, name: a.characterName })),
)

// Find loading avatar's progress
const loadProgress = computed(() => avatars.value.find(a => a.loading)?.loadProgress ?? 0)

const isEmpty = computed(() => avatars.value.length === 0 && !loadingCharId.value)
</script>

<template>
  <div class="playground">
    <div class="playground-left">
      <CharacterList
        :loadingId="loadingCharId"
        :loadProgress="loadProgress"
        :empty="isEmpty"
        @select="handleCharacterSelect"
      />
    </div>

    <div class="playground-center">
      <div class="center-header">
        <label class="multi-toggle">
          <input type="checkbox" :checked="multiMode" @change="handleMultiToggle" />
          <span>Multi-avatar mode</span>
        </label>
        <span class="avatar-count" v-if="multiMode">{{ avatars.length }}/{{ MAX_AVATARS }}</span>
      </div>

      <div class="canvas-stage">
        <div ref="canvasRef" :class="['avatar-canvas', gridClass]">
          <div class="canvas-empty" v-if="isEmpty">Select a character to get started</div>
        </div>

        <!-- Over the avatar, since that is what they act on. Which pair shows
             follows the conversation state; in idle neither does. -->
        <StageControls
          v-if="activeAvatar && activeController"
          :state="activeAvatar.conversationState"
          @interrupt="handleInterrupt"
          @pause="activeController.pause()"
          @resume="activeController.resume()"
        />
      </div>
    </div>

    <div class="playground-right">
      <ControlPanel
        :activeAvatar="activeAvatar"
        :activeController="activeController"
        :multiMode="multiMode"
        :avatarSlots="avatarSlots"
        :activeUid="activeUid"
        :scene="config.scene"
        :language="config.language"
        @slotSelect="setActiveUid"
        @notify="notify"
      />
    </div>

    <Toast :messages="messages" @dismiss="dismiss" />
  </div>
</template>

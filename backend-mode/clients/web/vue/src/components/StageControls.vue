<script setup lang="ts">
import { computed } from 'vue'
import { ConversationState } from '@spatius/avatarkit'

/**
 * Playback controls, over the avatar rather than in the side panel.
 *
 * They act on what is on screen, so they belong on it — and the pair that shows
 * follows the conversation state, which means there is never a button here that
 * would do nothing:
 *
 *   idle     nothing to stop or pause, so neither appears
 *   playing  interrupt · pause
 *   paused   interrupt · resume
 *
 * Interrupt keeps the same corner throughout: it does the same thing in both
 * states, and moving it would make the two buttons swap places on every pause.
 */
const props = defineProps<{ state: ConversationState }>()
const emit = defineEmits<{ interrupt: []; pause: []; resume: [] }>()

const visible = computed(() => props.state !== ConversationState.idle)
const paused = computed(() => props.state === ConversationState.paused)
</script>

<template>
  <div class="stage-controls" v-if="visible">
    <button
      class="stage-btn stage-btn-interrupt"
      @click="emit('interrupt')"
      title="Interrupt"
      aria-label="Interrupt"
    >
      <!-- A square: stop, as on any transport control. Drawn close to the edges
           of the viewBox so it fills the button rather than floating in it. -->
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="5" width="14" height="14" rx="2" />
      </svg>
    </button>

    <button
      :class="['stage-btn', paused ? 'stage-btn-resume' : 'stage-btn-pause']"
      @click="paused ? emit('resume') : emit('pause')"
      :title="paused ? 'Resume' : 'Pause'"
      :aria-label="paused ? 'Resume' : 'Pause'"
    >
      <!-- Nudged right of centre: a triangle's visual centre sits behind its
           bounding box, so centring the box makes it look shifted left. -->
      <svg v-if="paused" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M6.8 4.4v15.2a1.2 1.2 0 0 0 1.84 1l11.4-7.6a1.2 1.2 0 0 0 0-2l-11.4-7.6a1.2 1.2 0 0 0-1.84 1z"
        />
      </svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5.5" y="4" width="5" height="16" rx="1.6" />
        <rect x="13.5" y="4" width="5" height="16" rx="1.6" />
      </svg>
    </button>
  </div>
</template>

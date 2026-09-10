<script setup lang="ts">
import { watch, onUnmounted } from 'vue'
import type { ToastMessage } from '../composables/useToast'

const AUTO_DISMISS_MS = 5000

const props = defineProps<{ messages: ToastMessage[] }>()
const emit = defineEmits<{ dismiss: [id: number] }>()

/**
 * Floating notices for things a reader would otherwise only find in the
 * console — SDK errors and "you have to connect first" style guidance.
 */
const timers = new Map<number, number>()

watch(
  () => props.messages,
  (messages) => {
    for (const m of messages) {
      // One timer per message, set once: re-arming on every list change would
      // keep an old notice alive as long as new ones keep arriving.
      if (timers.has(m.id)) continue
      timers.set(
        m.id,
        window.setTimeout(() => {
          timers.delete(m.id)
          emit('dismiss', m.id)
        }, AUTO_DISMISS_MS),
      )
    }
    // Drop timers for messages dismissed by hand, so the map does not grow.
    for (const [id, handle] of timers) {
      if (!messages.some(m => m.id === id)) {
        window.clearTimeout(handle)
        timers.delete(id)
      }
    }
  },
  { immediate: true, deep: true },
)

onUnmounted(() => {
  timers.forEach(handle => window.clearTimeout(handle))
  timers.clear()
})
</script>

<template>
  <div class="toast-stack" v-if="messages.length > 0">
    <div v-for="m in messages" :key="m.id" :class="['toast', `toast-${m.kind}`]" role="alert">
      <span class="toast-text">{{ m.text }}</span>
      <button class="toast-close" @click="emit('dismiss', m.id)" aria-label="Dismiss">×</button>
    </div>
  </div>
</template>

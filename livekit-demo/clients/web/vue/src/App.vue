<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Room from './views/Room.vue'
import { fetchConfig, initializeSdk } from './utils/rtcSession'
import './App.css'

/**
 * The app boots straight into the room.
 *
 * There is no configuration step: every credential and every setting — language,
 * voice, model — lives in the server's `.env`, and the server refuses to start
 * without them. All this page needs is the App ID to initialize the SDK with, which
 * it fetches on mount; the only thing the user chooses is a character.
 */
const ready = ref(false)
const error = ref<string | null>(null)

async function boot() {
  error.value = null
  try {
    const config = await fetchConfig()
    // Initialized here rather than at the first click: the SDK reads the App ID only
    // at initialize time, and doing it once on the way in keeps the first character
    // selection from paying for it.
    await initializeSdk(config.appId)
    ready.value = true
  } catch (e: any) {
    error.value = e?.message ?? 'Could not reach the demo server'
  }
}

onMounted(boot)
</script>

<template>
  <div v-if="error" class="app boot-error">
    <div class="boot-error-box">
      <h1>Cannot start</h1>
      <p>{{ error }}</p>
      <p class="boot-error-hint">
        Start the demo server (<code>servers/python</code>) and check its terminal: it
        prints any key still missing from <code>.env</code> and exits.
      </p>
      <button class="primary" @click="boot">Retry</button>
    </div>
  </div>
  <div v-else class="app">
    <Room v-if="ready" />
  </div>
</template>

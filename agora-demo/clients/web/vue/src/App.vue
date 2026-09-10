<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Room from './views/Room.vue'
import { fetchConfig, type ServerConfig } from './utils/rtcSession'
import './App.css'

/**
 * Straight into the room.
 *
 * There is no configuration step: every setting this demo has — the Spatius and Agora
 * credentials, the conversation language, the voice — lives in the server's `.env`,
 * and the server refuses to start while one is missing. All this has to do first is
 * ask the server what the default avatar is, which also tells it the server is up.
 */
const config = ref<ServerConfig | null>(null)
const error = ref<string | null>(null)

async function load() {
  error.value = null
  try {
    config.value = await fetchConfig()
  } catch (e: any) {
    error.value = e?.message ?? 'Cannot reach the demo server'
  }
}

onMounted(load)
</script>

<template>
  <div v-if="error" class="app boot-error">
    <h1>Cannot reach the demo server</h1>
    <p>{{ error }}</p>
    <p class="boot-hint">
      Start it with <code>uv run python server.py</code> in
      <code>servers/python</code>, then try again.
    </p>
    <button class="primary" @click="load">Retry</button>
  </div>

  <div v-else class="app">
    <Room v-if="config" :config="config" />
  </div>
</template>

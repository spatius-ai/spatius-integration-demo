<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { AvatarSDK, DrivingServiceMode, LogLevel } from '@spatius/avatarkit'
import { fetchConfig, type BackendConfig } from './utils/backendClient'
import Playground from './views/Playground.vue'
import './App.css'

/**
 * The whole boot path.
 *
 * There is nothing to ask the user: in Backend Mode the server holds the Motion
 * Server connection and every credential with it, so this client reads what it needs
 * to render — app id, region, sample rates, the avatar to open with — from
 * `/api/config` and initializes the SDK with it. No session token is involved; this
 * SDK instance only renders what arrives over the WebSocket.
 */
const MODE = DrivingServiceMode.backend

const config = ref<BackendConfig | null>(null)
const error = ref<string | null>(null)

async function boot() {
  error.value = null
  try {
    const c = await fetchConfig()
    await AvatarSDK.initialize(c.appId, {
      region: c.region,
      drivingServiceMode: MODE,
      audioFormat: { channelCount: 1, sampleRate: c.inputSampleRate },
      logLevel: LogLevel.all,
    })
    config.value = c
  } catch (e: any) {
    error.value = e?.message ?? 'Could not start'
  }
}

onMounted(boot)
</script>

<template>
  <div class="app boot-state" v-if="error">
    <div class="boot-box">
      <h1>Cannot reach the Backend Mode server</h1>
      <p class="boot-error">{{ error }}</p>
      <p class="boot-hint">
        Start it with <code>cd servers/python &amp;&amp; uv run python -m app.main</code>.
        It reads every credential from its own <code>.env</code> and reports any that
        is missing.
      </p>
      <button class="primary" @click="boot">Retry</button>
    </div>
  </div>

  <div class="app boot-state" v-else-if="!config">
    <div class="boot-box">
      <p class="boot-hint">Starting…</p>
    </div>
  </div>

  <div class="app" v-else>
    <Playground :config="config" />
  </div>
</template>

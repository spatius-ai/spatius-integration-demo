<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { AvatarSDK, DrivingServiceMode, LogLevel } from '@spatius/avatarkit'
import { fetchConfig, fetchSessionToken, type BackendConfig } from '@direct-core'
import Playground from './views/Playground.vue'
import './App.css'

/**
 * Boot, then hand over to the playground.
 *
 * There is no configuration screen: everything the SDK needs — the App ID, the
 * region, the avatar — comes from the server's `/api/config`, and the Session Token
 * is minted there too. This is the whole of the credential path in a Direct Mode
 * app, and it is four lines.
 */
const MODE = DrivingServiceMode.direct

const config = ref<BackendConfig | null>(null)
const error = ref<string | null>(null)

async function boot() {
  error.value = null
  try {
    const backend = await fetchConfig()
    const session = await fetchSessionToken()
    await AvatarSDK.initialize(backend.appId, {
      // Omitting region entirely is what triggers the SDK's automatic pick.
      ...(backend.region ? { region: backend.region } : {}),
      drivingServiceMode: MODE,
      audioFormat: { channelCount: 1, sampleRate: backend.sampleRate },
      logLevel: LogLevel.all,
    })
    AvatarSDK.setSessionToken(session.sessionToken)
    config.value = backend
  } catch (e: any) {
    error.value = e?.message ?? 'Could not reach the Direct Mode server'
  }
}

onMounted(boot)
</script>

<template>
  <div class="app boot" v-if="error">
    <div class="boot-error">
      <h1>Cannot start</h1>
      <p>{{ error }}</p>
      <p class="boot-hint">
        Check that the Direct Mode server is running and that its <code>.env</code> is
        filled in.
      </p>
      <button class="primary" @click="boot">Retry</button>
    </div>
  </div>

  <div class="app boot" v-else-if="!config">
    <div class="boot-status">Connecting to the Direct Mode server…</div>
  </div>

  <div class="app" v-else>
    <Playground :config="config" />
  </div>
</template>

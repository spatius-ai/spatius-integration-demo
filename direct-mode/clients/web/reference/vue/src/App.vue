<script setup lang="ts">
import { ref } from 'vue'
import { DrivingServiceMode } from '@spatius/avatarkit'
import Configuration from './views/Configuration.vue'
import Playground from './views/Playground.vue'
import './App.css'

/**
 * Which scene the playground opens in. Both drive the avatar through the same
 * `controller.send()` — they differ only in where the audio comes from.
 */
export type Scene = 'sample' | 'realtime'

/** Which language the realtime conversation runs in. */
export type Lang = 'en' | 'zh'

export interface AppConfig {
  appId: string
  sessionToken: string
  region: string
  scene: Scene
  /**
   * Recognition, synthesis and the agent's persona all follow this, and all three
   * are fixed when the agent session is built — which is why it is chosen here
   * rather than switched inside the scene.
   */
  language: Lang
  /** Only the realtime scene reaches an agent, so this is absent for the other. */
  livekit?: {
    url: string
    apiKey: string
    apiSecret: string
  }
}

const MODE = DrivingServiceMode.direct

const step = ref<1 | 2>(1)
const config = ref<AppConfig | null>(null)

function handleInitialized(c: AppConfig) {
  config.value = c
  step.value = 2
}
</script>

<template>
  <div class="app">
    <div :class="['view', { active: step === 1 }]">
      <Configuration :mode="MODE" @initialized="handleInitialized" />
    </div>
    <div :class="['view', { active: step === 2 }]">
      <Playground v-if="config && step === 2" :mode="MODE" :config="config" />
    </div>
  </div>
</template>

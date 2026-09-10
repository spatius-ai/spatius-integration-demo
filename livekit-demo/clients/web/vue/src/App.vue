<script setup lang="ts">
import { ref } from 'vue'
import Configuration from './views/Configuration.vue'
import Room from './views/Room.vue'
import './App.css'

/** Which language the conversation runs in. */
export type Lang = 'en' | 'zh'

export interface AppConfig {
  language: Lang
  avatarId: string
}

const config = ref<AppConfig | null>(null)

function handleReady(c: AppConfig) {
  config.value = c
}
</script>

<template>
  <div class="app">
    <div :class="['view', { active: !config }]">
      <Configuration @ready="handleReady" />
    </div>
    <div :class="['view', { active: !!config }]">
      <Room v-if="config" :config="config" />
    </div>
  </div>
</template>

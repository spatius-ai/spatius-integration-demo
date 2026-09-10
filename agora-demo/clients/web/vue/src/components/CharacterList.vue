<script setup lang="ts">
import { ref, computed } from 'vue'
import { DEFAULT_CHARACTERS } from '../data/characters'

const DASH_URL = 'https://app.spatius.ai'

interface Character {
  id: string
  name: string
}

const props = defineProps<{
  loadingId: string | null
  loadProgress: number
  /** Nothing on the canvas yet, so this list is the only thing worth clicking. */
  empty?: boolean
}>()

const emit = defineEmits<{ select: [id: string, name: string] }>()

const adding = ref(false)
const customId = ref('')
const customChars = ref<Character[]>([])

const allChars = computed(() => [...DEFAULT_CHARACTERS, ...customChars.value])

function handleAdd() {
  const id = customId.value.trim()
  if (!id) return
  if (allChars.value.some(c => c.id === id)) return
  const name = `Custom (${id.slice(0, 6)}...)`
  customChars.value = [...customChars.value, { id, name }]
  customId.value = ''
  adding.value = false
}
</script>

<template>
  <div class="character-list">
    <h3>Characters</h3>
    <!--
      Until a character is picked there is nothing to render and every other
      control is inert, which reads as a broken page rather than a first step.
      The pulse stops the moment one is chosen — it points at what to do next,
      so it has no reason to keep running afterwards.
    -->
    <div :class="['character-items', { 'needs-pick': props.empty }]">
      <button
        v-for="c in allChars"
        :key="c.id"
        :class="['character-item', { loading: props.loadingId === c.id }]"
        :disabled="props.loadingId !== null"
        @click="emit('select', c.id, c.name)"
      >
        <span class="character-avatar">{{ c.name.charAt(0) }}</span>
        <span class="character-name">{{ c.name }}</span>
        <span v-if="props.loadingId === c.id" class="character-progress">
          {{ Math.round(props.loadProgress * 100) }}%
        </span>
      </button>

      <div v-if="adding" class="custom-id-input">
        <input
          v-model="customId"
          @keydown.enter="handleAdd"
          placeholder="Paste character ID"
          autofocus
        />
        <div class="custom-id-actions">
          <button
            class="primary"
            :disabled="!customId.trim() || props.loadingId !== null"
            @click="handleAdd"
          >
            Add
          </button>
          <button class="secondary" @click="adding = false; customId = ''">Cancel</button>
        </div>
      </div>
      <button v-else class="character-item add-btn" @click="adding = true">
        <span class="character-avatar add-avatar">+</span>
        <span class="character-name">Custom ID</span>
      </button>
    </div>

    <a class="guide-thumb list-guide" :href="DASH_URL" target="_blank" rel="noreferrer">
      <img src="/public-avatar-guide.png" alt="Where to find character IDs" />
    </a>
  </div>
</template>

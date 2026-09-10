import { ref } from 'vue'

export interface ToastMessage {
  id: number
  text: string
}

export function useToast() {
  const messages = ref<ToastMessage[]>([])
  let nextId = 0

  function push(text: string) {
    if (!text) return
    // The SDK can report the same error on every frame; repeating it would
    // bury the panel under identical notices.
    if (messages.value.some(m => m.text === text)) return
    messages.value = [...messages.value, { id: nextId++, text }]
  }

  function dismiss(id: number) {
    messages.value = messages.value.filter(m => m.id !== id)
  }

  return { messages, push, dismiss }
}

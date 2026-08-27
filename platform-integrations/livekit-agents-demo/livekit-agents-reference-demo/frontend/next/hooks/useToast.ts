import { useCallback, useRef, useState } from 'react'
import type { ToastKind, ToastMessage } from '../components/Toast'

export function useToast() {
  const [messages, setMessages] = useState<ToastMessage[]>([])
  const nextId = useRef(0)

  const push = useCallback((text: string, kind: ToastKind = 'error') => {
    if (!text) return
    setMessages(prev => {
      // The SDK can report the same error on every frame; repeating it would
      // bury the panel under identical notices.
      if (prev.some(m => m.text === text)) return prev
      return [...prev, { id: nextId.current++, kind, text }]
    })
  }, [])

  const dismiss = useCallback((id: number) => {
    setMessages(prev => prev.filter(m => m.id !== id))
  }, [])

  return { messages, push, dismiss }
}

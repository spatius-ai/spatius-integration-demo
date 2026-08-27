import { useEffect } from 'react'

export type ToastKind = 'error' | 'warning'

export interface ToastMessage {
  id: number
  kind: ToastKind
  text: string
}

interface Props {
  messages: ToastMessage[]
  onDismiss: (id: number) => void
}

const AUTO_DISMISS_MS = 5000

/**
 * Floating notices for things a reader would otherwise only find in the
 * console — SDK errors and "you have to connect first" style guidance.
 */
export default function Toast({ messages, onDismiss }: Props) {
  useEffect(() => {
    if (messages.length === 0) return
    const timers = messages.map(m => setTimeout(() => onDismiss(m.id), AUTO_DISMISS_MS))
    return () => timers.forEach(clearTimeout)
  }, [messages, onDismiss])

  if (messages.length === 0) return null

  return (
    <div className="toast-stack">
      {messages.map(m => (
        <div key={m.id} className={`toast toast-${m.kind}`} role="alert">
          <span className="toast-text">{m.text}</span>
          <button
            className="toast-close"
            onClick={() => onDismiss(m.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

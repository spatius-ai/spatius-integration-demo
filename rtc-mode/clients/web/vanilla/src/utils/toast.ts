export type ToastKind = 'error' | 'warning'

const AUTO_DISMISS_MS = 5000
const STACK_ID = 'toast-stack'

function ensureStack(): HTMLElement {
  let stack = document.getElementById(STACK_ID)
  if (!stack) {
    stack = document.createElement('div')
    stack.id = STACK_ID
    stack.className = 'toast-stack'
    document.body.appendChild(stack)
  }
  return stack
}

/**
 * Floating notice for things a reader would otherwise only find in the console
 * — SDK errors and "you have to connect first" style guidance.
 */
export function pushToast(text: string, kind: ToastKind = 'error') {
  if (!text) return
  const stack = ensureStack()

  // The SDK can report the same error repeatedly; one notice is enough.
  const existing = Array.from(stack.querySelectorAll('.toast-text'))
  if (existing.some(el => el.textContent === text)) return

  const toast = document.createElement('div')
  toast.className = `toast toast-${kind}`
  toast.setAttribute('role', 'alert')

  const label = document.createElement('span')
  label.className = 'toast-text'
  label.textContent = text

  const close = document.createElement('button')
  close.className = 'toast-close'
  close.setAttribute('aria-label', 'Dismiss')
  close.textContent = '×'

  const remove = () => {
    clearTimeout(timer)
    toast.remove()
  }
  close.addEventListener('click', remove)
  const timer = setTimeout(remove, AUTO_DISMISS_MS)

  toast.appendChild(label)
  toast.appendChild(close)
  stack.appendChild(toast)
}

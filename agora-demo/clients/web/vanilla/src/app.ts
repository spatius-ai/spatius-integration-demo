import { createRoom } from './views/room'
import { fetchConfig, type ServerConfig } from './utils/rtcSession'

/**
 * Straight into the room.
 *
 * There is no configuration step: every setting this demo has — the Spatius and Agora
 * credentials, the conversation language, the voice — lives in the server's `.env`,
 * and the server refuses to start while one is missing. All this has to do first is
 * ask the server what the default avatar is, which also tells it the server is up.
 */
export function createApp(root: HTMLElement) {
  const app = document.createElement('div')
  app.className = 'app'
  root.appendChild(app)

  function showError(message: string) {
    app.className = 'app boot-error'
    app.innerHTML = `
      <h1>Cannot reach the demo server</h1>
      <p data-message></p>
      <p class="boot-hint">
        Start it with <code>uv run python server.py</code> in
        <code>servers/python</code>, then try again.
      </p>
      <button class="primary" data-retry>Retry</button>
    `
    // Set as text rather than interpolated: the message can carry the server's own
    // wording, and markup in it would land in the page.
    app.querySelector<HTMLElement>('[data-message]')!.textContent = message
    app.querySelector<HTMLButtonElement>('[data-retry]')!.onclick = () => void load()
  }

  function showRoom(config: ServerConfig) {
    app.className = 'app'
    app.innerHTML = ''
    app.appendChild(createRoom(config))
  }

  async function load() {
    app.className = 'app'
    app.innerHTML = ''
    try {
      showRoom(await fetchConfig())
    } catch (e: any) {
      showError(e?.message ?? 'Cannot reach the demo server')
    }
  }

  void load()
}

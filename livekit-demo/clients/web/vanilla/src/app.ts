import { createRoom } from './views/room'
import { fetchConfig, initializeSdk } from './utils/rtcSession'

/**
 * The app boots straight into the room.
 *
 * There is no configuration step: every credential and every setting — language,
 * voice, model — lives in the server's `.env`, and the server refuses to start
 * without them. All this page needs is the App ID to initialize the SDK with, which
 * it fetches on load; the only thing the user chooses is a character.
 */
export function createApp(root: HTMLElement) {
  const app = document.createElement('div')
  app.className = 'app'
  root.appendChild(app)

  function showError(message: string) {
    app.className = 'app boot-error'
    app.innerHTML = `
      <div class="boot-error-box">
        <h1>Cannot start</h1>
        <p data-message></p>
        <p class="boot-error-hint">
          Start the demo server (<code>servers/python</code>) and check its terminal:
          it prints any key still missing from <code>.env</code> and exits.
        </p>
        <button class="primary" data-retry>Retry</button>
      </div>
    `
    // textContent rather than innerHTML: the message comes back from the server.
    app.querySelector<HTMLElement>('[data-message]')!.textContent = message
    app.querySelector<HTMLButtonElement>('[data-retry]')!.onclick = () => void boot()
  }

  async function boot() {
    app.className = 'app'
    app.innerHTML = ''
    try {
      const config = await fetchConfig()
      // Initialized here rather than at the first click: the SDK reads the App ID
      // only at initialize time, and doing it once on the way in keeps the first
      // character selection from paying for it.
      await initializeSdk(config.appId)
      app.appendChild(createRoom())
    } catch (e: any) {
      showError(e?.message ?? 'Could not reach the demo server')
    }
  }

  void boot()
}

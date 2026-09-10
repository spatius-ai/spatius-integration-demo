import { AvatarSDK, DrivingServiceMode, LogLevel } from '@spatius/avatarkit'
import { fetchConfig } from './utils/backendClient'
import { createPlayground } from './views/playground'

const MODE = DrivingServiceMode.backend

/**
 * The whole boot path.
 *
 * There is nothing to ask the user: in Backend Mode the server holds the Motion
 * Server connection and every credential with it, so this client reads what it needs
 * to render — app id, region, sample rates, the avatar to open with — from
 * `/api/config` and initializes the SDK with it. No session token is involved; this
 * SDK instance only renders what arrives over the WebSocket.
 */
export function createApp(root: HTMLElement) {
  const app = document.createElement('div')
  app.className = 'app'
  root.appendChild(app)

  function showBoot(body: (box: HTMLElement) => void) {
    app.className = 'app boot-state'
    app.innerHTML = ''
    const box = document.createElement('div')
    box.className = 'boot-box'
    body(box)
    app.appendChild(box)
  }

  function showStarting() {
    showBoot((box) => {
      const hint = document.createElement('p')
      hint.className = 'boot-hint'
      hint.textContent = 'Starting…'
      box.appendChild(hint)
    })
  }

  function showError(message: string) {
    showBoot((box) => {
      box.innerHTML = `
        <h1>Cannot reach the Backend Mode server</h1>
        <p class="boot-error"></p>
        <p class="boot-hint">
          Start it with <code>cd servers/python &amp;&amp; uv run python -m app.main</code>.
          It reads every credential from its own <code>.env</code> and reports any
          that is missing.
        </p>
      `
      // textContent rather than into the template: the message comes from a failed
      // fetch and may carry a URL or angle brackets.
      box.querySelector('.boot-error')!.textContent = message
      const retry = document.createElement('button')
      retry.className = 'primary'
      retry.textContent = 'Retry'
      retry.addEventListener('click', () => void boot())
      box.appendChild(retry)
    })
  }

  async function boot() {
    showStarting()
    try {
      const config = await fetchConfig()
      await AvatarSDK.initialize(config.appId, {
        // The Web SDK picks its region when none is given, so `auto` is passed as an omission.
        ...(config.region && config.region !== 'auto' ? { region: config.region } : {}),
        drivingServiceMode: MODE,
        audioFormat: { channelCount: 1, sampleRate: config.inputSampleRate },
        logLevel: LogLevel.all,
      })
      app.className = 'app'
      app.innerHTML = ''
      app.appendChild(createPlayground(config))
    } catch (e: any) {
      showError(e?.message ?? 'Could not start')
    }
  }

  void boot()
}

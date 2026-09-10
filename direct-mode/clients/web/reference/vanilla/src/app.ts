import { AvatarSDK, DrivingServiceMode, LogLevel } from '@spatius/avatarkit'
import { fetchConfig, fetchSessionToken } from '@direct-core'
import { createPlayground } from './views/playground'

const MODE = DrivingServiceMode.direct

/**
 * Boot, then hand over to the playground.
 *
 * There is no configuration screen: everything the SDK needs — the App ID, the
 * region, the avatar — comes from the server's `/api/config`, and the Session Token
 * is minted there too. This is the whole of the credential path in a Direct Mode
 * app, and it is four lines.
 */
export function createApp(root: HTMLElement) {
  const app = document.createElement('div')
  app.className = 'app boot'
  root.appendChild(app)

  function showStatus(text: string) {
    app.className = 'app boot'
    app.innerHTML = ''
    const status = document.createElement('div')
    status.className = 'boot-status'
    status.textContent = text
    app.appendChild(status)
  }

  function showError(message: string) {
    app.className = 'app boot'
    app.innerHTML = `
      <div class="boot-error">
        <h1>Cannot start</h1>
        <p></p>
        <p class="boot-hint">
          Check that the Direct Mode server is running and that its <code>.env</code>
          is filled in.
        </p>
        <button class="primary" data-retry>Retry</button>
      </div>
    `
    // Assigned rather than interpolated: the message comes from a server response,
    // and dropping it into innerHTML would run whatever markup it happens to hold.
    app.querySelector('.boot-error p')!.textContent = message
    app.querySelector<HTMLButtonElement>('[data-retry]')!.addEventListener('click', () => void boot())
  }

  async function boot() {
    showStatus('Connecting to the Direct Mode server…')
    try {
      const backend = await fetchConfig()
      const session = await fetchSessionToken()
      await AvatarSDK.initialize(backend.appId, {
        // Omitting region entirely is what triggers the SDK's automatic pick, so `auto`
        // from the server is passed as an omission.
        ...(backend.region && backend.region !== 'auto' ? { region: backend.region } : {}),
        drivingServiceMode: MODE,
        audioFormat: { channelCount: 1, sampleRate: backend.sampleRate },
        logLevel: LogLevel.all,
      })
      AvatarSDK.setSessionToken(session.sessionToken)

      app.className = 'app'
      app.innerHTML = ''
      app.appendChild(createPlayground(backend))
    } catch (e: any) {
      showError(e?.message ?? 'Could not reach the Direct Mode server')
    }
  }

  void boot()
}

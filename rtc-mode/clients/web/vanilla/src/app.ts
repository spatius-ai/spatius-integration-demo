import { createConfiguration, type AppConfig } from './views/configuration'
import { createRoom } from './views/room'

export function createApp(root: HTMLElement) {
  let config: AppConfig | null = null

  const app = document.createElement('div')
  app.className = 'app'
  root.appendChild(app)

  function render() {
    app.innerHTML = ''

    const v1 = document.createElement('div')
    v1.className = `view ${config ? '' : 'active'}`
    v1.appendChild(
      createConfiguration((c) => {
        config = c
        render()
      }),
    )
    app.appendChild(v1)

    const v2 = document.createElement('div')
    v2.className = `view ${config ? 'active' : ''}`
    if (config) v2.appendChild(createRoom(config))
    app.appendChild(v2)
  }

  render()
}

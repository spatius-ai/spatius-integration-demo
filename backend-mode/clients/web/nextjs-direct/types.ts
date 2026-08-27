/**
 * The shapes the two views pass between each other.
 *
 * In their own file rather than beside the page component: the page defers the
 * whole app through `next/dynamic` to keep the SDK out of the server pass, and a
 * component importing its types back from that module would close a cycle through
 * the very import being deferred.
 */

/**
 * Which scene the playground opens in. Both are driven server-side and reach this
 * client as the same audio + motion messages — they differ only in where the audio
 * came from.
 */
export type Scene = 'sample' | 'realtime'

/** Which language the realtime conversation runs in. */
export type Lang = 'en' | 'zh'

export interface AppConfig {
  appId: string
  region: string
  scene: Scene
  /**
   * Recognition, synthesis and the agent's persona all follow this, and all three
   * are fixed when the agent session is built — which is why it is chosen here
   * rather than switched inside the scene.
   */
  language: Lang
  /** Only the realtime scene reaches an agent, so this is absent for the other. */
  livekit?: {
    url: string
    apiKey: string
    apiSecret: string
  }
}

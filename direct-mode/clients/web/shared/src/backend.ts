/**
 * The Direct Mode backend, as the client sees it.
 *
 * Direct Mode clients hold no credentials and no configuration of their own: the App
 * ID, the avatar, the region and the agent's address all arrive from here, and the
 * Session Token is minted server-side. That is the whole reason this mode needs a
 * backend — `SPATIUS_API_KEY` must never reach a browser.
 */

/**
 * Where the backend lives. Same host as the page, on the token server's port.
 *
 * Read through a function rather than fixed at module load: Next.js prerenders
 * these components on the server, where there is no `location` to read, and a
 * top-level evaluation fails the build outright. Every call site here runs in
 * response to a user action, so by then there is always a document.
 */
export function backendUrl(): string {
  // Both build systems' env objects, reached without naming either's globals:
  // this file is compiled by Vite in three clients and by Next in two, and a bare
  // `process` fails to typecheck wherever @types/node is not installed.
  const viteEnv = (import.meta as any).env
  const nodeEnv = (globalThis as any).process?.env
  const configured =
    viteEnv?.VITE_DIRECT_MODE_URL ?? nodeEnv?.NEXT_PUBLIC_DIRECT_MODE_URL
  if (configured) return configured
  if (typeof location === 'undefined') {
    throw new Error('The backend URL is only resolvable in the browser')
  }
  return `${location.protocol}//${location.hostname}:8090`
}

/** Everything a client needs to boot. No secrets: the server keeps those. */
export interface BackendConfig {
  /** Passed to `AvatarSDK.initialize()`. Identifies the app; authorizes nothing. */
  appId: string
  /** The avatar the server is configured for, offered first in the character list. */
  avatarId: string
  region: string
  /** PCM16 mono, the rate both the SDK and the agent are pinned to. */
  sampleRate: number
  /** Where the agent's WebSocket lives. */
  realtimeUrl: string
}

export async function fetchConfig(): Promise<BackendConfig> {
  const res = await fetch(`${backendUrl()}/api/config`)
  if (!res.ok) throw new Error(`Cannot reach the Direct Mode server (HTTP ${res.status})`)
  return (await res.json()) as BackendConfig
}

export interface SessionToken {
  sessionToken: string
  expiredAt: string
  avatarId: string
  region: string
}

/**
 * Mint a token for this session.
 *
 * Short-lived — under an hour — so a page left open long enough has to ask again. The
 * SDK reads it at connect time, so re-minting means reconnecting. The API Key it is
 * exchanged for lives in the server's `.env` and is never sent from here.
 */
export async function fetchSessionToken(): Promise<SessionToken> {
  const res = await fetch(`${backendUrl()}/api/session-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const body = await res.text()
  if (!res.ok) {
    try {
      const parsed = JSON.parse(body)
      throw new Error(parsed.message || parsed.error || body)
    } catch (err) {
      if (err instanceof Error && err.message !== body) throw err
      throw new Error(`Session token request failed (HTTP ${res.status})`)
    }
  }
  return JSON.parse(body) as SessionToken
}

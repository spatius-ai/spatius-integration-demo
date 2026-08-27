/**
 * The Direct Mode backend, as the client sees it.
 *
 * Direct Mode clients hold no credentials: the App ID, the avatar and the region all
 * arrive from here, and the Session Token is minted server-side. That is the whole
 * reason this mode needs a backend — `SPATIUS_API_KEY` must never reach a browser.
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

export interface BackendConfig {
  /** Credentials already saved on the server, blank when nothing is stored yet. */
  SPATIUS_APP_ID?: string
  SPATIUS_API_KEY?: string
  SPATIUS_AVATAR_ID?: string
  SPATIUS_REGION?: string
  LIVEKIT_URL?: string
  LIVEKIT_API_KEY?: string
  LIVEKIT_API_SECRET?: string

  avatarId: string
  region: string
  sampleRate: number
  /** Where the realtime scene's WebSocket lives. */
  realtimeUrl: string
  /**
   * Which credentials are still missing, per scene. The sample-audio scene needs only
   * the Spatius pair, so it can run while the realtime one is still unconfigured —
   * worth telling the user rather than failing at the click.
   */
  missing: { sample: string[]; realtime: string[] }
}

export async function fetchConfig(): Promise<BackendConfig> {
  const res = await fetch(`${backendUrl()}/api/config`)
  if (!res.ok) throw new Error(`Cannot reach the Direct Mode server (HTTP ${res.status})`)
  return (await res.json()) as BackendConfig
}

/**
 * Save credentials to the server's `.env`, so the next visit starts with them
 * already filled in.
 *
 * One stored copy rather than per-browser state: a phone has no `.env` to edit and
 * no shared localStorage, so entering an API key there once should be enough — and
 * whichever client saves it, the rest pick it up.
 *
 * Blank values are ignored rather than erasing what is stored.
 */
export async function saveConfig(values: Record<string, string>): Promise<void> {
  const res = await fetch(`${backendUrl()}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  })
  if (!res.ok) throw new Error(`Could not save configuration (HTTP ${res.status})`)
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
 * SDK reads it at connect time, so re-minting means reconnecting.
 *
 * @param apiKey the key to exchange. Sent from the page only because this is a demo
 *               you can drive without editing files; leave it out and the server uses
 *               the one in its own `.env`, which is what a real deployment does.
 */
export async function fetchSessionToken(apiKey?: string): Promise<SessionToken> {
  const res = await fetch(`${backendUrl()}/api/session-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(apiKey ? { apiKey } : {}),
  })
  const body = await res.text()
  if (!res.ok) {
    // The backend answers a missing .env with a structured body naming the keys.
    // Surfacing that beats "HTTP 500", which is the first thing every reader hits.
    try {
      const parsed = JSON.parse(body)
      if (parsed.missingKeys?.length) {
        throw new Error(`Server is missing: ${parsed.missingKeys.join(', ')}`)
      }
      throw new Error(parsed.message || parsed.error || body)
    } catch (err) {
      if (err instanceof Error && err.message !== body) throw err
      throw new Error(`Session token request failed (HTTP ${res.status})`)
    }
  }
  return JSON.parse(body) as SessionToken
}

/** The clip the sample-audio scene plays, served by the backend so all clients share one. */
export async function fetchSampleAudio(): Promise<ArrayBuffer> {
  const res = await fetch(`${backendUrl()}/api/sample-audio`)
  if (!res.ok) throw new Error(`Failed to load the sample clip (HTTP ${res.status})`)
  return res.arrayBuffer()
}

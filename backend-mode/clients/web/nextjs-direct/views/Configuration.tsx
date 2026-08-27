'use client'

import { useState, useEffect } from 'react'
import {
  AvatarSDK,
  DrivingServiceMode,
    LogLevel,
} from '@spatius/avatarkit'
import { fetchConfig, saveConfig } from '@/utils/backendClient'
import type { AppConfig, Lang, Scene } from '@/types'

const DASH_URL = 'https://app.spatius.ai'
const LIVEKIT_URL = 'https://cloud.livekit.io'

interface Props {
  mode: DrivingServiceMode
  onInitialized: (config: AppConfig) => void
}

const STORAGE_KEY = 'avatarkit-playground-config'

interface CachedConfig {
  appId?: string
  language?: Lang
  apiKey?: string
  env?: string
  scene?: Scene
  livekitUrl?: string
  livekitKey?: string
  livekitSecret?: string
}

function loadCached(): CachedConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as CachedConfig
  } catch { /* ignore */ }
  return {}
}

function saveCache(config: CachedConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch { /* ignore */ }
}

const REGIONS = ['auto', 'us-west', 'cn-beijing'] as const

// 'auto' lets the SDK pick the closest serving region at initialize time.
function normalizeRegion(env?: string) {
  return REGIONS.includes(env as typeof REGIONS[number]) ? env! : 'auto'
}

export default function Configuration({ mode, onInitialized }: Props) {
  // Reading localStorage during render breaks under SSR: the server renders
  // empty values, and hydration keeps that state even though the inputs look
  // filled — leaving the submit button disabled on a return visit.
  const [appId, setAppId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [env, setEnv] = useState<string>('auto')

  // Which scene to open. Both drive the avatar the same way — the difference is
  // where the audio comes from, and the realtime one needs an agent to produce it.
  const [scene, setScene] = useState<Scene>('sample')
  const [language, setLanguage] = useState<Lang>('en')
  const [livekitUrl, setLivekitUrl] = useState('')
  const [livekitKey, setLivekitKey] = useState('')
  const [livekitSecret, setLivekitSecret] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Which scene was last open is this browser's own business, so it stays local.
    const cached = loadCached()
    if (cached.scene) setScene(cached.scene)
    if (cached.language) setLanguage(cached.language)
    setEnv(normalizeRegion(cached.env))

    // Credentials come from the server, which holds the one shared copy — saved
    // from any client, including a phone that has no .env to edit. localStorage
    // only fills in what the server has not got.
    let cancelled = false
    fetchConfig()
      .then((saved) => {
        if (cancelled) return
        setAppId(saved.SPATIUS_APP_ID || cached.appId || '')
        setApiKey(saved.SPATIUS_API_KEY || cached.apiKey || '')
        setLivekitUrl(saved.LIVEKIT_URL || cached.livekitUrl || '')
        setLivekitKey(saved.LIVEKIT_API_KEY || cached.livekitKey || '')
        setLivekitSecret(saved.LIVEKIT_API_SECRET || cached.livekitSecret || '')
        if (saved.SPATIUS_REGION) setEnv(normalizeRegion(saved.SPATIUS_REGION))
      })
      .catch(() => {
        // The server being down is not worth an error here — the fields still work,
        // and Initialize reports it properly if it is still down by then.
        if (cancelled) return
        setAppId(cached.appId || '')
        setApiKey(cached.apiKey || '')
        setLivekitUrl(cached.livekitUrl || '')
        setLivekitKey(cached.livekitKey || '')
        setLivekitSecret(cached.livekitSecret || '')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const isRealtime = scene === 'realtime'
  // The realtime scene needs an agent to answer with, so LiveKit's three come on
  // top of the API Key. The sample scene plays a bundled clip and needs none.
  const canInit =
    Boolean(appId.trim() && apiKey.trim()) &&
    (!isRealtime || Boolean(livekitUrl.trim() && livekitKey.trim() && livekitSecret.trim()))

  const handleInit = async () => {
    if (!canInit) return
    setLoading(true)
    setError(null)
    try {
      // Save before connecting, not after: these were typed one field at a time,
      // and a failure past this point should not mean entering them all again.
      // A failed save is not worth blocking on — it only costs the prefill.
      await saveConfig({
        SPATIUS_APP_ID: appId.trim(),
        SPATIUS_API_KEY: apiKey.trim(),
        SPATIUS_REGION: env === 'auto' ? '' : env,
        ...(isRealtime
          ? {
              LIVEKIT_URL: livekitUrl.trim(),
              LIVEKIT_API_KEY: livekitKey.trim(),
              LIVEKIT_API_SECRET: livekitSecret.trim(),
            }
          : {}),
      }).catch((e) => console.warn('[config] save failed', e))

      // No session token here: in Backend Mode the server holds the Motion Server
      // connection, so this SDK instance only renders what arrives over the
      // WebSocket and never authenticates against Spatius itself.
      await AvatarSDK.initialize(appId.trim(), {
        // Omitting region entirely is what triggers the SDK's automatic pick.
        ...(env === 'auto' ? {} : { region: env }),
        drivingServiceMode: mode,
        audioFormat: { channelCount: 1, sampleRate: 16000 },
        logLevel: LogLevel.all,
      })
      saveCache({
        appId: appId.trim(),
        apiKey: apiKey.trim(),
        env,
        scene,
        language,
        livekitUrl: livekitUrl.trim(),
        livekitKey: livekitKey.trim(),
        livekitSecret: livekitSecret.trim(),
      })
      onInitialized({
        appId: appId.trim(),
        region: env,
        scene,
        language,
        livekit: isRealtime
          ? {
              url: livekitUrl.trim(),
              apiKey: livekitKey.trim(),
              apiSecret: livekitSecret.trim(),
            }
          : undefined,
      })
    } catch (e: any) {
      setError(e.message || 'Initialization failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="config-view">
      <div className="config-layout">
        <div className="config-container">
          <h1>AvatarKit Backend Mode Demo</h1>
          <p className="config-subtitle">
            The server drives the avatar and streams it here. Pick where its audio
            comes from.
          </p>

          <div className="config-form">
            {/*
              The scene goes first: it decides which fields follow. Asking for
              credentials before knowing which are needed would show LiveKit's three
              to everyone, most of whom never open the realtime scene.
            */}
            <div className="field">
              <label>Scene</label>
              <div className="scene-toggle">
                <button
                  type="button"
                  className={!isRealtime ? 'on' : ''}
                  onClick={() => setScene('sample')}
                >
                  <strong>Pre-recorded audio</strong>
                  <span>Play a bundled clip</span>
                </button>
                <button
                  type="button"
                  className={isRealtime ? 'on' : ''}
                  onClick={() => setScene('realtime')}
                >
                  <strong>Realtime audio</strong>
                  <span>Talk to the avatar</span>
                </button>
              </div>
            </div>

            <div className="field">
              <label>App ID <span className="required">*</span></label>
              <input
                value={appId}
                onChange={e => setAppId(e.target.value)}
                placeholder="app_xxx"
                spellCheck={false}
              />
              <span className="field-hint">
                Passed to <code>AvatarSDK.initialize()</code>. Find it on the{' '}
                <a href={DASH_URL} target="_blank" rel="noreferrer">
                  Developer Platform
                </a>
                .
              </span>
            </div>

            {/*
              The API Key, not a Session Token: the server exchanges it for one on
              every connect, so a token that expired while the page sat open renews
              itself instead of having to be pasted again.
            */}
            <div className="field">
              <label>API Key <span className="required">*</span></label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-..."
                spellCheck={false}
              />
              <span className="field-hint">
                Held by the server, which uses it to drive the avatar — it is never
                sent to this page. Entering it here is a convenience of the demo; in
                your own app it belongs in the server's own configuration.
              </span>
            </div>

            <div className="field">
              <label>Region</label>
              <select value={env} onChange={e => setEnv(e.target.value)}>
                {REGIONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            {/*
              Only the realtime scene reaches an agent, so these appear with it rather
              than sitting empty and required-looking for everyone else.
            */}
            {/*
              Chosen here rather than inside the scene: recognition, synthesis and
              the persona are all fixed when the agent session is built, so this is
              not something that can be switched on a running conversation. Get it
              wrong and speech is transcribed as the other language — the avatar
              then answers something nobody said.
            */}
            {isRealtime && (
              <div className="field">
                <label>Conversation language</label>
                <div className="scene-toggle lang-toggle">
                  <button
                    type="button"
                    className={language === 'en' ? 'on' : ''}
                    onClick={() => setLanguage('en')}
                  >
                    <strong>English</strong>
                  </button>
                  <button
                    type="button"
                    className={language === 'zh' ? 'on' : ''}
                    onClick={() => setLanguage('zh')}
                  >
                    <strong>中文</strong>
                  </button>
                </div>
                <span className="field-hint">
                  Sets speech recognition, the voice, and the assistant's persona.
                </span>
              </div>
            )}

            {isRealtime && (
              <div className="field-group">
                <h2 className="group-title">LiveKit</h2>
                <p className="group-hint">
                  Runs the conversation. Models go through LiveKit Inference, so no
                  OpenAI or Deepgram account of your own is needed.
                </p>

                <div className="field">
                  <label>Server URL <span className="required">*</span></label>
                  <input
                    value={livekitUrl}
                    onChange={e => setLivekitUrl(e.target.value)}
                    placeholder="wss://your-project.livekit.cloud"
                    spellCheck={false}
                  />
                </div>

                <div className="field">
                  <label>API Key <span className="required">*</span></label>
                  <input
                    value={livekitKey}
                    onChange={e => setLivekitKey(e.target.value)}
                    placeholder="APIxxxxxxxx"
                    spellCheck={false}
                  />
                </div>

                <div className="field">
                  <label>API Secret <span className="required">*</span></label>
                  <input
                    type="password"
                    value={livekitSecret}
                    onChange={e => setLivekitSecret(e.target.value)}
                    placeholder="Your API secret"
                    spellCheck={false}
                  />
                  <span className="field-hint">
                    Shown only once, at creation — copy it there and then.
                  </span>
                </div>
              </div>
            )}

            {error && <div className="config-error">{error}</div>}

            <button
              className="primary init-btn"
              disabled={!canInit || loading}
              onClick={handleInit}
            >
              {loading ? 'Initializing...' : 'Initialize SDK'}
            </button>
          </div>
        </div>

        {/*
          One guide per credential set, stacked in the order the fields are asked for.
          The Spatius one is always there; LiveKit's is added by the realtime scene
          rather than replacing it, since that scene needs both.
        */}
        <div className="config-guides">
          <a className="config-guide" href={DASH_URL} target="_blank" rel="noreferrer">
            <img src="/api-key-guide.png" alt="Where to find your App ID and Token" />
            <span className="guide-caption">App ID and Session Token</span>
          </a>

          {isRealtime && (
            <a className="config-guide" href={LIVEKIT_URL} target="_blank" rel="noreferrer">
              {/* Two steps: open Settings, then look at API keys. */}
              <div className="guide-shots">
                <img src="/livekit-guide-1.jpg" alt="LiveKit Cloud: open project settings" />
                <img src="/livekit-guide-2.jpg" alt="LiveKit Cloud: API keys" />
              </div>
              <span className="guide-caption">LiveKit URL, API Key and Secret</span>
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

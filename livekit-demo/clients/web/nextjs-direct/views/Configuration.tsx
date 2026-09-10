'use client'

import { useState, useEffect, useRef } from 'react'
import { fetchConfig, saveConfig } from '@/utils/rtcSession'
import { VOICE_OPTIONS, DEFAULT_VOICE, VoicePreview } from '@/data/voices'
import type { AppConfig, Lang } from '@/types'

const DASH_URL = 'https://app.spatius.ai'
const LIVEKIT_URL = 'https://cloud.livekit.io'
const STORAGE_KEY = 'avatarkit-livekit-demo-config'

interface Props {
  onReady: (config: AppConfig) => void
}

export default function Configuration({ onReady }: Props) {
  const [appId, setAppId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [livekitUrl, setLivekitUrl] = useState('')
  const [livekitKey, setLivekitKey] = useState('')
  const [livekitSecret, setLivekitSecret] = useState('')
  const [voice, setVoice] = useState(DEFAULT_VOICE)
  const [playing, setPlaying] = useState('')
  const [language, setLanguage] = useState<Lang>('en')
  const [avatarId, setAvatarId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // One player for the whole page, so switching voices displaces rather than overlaps.
  const preview = useRef(new VoicePreview())
  // Stopped on the way out: leaving the page mid-sample would otherwise keep playing
  // over the room it just entered.
  useEffect(() => () => preview.current.stop(), [])

  // Switching the conversation language switches which recording each play button
  // reaches for, so anything mid-sample is now the wrong language and is cut off.
  useEffect(() => {
    preview.current.stop()
    setPlaying('')
  }, [language])

  useEffect(() => {
    // Which language was last picked is this browser's own business, so it stays
    // local; the credentials come from the server, which holds the one shared copy.
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const cached = JSON.parse(raw)
        if (cached.language === 'en' || cached.language === 'zh') setLanguage(cached.language)
      }
    } catch { /* ignore */ }

    let cancelled = false
    fetchConfig()
      .then(saved => {
        if (cancelled) return
        setAppId(saved.SPATIUS_APP_ID || '')
        setApiKey(saved.SPATIUS_API_KEY || '')
        setLivekitUrl(saved.LIVEKIT_URL || '')
        setLivekitKey(saved.LIVEKIT_API_KEY || '')
        setLivekitSecret(saved.LIVEKIT_API_SECRET || '')
        setVoice(saved.TTS_MODEL || DEFAULT_VOICE)
        setAvatarId(saved.avatarId || '')
      })
      .catch(() => {
        // A server that is down is not worth an error here — Enter reports it
        // properly if it is still down by then.
      })
    return () => { cancelled = true }
  }, [])

  const canEnter = Boolean(
    appId.trim() &&
      apiKey.trim() &&
      livekitUrl.trim() &&
      livekitKey.trim() &&
      livekitSecret.trim(),
  )

  const handleEnter = async () => {
    if (!canEnter) return
    setSaving(true)
    setError(null)
    try {
      // Saved before entering, not after: these were typed one field at a time, and
      // a failure past this point should not mean entering them all again.
      await saveConfig({
        SPATIUS_APP_ID: appId.trim(),
        SPATIUS_API_KEY: apiKey.trim(),
        LIVEKIT_URL: livekitUrl.trim(),
        LIVEKIT_API_KEY: livekitKey.trim(),
        LIVEKIT_API_SECRET: livekitSecret.trim(),
        TTS_MODEL: voice,
      })
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ language }))
      } catch { /* ignore */ }
      onReady({ language, avatarId })
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the configuration')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="config-view">
      <div className="config-layout">
        <div className="config-container">
          <h1>AvatarKit LiveKit Demo</h1>
          <p className="config-subtitle">
            The avatar joins the call itself — audio and motion both arrive over the
            LiveKit room, and nothing streams through the server.
          </p>

          <div className="config-form">
            <div className="field">
              <label>App ID <span className="required">*</span></label>
              <input
                value={appId}
                onChange={e => setAppId(e.target.value)}
                placeholder="app_xxx"
                spellCheck={false}
              />
              <span className="field-hint">
                Find it on the{' '}
                <a href={DASH_URL} target="_blank" rel="noreferrer">Developer Platform</a>.
              </span>
            </div>

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
                Held by the server, which the avatar uses to join the room — it never
                reaches this page in use. Entering it here is a convenience of the demo.
              </span>
            </div>

            {/*
              Recognition, synthesis and the persona are all fixed when the agent
              session is built, so this is chosen here rather than switched inside
              the room.
            */}
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

            <div className="field-group">
              <h2 className="group-title">LiveKit</h2>
              <p className="group-hint">
                Carries the call. Models go through LiveKit Inference, so no OpenAI or
                Deepgram account of your own is needed.
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

              {/*
                The voice. These are LiveKit Inference model names, and each has a
                sample recorded from it — the model name says nothing about how it
                reads, so picking one blind is guesswork.
              */}
              <div className="field">
                <label>Voice</label>
                <div className="voice-list">
                  {VOICE_OPTIONS.map(option => (
                    <label
                      key={option.value}
                      className={`voice-option${voice === option.value ? ' on' : ''}`}
                    >
                      <input
                        type="radio"
                        name="voice"
                        value={option.value}
                        checked={voice === option.value}
                        onChange={() => setVoice(option.value)}
                      />
                      <span className="voice-name">
                        {option.value}
                        <em>{option.voice === 'male' ? 'male' : 'female'}</em>
                        {option.note === 'cantonese' && <em>Cantonese</em>}
                      </span>
                      {/* A button rather than part of the label: hearing a voice
                          should not also select it. */}
                      <button
                        type="button"
                        className="voice-play"
                        aria-label={playing === option.value ? 'Stop' : 'Preview'}
                        onClick={e => {
                          e.preventDefault()
                          preview.current.toggle(option, language, setPlaying)
                        }}
                      >
                        {playing === option.value ? '■' : '▶'}
                      </button>
                    </label>
                  ))}
                </div>
                <span className="field-hint">
                  Samples play in the conversation language selected above. The accent
                  comes from the voice rather than that setting, so a model that reads
                  one language well may carry an accent into the other — which is what
                  there is to listen for.
                </span>
              </div>
            </div>

            {error && <div className="config-error">{error}</div>}

            <button
              className="primary init-btn"
              disabled={!canEnter || saving}
              onClick={handleEnter}
            >
              {saving ? 'Saving…' : 'Enter the room'}
            </button>
          </div>
        </div>

        <div className="config-guides">
          <a className="config-guide" href={DASH_URL} target="_blank" rel="noreferrer">
            <img src="/api-key-guide.png" alt="Where to find your App ID and API Key" />
            <span className="guide-caption">App ID and API Key</span>
          </a>

          <a className="config-guide" href={LIVEKIT_URL} target="_blank" rel="noreferrer">
            {/* Two steps: open Settings, then look at API keys. */}
            <div className="guide-shots">
              <img src="/livekit-guide-1.jpg" alt="LiveKit Cloud: open project settings" />
              <img src="/livekit-guide-2.jpg" alt="LiveKit Cloud: API keys" />
            </div>
            <span className="guide-caption">LiveKit URL, API Key and Secret</span>
          </a>
        </div>
      </div>
    </div>
  )
}

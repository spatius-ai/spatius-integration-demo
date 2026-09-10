'use client'

import { useState, useEffect } from 'react'
import { fetchConfig, saveConfig } from '@/utils/rtcSession'
import type { AppConfig, Lang } from '@/types'

const DASH_URL = 'https://app.spatius.ai'
const AGORA_URL = 'https://console.agora.io'
const STORAGE_KEY = 'avatarkit-agora-demo-config'

interface Props {
  onReady: (config: AppConfig) => void
}

export default function Configuration({ onReady }: Props) {
  const [appId, setAppId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [agoraAppId, setAgoraAppId] = useState('')
  const [agoraCertificate, setAgoraCertificate] = useState('')
  const [agoraPipelineId, setAgoraPipelineId] = useState('')
  const [language, setLanguage] = useState<Lang>('en')
  const [avatarId, setAvatarId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        setAgoraAppId(saved.AGORA_APP_ID || '')
        setAgoraCertificate(saved.AGORA_APP_CERTIFICATE || '')
        setAgoraPipelineId(saved.AGORA_PIPELINE_ID || '')
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
      agoraAppId.trim() &&
      agoraCertificate.trim() &&
      agoraPipelineId.trim(),
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
        AGORA_APP_ID: agoraAppId.trim(),
        AGORA_APP_CERTIFICATE: agoraCertificate.trim(),
        AGORA_PIPELINE_ID: agoraPipelineId.trim(),
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
          <h1>AvatarKit Agora Demo</h1>
          <p className="config-subtitle">
            The avatar joins the call itself — audio and motion both arrive over the
            Agora channel, and nothing streams through the server.
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
                Held by the server, which the avatar uses to join the channel — it never
                reaches this page in use. Entering it here is a convenience of the demo.
              </span>
            </div>

            {/*
              Recognition and the persona are fixed when the agent is started, so this
              is chosen here rather than switched inside the room.
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
                Sets speech recognition and the assistant's persona. The voice belongs
                to the agent in Agora's console.
              </span>
            </div>

            <div className="field-group">
              <h2 className="group-title">Agora</h2>
              <p className="group-hint">
                Carries the call and hosts the conversation. Recognition, the model and
                the voice are configured on the agent in Agora's console, not here.
              </p>

              <div className="field">
                <label>App ID <span className="required">*</span></label>
                <input
                  value={agoraAppId}
                  onChange={e => setAgoraAppId(e.target.value)}
                  placeholder="Your Agora App ID"
                  spellCheck={false}
                />
              </div>

              <div className="field">
                <label>App Certificate <span className="required">*</span></label>
                <input
                  type="password"
                  value={agoraCertificate}
                  onChange={e => setAgoraCertificate(e.target.value)}
                  placeholder="Your App Certificate"
                  spellCheck={false}
                />
                <span className="field-hint">
                  Enable the App Certificate on the project's page — tokens cannot be
                  signed without it. It is a different value from the App ID; the
                  console masks it, so check what you copied.
                </span>
              </div>

              <div className="field">
                <label>Agent (pipeline) ID <span className="required">*</span></label>
                <input
                  value={agoraPipelineId}
                  onChange={e => setAgoraPipelineId(e.target.value)}
                  placeholder="Published agent id"
                  spellCheck={false}
                />
                <span className="field-hint">
                  Create an agent under Conversational AI → Agents, set its prompt and
                  models, publish it, and paste its id here. Leave its speech
                  recognition at the console defaults — the server sends that same setup
                  with every session.
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

          <a className="config-guide" href={AGORA_URL} target="_blank" rel="noreferrer">
            {/*
              Four steps, in the same order as the three fields on the left: pick the
              project under Projects → take the App ID and certificate → find the
              agent under Agents → publish it and take the pipeline id.
            */}
            {/* Four wrap into two rows on their own: .guide-shots is a wrapping
                flex row with a 460px basis, so a quarter-width column — at which
                the console's own labels stop being readable — never happens. */}
            <div className="guide-shots">
              <img src="/agora-guide-1.jpg" alt="Agora Console: pick a project" />
              <img src="/agora-guide-2.jpg" alt="Agora Console: App ID and certificate" />
              <img src="/agora-guide-3.jpg" alt="Agora Console: find the agent" />
              <img src="/agora-guide-4.jpg" alt="Agora Console: publish it and copy the id" />
            </div>
            <span className="guide-caption">
              App ID, App Certificate and the agent (pipeline) id
            </span>
          </a>

          {/*
            The voice and the sample rate, both on the agent's Models tab. Neither
            can be set from this page: the voice belongs to the published agent, and
            the sample rate has to match whatever that agent's TTS emits.
          */}
          <a className="config-guide" href={AGORA_URL} target="_blank" rel="noreferrer">
            <div className="guide-shots">
              <img src="/agora-voice-guide.jpg" alt="Agora Console: the agent's voice" />
              <img src="/agora-guide-5.jpg" alt="Agora Console: the TTS sample rate" />
            </div>
            <span className="guide-caption">
              The voice lives on the agent — Agents → Models → TTS. Its sample rate
              must equal <code>AGORA_AVATAR_SAMPLE_RATE</code> in the server's{' '}
              <code>.env</code>: the avatar does not resample, and a mismatch is
              silent.
            </span>
          </a>

          <a className="config-guide" href={AGORA_URL} target="_blank" rel="noreferrer">
            <img src="/agora-asr-guide.jpg" alt="Agora Console: the speech recognition settings" />
            <span className="guide-caption">
              Leave the recognition vendor and model at the console defaults (Deepgram
              nova-3); they must match <code>ASR_VENDOR</code> / <code>ASR_MODEL</code>{' '}
              in the server's <code>agora.py</code>.
            </span>
          </a>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useRef } from 'react'
import { fetchConfig, saveConfig, type Transport } from '@/utils/rtcSession'
import { VOICE_OPTIONS, DEFAULT_VOICE, VoicePreview } from '@/data/voices'
import type { AppConfig, Lang } from '@/types'

const DASH_URL = 'https://app.spatius.ai'
const LIVEKIT_URL = 'https://cloud.livekit.io'
const AGORA_URL = 'https://console.agora.io'
const STORAGE_KEY = 'avatarkit-rtc-config'

interface Props {
  onReady: (config: AppConfig) => void
}

export default function Configuration({ onReady }: Props) {
  const [transport, setTransport] = useState<Transport>('livekit')
  const [appId, setAppId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [livekitUrl, setLivekitUrl] = useState('')
  const [livekitKey, setLivekitKey] = useState('')
  const [livekitSecret, setLivekitSecret] = useState('')
  const [agoraAppId, setAgoraAppId] = useState('')
  const [agoraCertificate, setAgoraCertificate] = useState('')
  const [agoraPipelineId, setAgoraPipelineId] = useState('')
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
        if (saved.TRANSPORT === 'agora' || saved.TRANSPORT === 'livekit') {
          setTransport(saved.TRANSPORT)
        }
        setAppId(saved.SPATIUS_APP_ID || '')
        setApiKey(saved.SPATIUS_API_KEY || '')
        setLivekitUrl(saved.LIVEKIT_URL || '')
        setLivekitKey(saved.LIVEKIT_API_KEY || '')
        setLivekitSecret(saved.LIVEKIT_API_SECRET || '')
        setAgoraAppId(saved.AGORA_APP_ID || '')
        setAgoraCertificate(saved.AGORA_APP_CERTIFICATE || '')
        setAgoraPipelineId(saved.AGORA_PIPELINE_ID || '')
        setVoice(saved.TTS_MODEL || DEFAULT_VOICE)
        setAvatarId(saved.avatarId || '')
      })
      .catch(() => {
        // A server that is down is not worth an error here — Enter reports it
        // properly if it is still down by then.
      })
    return () => { cancelled = true }
  }, [])

  // Only the chosen transport's credentials are required: the other's are irrelevant
  // to this session, and demanding both would mean signing up with two vendors to run
  // a demo that uses one.
  const transportReady =
    transport === 'agora'
      ? Boolean(agoraAppId.trim() && agoraCertificate.trim() && agoraPipelineId.trim())
      : Boolean(livekitUrl.trim() && livekitKey.trim() && livekitSecret.trim())
  const canEnter = Boolean(appId.trim() && apiKey.trim()) && transportReady

  const handleEnter = async () => {
    if (!canEnter) return
    setSaving(true)
    setError(null)
    try {
      // Saved before entering, not after: these were typed one field at a time, and
      // a failure past this point should not mean entering them all again.
      //
      // Both transports' fields go up regardless of which is selected: a blank one is
      // ignored server-side, and sending the lot means switching back later finds the
      // other set still filled in.
      await saveConfig({
        TRANSPORT: transport,
        SPATIUS_APP_ID: appId.trim(),
        SPATIUS_API_KEY: apiKey.trim(),
        LIVEKIT_URL: livekitUrl.trim(),
        LIVEKIT_API_KEY: livekitKey.trim(),
        LIVEKIT_API_SECRET: livekitSecret.trim(),
        TTS_MODEL: voice,
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
          <h1>AvatarKit RTC Mode Demo</h1>
          <p className="config-subtitle">
            The avatar joins the call itself — audio and motion both arrive over RTC,
            and nothing streams through the server.
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
              Which RTC stack carries the call. The room behaves identically either
              way — same avatar, same conversation — and only the credentials below
              change with it.
            */}
            <div className="field">
              <label>Transport</label>
              <div className="scene-toggle">
                <button
                  type="button"
                  className={transport === 'livekit' ? 'on' : ''}
                  onClick={() => setTransport('livekit')}
                >
                  <strong>LiveKit</strong>
                  <span>Runs on your machine</span>
                </button>
                <button
                  type="button"
                  className={transport === 'agora' ? 'on' : ''}
                  onClick={() => setTransport('agora')}
                >
                  <strong>Agora</strong>
                  <span>Hosted by ConvoAI</span>
                </button>
              </div>
              <span className="field-hint">
                LiveKit runs the conversation here and routes models through LiveKit
                Inference. Agora's Conversational AI Engine hosts it instead, with the
                models and voice configured in its console.
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

            {transport === 'livekit' ? (
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
                  The voice, which only this path can choose: on Agora it belongs to the
                  agent published in the console. These are LiveKit Inference model
                  names, and each has a sample recorded from it — the model name says
                  nothing about how it reads, so picking one blind is guesswork.
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
            ) : (
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
                    signed without it.
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
                    models, publish it, and paste its id here. Note that the speech
                    recognition credential ids are hard-coded in the server's{' '}
                    <code>agora.py</code> — running against your own agent means
                    replacing them.
                  </span>
                </div>
              </div>
            )}

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

          {/* The guide follows the transport, so it never points at a console the
              fields below do not belong to. */}
          {transport === 'livekit' ? (
            <a className="config-guide" href={LIVEKIT_URL} target="_blank" rel="noreferrer">
              {/* Two steps: open Settings, then look at API keys. */}
              <div className="guide-shots">
                <img src="/livekit-guide-1.jpg" alt="LiveKit Cloud: open project settings" />
                <img src="/livekit-guide-2.jpg" alt="LiveKit Cloud: API keys" />
              </div>
              <span className="guide-caption">LiveKit URL, API Key and Secret</span>
            </a>
          ) : (
            <>
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
                <img src="/agora-asr-guide.jpg" alt="Agora Console: the speech recognition credential" />
                <span className="guide-caption">
                  The recognition vendor, model and credential id must match the ones
                  hard-coded in the server's <code>agora.py</code>.
                </span>
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

import { ConversationState } from '@spatius/avatarkit'
import { AvatarManagerService, type AvatarInstance } from '../avatarManager'
import { DEFAULT_CHARACTERS } from '../data/characters'
import { pushToast } from '../utils/toast'
import { BackendClient, fetchConfig } from '../utils/backendClient'
import { MicrophonePcmCapture } from '../utils/audioCapture'
import type { AppConfig } from './configuration'

const DASH_URL = 'https://app.spatius.ai'
const MAX_AVATARS = 4
const MIC_SAMPLE_RATE = 16000

/**
 * The SDK callbacks worth watching, in the order they first fire over a session's
 * life: load, first frame, then the per-turn ones.
 *
 * Listed whether or not this demo acts on the value — which hooks exist is part of
 * what a reference client is meant to show, and a row that only appears once it has
 * fired is a row nobody knows to expect. A value of `—` means "registered, nothing
 * reported yet".
 *
 * Two public callbacks are deliberately absent, since a row that can only ever read
 * "ok" teaches nothing:
 *   onPlaybackStall   only fires under FrameStarvationMode.strictSync, and the
 *                     default mode lets audio keep playing through starvation
 *   onAnimationState  reports the animation library, which is not public yet
 * Both are still registered in avatarManager, so wiring a row back on is one entry.
 *
 * There is no connection row: in Backend Mode the server holds the Motion Server
 * connection, so `onConnectionState` never fires on this side.
 */
const STATUS_ROWS: {
  key: string
  label: string
  callback: string
  help: string
  read: (a: AvatarInstance) => string | null
}[] = [
  {
    key: 'download',
    label: 'Download',
    callback: 'AvatarManager.load(id, onProgress)',
    help: 'Model download progress, 0-100%. Only fires on a cache miss — a second load of the same avatar resolves straight away.',
    read: a => (a.loading ? `${Math.round(a.loadProgress * 100)}%` : 'complete'),
  },
  {
    key: 'rendered',
    label: 'First frame',
    callback: 'AvatarView.onFirstRendering',
    help: 'Fires once, when the avatar has actually been drawn. This is the moment to take a loading overlay down.',
    read: a => (a.rendered ? 'rendered' : 'waiting'),
  },
  {
    key: 'conversation',
    label: 'Conversation',
    callback: 'AvatarController.onConversationState',
    help: 'Playback state: idle, playing or paused. The controls over the avatar follow this.',
    read: a => a.conversationState,
  },
  {
    key: 'fps',
    label: 'Frame rate',
    callback: 'AvatarController.onFrameRateInfo',
    help: 'Rolling render rate over a 2-second window. Off by default and free while off; this demo enables it via frameRateMonitorEnabled.',
    read: a => (a.fps === null ? null : `${a.fps} fps`),
  },
  {
    key: 'error',
    label: 'Error',
    callback: 'AvatarController.onError',
    help: 'SDK failures — a malformed frame, a rendering problem. Worth surfacing rather than leaving to the console.',
    read: a => a.error ?? 'none',
  },
]

export function createPlayground(config: AppConfig): HTMLElement {
  const manager = new AvatarManagerService()

  let multiMode = false
  let loadingCharId: string | null = null
  let playingClip: string | null = null
  let customChars: { id: string; name: string }[] = []
  let adding = false

  // Realtime scene state.
  let client: BackendClient | null = null
  let connected = false
  let agentReady = false
  let agentStarting = false
  let micOn = false
  /**
   * Whether the microphone has ever been opened in this session.
   *
   * Drives the green ring, which points at the mic once the avatar is connected
   * and stops for good after the first press — same as the character list and
   * Start. Not `!micOn`, or the ring would return on every mute, long after the
   * user has learned where the button is.
   */
  let micUsed = false
  let speaking = false
  let mic: MicrophonePcmCapture | null = null
  const transcript: { role: 'user' | 'assistant'; text: string }[] = []
  /** The clips the server offers, and the note explaining where they live. */
  let clips: { name: string; clip: string }[] = []
  let clipsHint = ''

  const root = document.createElement('div')
  root.className = 'playground'
  root.innerHTML = `
    <div class="playground-left"><div class="character-list">
      <h3>Characters</h3>
      <div class="character-items" data-char-items></div>
      <a class="guide-thumb list-guide" href="${DASH_URL}" target="_blank" rel="noreferrer">
        <img src="/public-avatar-guide.png" alt="Where to find character IDs" />
      </a>
    </div></div>

    <div class="playground-center">
      <div class="center-header">
        <label class="multi-toggle">
          <input type="checkbox" data-multi />
          <span>Multi-avatar mode</span>
        </label>
        <span class="avatar-count" data-count hidden></span>
      </div>
      <div class="canvas-stage">
        <div class="avatar-canvas grid-1" data-canvas>
          <div class="canvas-empty" data-empty>Select a character to get started</div>
        </div>
        <div class="stage-controls" data-stage hidden></div>
      </div>
    </div>

    <div class="playground-right"><div class="control-panel" data-panel></div></div>
  `

  const charItems = root.querySelector<HTMLElement>('[data-char-items]')!
  const canvas = root.querySelector<HTMLElement>('[data-canvas]')!
  const emptyHint = root.querySelector<HTMLElement>('[data-empty]')!
  const stage = root.querySelector<HTMLElement>('[data-stage]')!
  const panel = root.querySelector<HTMLElement>('[data-panel]')!
  const multiToggle = root.querySelector<HTMLInputElement>('[data-multi]')!
  const countLabel = root.querySelector<HTMLElement>('[data-count]')!

  const cells = new Map<string, HTMLElement>()

  // Nodes that outlive a render, rather than being rebuilt inside one.
  //
  // A click only fires when mousedown and mouseup land on the same element, and
  // every panel here re-renders on each SDK callback — the frame-rate monitor
  // alone fires every couple of seconds. Rebuilding a button mid-press therefore
  // swallows the click silently, with nothing in the console to show for it.
  const charButtons = new Map<string, HTMLButtonElement>()

  /** Holds whichever of the two trailing entries is currently showing. */
  const customSlot = document.createElement('div')
  /** Which of the two it is, so the slot is only rebuilt when they swap. */
  let customSlotShowsInput: boolean | null = null

  const addCustomBtn = document.createElement('button')
  addCustomBtn.className = 'character-item add-btn'
  addCustomBtn.innerHTML = `
    <span class="character-avatar add-avatar">+</span>
    <span class="character-name">Custom ID</span>
  `
  addCustomBtn.addEventListener('click', () => {
    adding = true
    renderCharacters()
  })

  const interruptBtn = document.createElement('button')
  interruptBtn.className = 'stage-btn stage-btn-interrupt'
  interruptBtn.title = 'Interrupt'
  interruptBtn.setAttribute('aria-label', 'Interrupt')
  interruptBtn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>'
  interruptBtn.addEventListener('click', handleInterrupt)

  /** What the toggle currently shows, so its icon is only rewritten on a change. */
  let togglePaused: boolean | null = null

  const toggleBtn = document.createElement('button')
  toggleBtn.addEventListener('click', () => {
    const controller = manager.activeController
    if (!controller) return
    // Read the state at click time rather than closing over it: the button is
    // built once, so a captured value would go stale on the first pause.
    if (manager.activeAvatar?.conversationState === ConversationState.paused) {
      void controller.resume()
    } else {
      controller.pause()
    }
  })

  const statusBar = document.createElement('div')
  statusBar.className = 'status-bar'

  const slotSelector = document.createElement('div')
  slotSelector.className = 'slot-selector'

  const panelHint = document.createElement('p')
  panelHint.className = 'panel-hint'
  panelHint.textContent = 'Load a character first'

  /** One node per server-side clip, created the first time the list arrives. */
  const clipButtons = new Map<string, HTMLButtonElement>()
  const clipList = document.createElement('div')
  clipList.className = 'audio-list'
  const clipsTitle = document.createElement('h4')
  clipList.appendChild(clipsTitle)

  const clipsNote = document.createElement('p')
  clipsNote.className = 'realtime-hint'
  clipsNote.textContent =
    'The clips live on the server and never pass through this page: one is ' +
    'streamed straight into the avatar, and what arrives here is the encoded ' +
    'audio and motion to render.'

  // The realtime panel, built once. Its microphone and Say button are the two
  // controls a user presses repeatedly while the panel is re-rendering underneath
  // them, so neither may be replaced.
  const realtimePanel = document.createElement('div')
  realtimePanel.className = 'realtime-panel'

  const micHeading = document.createElement('h4')
  micHeading.textContent = 'Microphone'
  const speakingDot = document.createElement('span')
  speakingDot.className = 'speaking-dot'
  speakingDot.title = 'The avatar is speaking'
  speakingDot.hidden = true
  micHeading.appendChild(speakingDot)

  const micBtn = document.createElement('button')
  micBtn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
      <path d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.09A6 6 0 0 0 18 11z" />
    </svg>
  `
  micBtn.addEventListener('click', () => void toggleMic())

  const micState = document.createElement('p')
  micState.className = 'mic-state'

  // A way to try the scene without a microphone — a machine with no input device,
  // or a quick check that the agent replies.
  const sayForm = document.createElement('form')
  sayForm.className = 'realtime-text'
  const sayField = document.createElement('input')
  sayField.placeholder = '…or type a line to speak'
  const sayBtn = document.createElement('button')
  sayBtn.type = 'submit'
  sayBtn.className = 'secondary'
  sayBtn.textContent = 'Say'
  sayBtn.disabled = true
  sayForm.appendChild(sayField)
  sayForm.appendChild(sayBtn)
  sayField.addEventListener('input', () => {
    sayBtn.disabled = !sayField.value.trim()
  })
  sayForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = sayField.value.trim()
    if (!text) return
    if (!(await ensureAgent())) return
    client?.say(text)
    sayField.value = ''
    sayBtn.disabled = true
  })

  const transcriptBox = document.createElement('div')
  transcriptBox.className = 'transcript'
  transcriptBox.hidden = true

  const realtimeHint = document.createElement('p')
  realtimeHint.className = 'realtime-hint'
  realtimeHint.textContent =
    'The conversation runs on the server — ASR, LLM and TTS — and the reply is ' +
    'driven into the avatar there. This page only renders the audio and motion ' +
    'that come back.'

  realtimePanel.appendChild(micHeading)
  realtimePanel.appendChild(micBtn)
  realtimePanel.appendChild(micState)
  realtimePanel.appendChild(sayForm)
  realtimePanel.appendChild(transcriptBox)
  realtimePanel.appendChild(realtimeHint)

  // ---------------------------------------------------------------- characters

  function renderCharacters() {
    const all = [...DEFAULT_CHARACTERS, ...customChars]
    const empty = manager.avatars.length === 0 && !loadingCharId
    // Until a character is picked there is nothing to render and every other
    // control is inert, which reads as a broken page rather than a first step.
    // The pulse stops the moment one is chosen.
    charItems.classList.toggle('needs-pick', empty)

    for (const c of all) {
      let btn = charButtons.get(c.id)
      if (!btn) {
        btn = document.createElement('button')
        btn.innerHTML = `
          <span class="character-avatar">${c.name.charAt(0)}</span>
          <span class="character-name">${c.name}</span>
          <span class="character-progress" hidden></span>
        `
        btn.addEventListener('click', () => void selectCharacter(c.id, c.name))
        charButtons.set(c.id, btn)
      }
      btn.className = `character-item ${loadingCharId === c.id ? 'loading' : ''}`
      btn.disabled = loadingCharId !== null

      const progressEl = btn.querySelector<HTMLElement>('.character-progress')!
      if (loadingCharId === c.id) {
        const progress = manager.avatars.find(a => a.loading)?.loadProgress ?? 0
        progressEl.textContent = `${Math.round(progress * 100)}%`
        progressEl.hidden = false
      } else {
        progressEl.hidden = true
      }
      // Only on first insertion. `appendChild` on a node that is already a child
      // detaches and re-inserts it, which cancels a click in progress: the press
      // registers, the release lands on a just-moved node, and no click fires.
      if (btn.parentElement !== charItems) charItems.appendChild(btn)
    }

    // The trailing entry — either the "Custom ID" button or the input that
    // replaces it — is the only part that genuinely swaps, so it is the only
    // part torn down, and only when the two actually trade places.
    if (customSlot.parentElement !== charItems) charItems.appendChild(customSlot)
    const wantsInput = adding
    if (customSlotShowsInput !== wantsInput) {
      customSlotShowsInput = wantsInput
      customSlot.innerHTML = ''
    } else if (!wantsInput) {
      // Already showing the button, and it has not changed — leave it alone.
      return
    }

    if (adding) {
      const wrap = document.createElement('div')
      wrap.className = 'custom-id-input'
      wrap.innerHTML = `
        <input placeholder="Paste character ID" />
        <div class="custom-id-actions">
          <button class="primary" data-add>Add</button>
          <button class="secondary" data-cancel>Cancel</button>
        </div>
      `
      const field = wrap.querySelector('input')!
      const addBtn = wrap.querySelector<HTMLButtonElement>('[data-add]')!
      const commit = () => {
        const id = field.value.trim()
        if (!id) return
        if (all.some(c => c.id === id)) return
        customChars = [...customChars, { id, name: `Custom (${id.slice(0, 6)}...)` }]
        adding = false
        renderCharacters()
      }
      addBtn.disabled = true
      field.addEventListener('input', () => {
        addBtn.disabled = !field.value.trim() || loadingCharId !== null
      })
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit()
      })
      addBtn.addEventListener('click', commit)
      wrap.querySelector('[data-cancel]')!.addEventListener('click', () => {
        adding = false
        renderCharacters()
      })
      customSlot.appendChild(wrap)
      field.focus()
    } else {
      customSlot.appendChild(addCustomBtn)
    }
  }

  async function selectCharacter(charId: string, charName: string) {
    if (loadingCharId) return
    if (manager.avatars.length >= MAX_AVATARS && multiMode) return

    if (!multiMode) {
      manager.removeAll()
      cells.forEach(cell => cell.remove())
      cells.clear()
    }

    loadingCharId = charId
    renderCharacters()

    const cell = document.createElement('div')
    cell.className = 'canvas-cell active-cell'

    const overlay = document.createElement('div')
    overlay.className = 'cell-loading-overlay'
    overlay.innerHTML = '<div class="cell-spinner"></div><div class="cell-progress-text">0%</div>'
    cell.appendChild(overlay)

    const badge = document.createElement('div')
    badge.className = 'cell-badge'
    badge.textContent = String(multiMode ? manager.avatars.length + 1 : 1)
    cell.appendChild(badge)

    if (multiMode) {
      const closeBtn = document.createElement('button')
      closeBtn.className = 'cell-close'
      closeBtn.textContent = '✕'
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        for (const [uid, c] of cells) {
          if (c === cell) {
            removeOne(uid)
            break
          }
        }
      })
      cell.appendChild(closeBtn)
    }

    cell.addEventListener('click', () => {
      for (const [uid, c] of cells) {
        if (c === cell) {
          manager.setActiveUid(uid)
          break
        }
      }
    })

    const container = document.createElement('div')
    container.style.width = '100%'
    container.style.height = '100%'
    cell.appendChild(container)

    canvas.appendChild(cell)
    await new Promise(r => requestAnimationFrame(r))

    try {
      const uid = await manager.loadAvatar(charId, charName, container, (progress) => {
        const text = overlay.querySelector('.cell-progress-text')
        if (text) text.textContent = `${Math.round(progress)}%`
      })
      cells.set(uid, cell)
      overlay.remove()
    } catch (e: any) {
      console.error('Load failed:', e)
      pushToast(`Failed to load avatar: ${e?.message ?? e}`)
      cell.remove()
    } finally {
      loadingCharId = null
      renderAll()
    }
  }

  function removeOne(uid: string) {
    const cell = cells.get(uid)
    if (cell) cell.remove()
    cells.delete(uid)
    manager.removeAvatar(uid)
    // Re-number remaining badges
    let idx = 1
    cells.forEach((c) => {
      const badge = c.querySelector('.cell-badge')
      if (badge) badge.textContent = String(idx++)
    })
    renderAll()
  }

  multiToggle.addEventListener('change', () => {
    if (multiMode && manager.avatars.length > 1) {
      manager.avatars.forEach((a) => {
        if (a.uid !== manager.activeUid) {
          const cell = cells.get(a.uid)
          if (cell) cell.remove()
          cells.delete(a.uid)
          manager.removeAvatar(a.uid)
        }
      })
    }
    multiMode = !multiMode
    multiToggle.checked = multiMode
    canvas.className = `avatar-canvas ${multiMode ? 'grid-4' : 'grid-1'}`
    renderAll()
  })

  // ---------------------------------------------------------------- stage

  /**
   * Interrupting only has to stop the local playback here: the audio is produced
   * on the server, and it stops sending when the session tells it to — there is
   * no local sender to cancel, which is what Direct Mode needs a handle for.
   */
  function handleInterrupt() {
    manager.activeController?.interrupt()
  }

  function renderStage() {
    const avatar = manager.activeAvatar
    const controller = manager.activeController
    const state = avatar?.conversationState
    // Over the avatar, since that is what they act on. Which pair shows follows
    // the conversation state; in idle neither does.
    if (!avatar || !controller || state === ConversationState.idle || state === undefined) {
      // Hidden rather than emptied: clearing would destroy the two buttons held
      // across renders, and with them their click listeners.
      stage.hidden = true
      return
    }
    const paused = state === ConversationState.paused
    stage.hidden = false

    // Attached once. `appendChild` on a node that is already a child still
    // detaches and re-inserts it, which cancels a click in progress — the press
    // registers, the release lands on a node that has just been moved, and no
    // click is ever produced.
    if (!stage.firstChild) {
      stage.appendChild(interruptBtn)
      stage.appendChild(toggleBtn)
    }

    // Only when it actually changes: rewriting innerHTML replaces the SVG the
    // pointer is currently over, with the same effect.
    if (togglePaused !== paused) {
      togglePaused = paused
      toggleBtn.className = `stage-btn ${paused ? 'stage-btn-resume' : 'stage-btn-pause'}`
      toggleBtn.title = paused ? 'Resume' : 'Pause'
      toggleBtn.setAttribute('aria-label', paused ? 'Resume' : 'Pause')
      toggleBtn.innerHTML = paused
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.8 4.4v15.2a1.2 1.2 0 0 0 1.84 1l11.4-7.6a1.2 1.2 0 0 0 0-2l-11.4-7.6a1.2 1.2 0 0 0-1.84 1z" /></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="4" width="5" height="16" rx="1.6" /><rect x="13.5" y="4" width="5" height="16" rx="1.6" /></svg>'
    }
  }

  // ---------------------------------------------------------------- backend

  /**
   * Open the connection as soon as there is an avatar to render into.
   *
   * Nothing to ask the user here: in Backend Mode this is a WebSocket to the demo's
   * own server, not a session that costs anything, and every control below is dead
   * until it exists. Direct Mode has a Start button because there the client opens
   * the Motion Server connection itself.
   */
  function ensureConnection() {
    const controller = manager.activeController
    const avatar = manager.activeAvatar
    const ready = !!avatar?.view && !avatar.loading
    if (!ready || !controller || client) return

    const next = new BackendClient({
      onError: (message) => pushToast(message),
      onClosed: () => {
        connected = false
        playingClip = null
        client = null
        renderPanel()
      },
      onSpeaking: () => { speaking = true; renderPanel() },
      onTranscript: (role, text) => { transcript.push({ role, text }); renderPanel() },
    })
    next.setController(controller)
    client = next

    next
      .connect()
      .then(() => {
        if (client !== next) return
        if (avatar?.characterId) next.setAvatar(avatar.characterId)
        connected = true
        renderPanel()
      })
      .catch((e) => {
        if (client !== next) return
        pushToast(e?.message ?? 'Could not reach the Backend Mode server')
        client = null
        renderPanel()
      })
  }

  /**
   * The audio context has to be created inside a user gesture — a browser will not
   * allow it otherwise, and the avatar then renders in silence with nothing
   * reported. So it is done on the first press of whatever the scene's button is,
   * rather than needing a button of its own.
   */
  async function ensureAudioContext() {
    await manager.activeController?.initializeAudioContext()
  }

  async function ensureAgent(): Promise<boolean> {
    if (!client || !connected) {
      pushToast('Still connecting to the server — try again in a moment.', 'warning')
      return false
    }
    if (agentReady) return true

    // Brought up on the first press rather than on mount: it costs a model session,
    // and someone who only wants the pre-recorded scene should not pay for one by
    // loading the page.
    agentStarting = true
    renderPanel()
    try {
      await ensureAudioContext()
      // Awaited rather than fired off: microphone audio pushed before the agent
      // exists is dropped, which presents as a mic that records nothing.
      await client.startAgent(config.language)
      agentReady = true
      return true
    } catch (e: any) {
      pushToast(e?.message ?? 'The agent did not start')
      return false
    } finally {
      agentStarting = false
      renderPanel()
    }
  }

  async function toggleMic() {
    if (!(await ensureAgent())) return

    if (micOn) {
      await mic?.stop()
      mic = null
      micOn = false
      renderPanel()
      return
    }

    try {
      const capture = new MicrophonePcmCapture(MIC_SAMPLE_RATE)
      mic = capture
      await capture.start((chunk) => {
        client?.pushMicAudio(chunk.buffer as ArrayBuffer)
      })
      micOn = true
      micUsed = true
    } catch (e: any) {
      mic = null
      pushToast(
        e?.name === 'NotAllowedError'
          ? 'Microphone permission was denied.'
          : (e?.message ?? 'Could not open the microphone'),
      )
    }
    renderPanel()
  }

  async function playSample(clip: string) {
    if (!client) return
    await ensureAudioContext()
    playingClip = clip
    renderPanel()
    client.playSample(clip)
    // The server streams the clip and reports nothing when it finishes, so this is
    // released on the next conversation state change rather than by a reply.
  }

  // ---------------------------------------------------------------- panel

  function renderPanel() {
    const avatar = manager.activeAvatar
    // Note the first clause: with no avatar at all, `avatar?.view` is undefined
    // rather than null, so a `!== null` test passes and every control below turns
    // on before there is anything to control.
    const hasAvatar = !!avatar?.view && !avatar.loading

    // The panel is assembled once and then only updated. Clearing it here would
    // detach the clip buttons on every render — and this runs on every SDK
    // callback, the frame-rate monitor included. Detaching a button between
    // mousedown and mouseup cancels the click, so pressing one did nothing at
    // all: the press registered, the release landed on a re-attached node, and
    // no click event was ever produced.
    if (!panel.firstChild) {
      const heading = document.createElement('h3')
      heading.textContent = 'Controls'
      panel.appendChild(heading)
      panel.appendChild(statusBar)
      panel.appendChild(slotSelector)
      panel.appendChild(panelHint)
      panel.appendChild(realtimePanel)
      panel.appendChild(clipList)
    }

    statusBar.hidden = !avatar
    slotSelector.hidden = !(multiMode && manager.avatars.length > 0)
    panelHint.hidden = hasAvatar
    realtimePanel.hidden = !hasAvatar || config.scene !== 'realtime'
    clipList.hidden = !hasAvatar || config.scene === 'realtime'

    // The status rows hold no controls, so rewriting them wholesale is harmless.
    if (avatar) {
      statusBar.innerHTML = ''
      for (const row of STATUS_ROWS) {
        const value = row.read(avatar)
        const isError = row.key === 'error' && value && value !== 'none'
        const line = document.createElement('div')
        line.className = `status-row ${isError ? 'error' : ''}`
        line.innerHTML = `
          <span class="status-label">
            ${row.label}
            <span class="status-help" tabindex="0">?
              <span class="status-tip" role="tooltip">
                <code>${row.callback}</code>
                <span>${row.help}</span>
              </span>
            </span>
          </span>
          <span class="status-value ${isError ? 'error-text' : ''} ${value === null ? 'status-idle' : ''}">
            ${value ?? '—'}
          </span>
        `
        statusBar.appendChild(line)
      }
    }

    // Rebuilt per render like the status rows. These buttons only appear in
    // multi-avatar mode, which is not a state anything is pressed through.
    if (multiMode && manager.avatars.length > 0) {
      slotSelector.innerHTML = '<h4>Active Avatar</h4><div class="slot-list"></div>'
      const list = slotSelector.querySelector('.slot-list')!
      manager.avatars.forEach((a, i) => {
        const btn = document.createElement('button')
        btn.className = `slot-btn ${a.uid === manager.activeUid ? 'active' : ''}`
        btn.innerHTML = `<span class="slot-index">${i + 1}</span><span class="slot-name">${a.characterName}</span>`
        btn.addEventListener('click', () => manager.setActiveUid(a.uid))
        list.appendChild(btn)
      })
    }

    if (!hasAvatar) return

    // What drives the avatar, and the only thing that differs between the two
    // scenes. Both are driven server-side and arrive here as the same audio +
    // motion messages.
    if (config.scene === 'realtime') {
      // Only the parts that actually change are written; the microphone, the text
      // field and the Say button are the same nodes every render.
      speakingDot.hidden = !speaking
      micBtn.className = `mic-btn ${micOn ? 'on' : ''} ${connected && !micUsed ? 'needs-pick' : ''}`
      micBtn.title = micOn ? 'Stop the microphone' : 'Start talking'
      micBtn.disabled = !connected || agentStarting
      micState.textContent = !connected
        ? 'Connecting to the server…'
        : agentStarting
          ? 'Starting the agent…'
          : micOn
            ? 'Listening — just talk, the agent decides when your turn ends.'
            : agentReady
              ? 'Microphone off.'
              : 'Tap to start talking.'
      sayField.disabled = !connected
      sayBtn.disabled = !sayField.value.trim() || !connected

      transcriptBox.hidden = transcript.length === 0
      transcriptBox.innerHTML = transcript
        .map(t => `<p class="${t.role}"><strong>${t.role === 'user' ? 'You' : 'Avatar'}</strong>${t.text}</p>`)
        .join('')

      return
    }

    clipsTitle.innerHTML = `Pre-recorded audio${clipsHint ? `<span class="audio-hint" title="${clipsHint}">?</span>` : ''}`
    for (const c of clips) {
      let btn = clipButtons.get(c.clip)
      if (!btn) {
        btn = document.createElement('button')
        btn.className = 'secondary full-width audio-btn'
        btn.addEventListener('click', () => void playSample(c.clip))
        clipButtons.set(c.clip, btn)
        clipList.appendChild(btn)
      }
      btn.disabled = !connected || playingClip !== null
      btn.textContent = playingClip === c.clip ? '...' : `▶ ${c.name}`
    }
    // Kept last, but only moved when new buttons have been added above it:
    // re-appending an attached node detaches and re-inserts it, and doing that
    // every render would cancel any click in progress on the list.
    if (clipList.lastChild !== clipsNote) clipList.appendChild(clipsNote)
  }

  // ---------------------------------------------------------------- wiring

  function renderAll() {
    const empty = manager.avatars.length === 0 && !loadingCharId
    emptyHint.hidden = !empty
    countLabel.hidden = !multiMode
    countLabel.textContent = `${manager.avatars.length}/${MAX_AVATARS}`
    cells.forEach((cell, uid) => {
      cell.classList.toggle('active-cell', uid === manager.activeUid)
    })
    renderCharacters()
    renderStage()
    renderPanel()
  }

  // The avatar going back to idle is what says the clip has finished playing.
  let idleTimer: number | null = null

  manager.onChange(() => {
    // The controller changes when a different character is selected, and the
    // client outlives that — so it is handed the current one rather than closing
    // over it.
    client?.setController(manager.activeController)
    ensureConnection()
    if (connected && manager.activeAvatar?.characterId) {
      client?.setAvatar(manager.activeAvatar.characterId)
    }

    if (playingClip !== null && manager.activeAvatar?.conversationState === 'idle') {
      if (idleTimer !== null) window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        playingClip = null
        idleTimer = null
        renderPanel()
      }, 500)
    }

    renderAll()
  })

  // The clips live on the server, so the list comes from there rather than being
  // repeated here — dropping a .pcm file into its assets directory is enough.
  fetchConfig()
    .then((serverConfig) => {
      clips = serverConfig.clips ?? []
      clipsHint = serverConfig.clipsHint ?? ''
      renderPanel()
    })
    .catch(() => {
      // Not worth reporting: the connection itself surfaces a server that is down.
    })

  renderAll()
  return root
}

import { RtcSession, stopSessionOnUnload } from '../utils/rtcSession'
import { DEFAULT_CHARACTERS } from '../data/characters'
import { pushToast } from '../utils/toast'
import type { AppConfig } from './configuration'

const DASH_URL = 'https://app.spatius.ai'

/**
 * The room, laid out like the other two modes: characters on the left, the avatar in
 * the middle, controls on the right.
 *
 * What differs is that there is nothing to send. In RTC Mode the avatar is in the
 * call, so the panel holds a microphone and nothing else: no clips to play, and no
 * pause or interrupt, because there is no local playback to act on.
 */
export function createRoom(config: AppConfig): HTMLElement {
  let session: RtcSession | null = null
  let avatarId: string | null = null
  let characterName = ''
  let status = 'Pick a character to enter the room.'
  let rendered = false
  let connecting = false
  let micOn = false
  /**
   * Whether the agent is in the room and listening.
   *
   * Distinct from `rendered`, which only says the avatar has been drawn — that
   * happens several seconds earlier. Gating the microphone on the wrong one of the
   * two let it be opened into an empty room: the button went live, nothing was
   * listening, and it took a second press once the agent finally arrived.
   */
  let agentReady = false
  /**
   * Whether the microphone has ever been opened in this room.
   *
   * Drives the green ring, which points at the mic the moment it becomes usable and
   * stops for good once it has been pressed — same as the character list. Not
   * `!micOn`, or the ring would come back every time the mic is muted, long after
   * the user has learned where it is.
   */
  let micUsed = false
  let adding = false
  let customChars: { id: string; name: string }[] = []

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
        <span class="avatar-count" data-name>RTC Mode</span>
      </div>
      <div class="canvas-stage">
        <div class="avatar-canvas grid-1">
          <div class="canvas-cell active-cell">
            <div class="canvas-container" data-stage></div>
            <div class="canvas-empty" data-empty>Select a character to get started</div>
            <div class="canvas-loading" data-loading hidden></div>
          </div>
        </div>
        <!-- Nothing over the avatar here. The other two modes put pause and
             interrupt there because they drive playback; in RTC Mode the avatar is
             in the call and there is no local playback to act on — closing the
             microphone is the only control, and it lives in the panel. -->
      </div>
    </div>

    <div class="playground-right"><div class="control-panel" data-panel></div></div>
  `

  const charItems = root.querySelector<HTMLElement>('[data-char-items]')!
  const stage = root.querySelector<HTMLElement>('[data-stage]')!
  const emptyHint = root.querySelector<HTMLElement>('[data-empty]')!
  const loadingHint = root.querySelector<HTMLElement>('[data-loading]')!
  const nameLabel = root.querySelector<HTMLElement>('[data-name]')!
  const panel = root.querySelector<HTMLElement>('[data-panel]')!

  // Nodes that outlive a render, rather than being rebuilt inside one.
  //
  // A click only fires when mousedown and mouseup land on the same element, so a
  // control replaced mid-press swallows the press with nothing in the console to
  // show for it.
  const charButtons = new Map<string, HTMLButtonElement>()

  /** Holds whichever of the two trailing entries is currently showing. */
  const customSlot = document.createElement('div')

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

  const realtimePanel = document.createElement('div')
  realtimePanel.className = 'realtime-panel'

  const micHeading = document.createElement('h4')
  micHeading.textContent = 'Microphone'

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

  realtimePanel.appendChild(micHeading)
  realtimePanel.appendChild(micBtn)
  realtimePanel.appendChild(micState)

  /** Shown in the microphone's place until the avatar has been drawn. */
  const statusText = document.createElement('p')
  statusText.className = 'status'

  const panelHint = document.createElement('p')
  panelHint.className = 'realtime-hint'
  panelHint.textContent =
    'RTC Mode is the one path where the avatar joins the call itself: audio ' +
    'travels on an RTC track and the motion rides along encoded in the video ' +
    'stream. Nothing is driven from this page, and nothing streams through the ' +
    'server — it only issues the credentials to join.'

  /** Which of the two trailing entries the custom slot shows. */
  let customSlotShowsInput: boolean | null = null

  // ---------------------------------------------------------------- characters

  function renderCharacters() {
    const all = [...DEFAULT_CHARACTERS, ...customChars]
    // Until a character is picked there is nothing to render and every other
    // control is inert, which reads as a broken page rather than a first step.
    charItems.classList.toggle('needs-pick', !avatarId)

    // Reused across renders rather than rebuilt: a click only fires when
    // mousedown and mouseup land on the same node, and this list re-renders on
    // every state change — rebuilding mid-press swallows the click silently.
    for (const c of all) {
      let btn = charButtons.get(c.id)
      if (!btn) {
        btn = document.createElement('button')
        btn.innerHTML = `
          <span class="character-avatar">${c.name.charAt(0)}</span>
          <span class="character-name">${c.name}</span>
        `
        btn.addEventListener('click', () => void enter(c.id, c.name))
        charButtons.set(c.id, btn)
      }
      btn.className = `character-item ${connecting && avatarId === c.id ? 'loading' : ''}`
      btn.disabled = connecting || session !== null
      // Only on first insertion. `appendChild` on a node that is already a child
      // detaches and re-inserts it, which cancels a click in progress.
      if (btn.parentElement !== charItems) charItems.appendChild(btn)
    }

    // The trailing entry — either the "Custom ID" button or the input that
    // replaces it — is the only part that genuinely swaps.
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
        addBtn.disabled = !field.value.trim()
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

  // ---------------------------------------------------------------- room

  async function enter(id: string, name: string) {
    if (session) return
    avatarId = id
    characterName = name
    connecting = true
    renderAll()

    const next = new RtcSession({
      onProgress: (text) => { status = text; renderAll() },
      onDownload: (percent) => { status = `Downloading avatar… ${percent}%`; renderAll() },
      onRendered: () => { rendered = true; renderAll() },
      onError: (message) => pushToast(message),
    })
    session = next

    // True once this session has been replaced or torn down. Every await below
    // checks it, so the steps that follow do not run against a disconnected one.
    const superseded = () => session !== next

    try {
      await next.start(stage, id, config.language)
      if (superseded()) return
      status = 'Connecting the agent…'
      renderAll()

      // Not awaited: the avatar is on screen and the panel is usable as soon as
      // the room is up, and the agent takes seconds longer to come round. Holding
      // this open until then left the right-hand panel empty for the whole wait,
      // so the room looked like it had failed to load.
      //
      // "The agent joined" is not the thing to wait for either — at join time its
      // session is still starting up and speech arriving then is dropped, which
      // presents as a room that connects but never answers. waitForAgent() waits
      // for the ready attribute the worker sets after that.
      void next.waitForAgent().then((joined) => {
        if (superseded()) return
        if (!joined) {
          // Almost always the worker: it is a separate process, and if it failed
          // to start there is nothing in the room to talk to.
          pushToast('The agent did not join — check the server log for the worker.')
          status = 'No agent in the room. The avatar cannot hear or answer you.'
          renderAll()
          return
        }
        // The microphone is left to the button. Opening it here as well gave the
        // same action two entry points racing each other, and the browser wants a
        // user gesture for it anyway.
        agentReady = true
        status = 'Ready — tap the microphone to talk.'
        renderAll()
      })
    } catch (e: any) {
      if (superseded()) return
      pushToast(e?.message ?? 'Could not enter the room')
      status = 'Could not enter the room.'
      await next.stop()
      session = null
      avatarId = null
    } finally {
      if (!superseded()) {
        connecting = false
        renderAll()
      }
    }
  }

  async function toggleMic() {
    // agentReady as well as the disabled attribute: opening the microphone into a
    // room with nothing listening is the failure this ordering exists to prevent,
    // and a guard in the handler holds even if the button is reached another way.
    if (!session || !agentReady) return
    try {
      // Asked of the session rather than read from `micOn`: the two can drift, and
      // acting on the stale one means publishing an already-open microphone, which
      // the SDK rejects.
      if (session.micActive) {
        await session.unpublishMic()
        micOn = false
        status = 'Microphone closed — the avatar cannot hear you.'
      } else {
        await session.publishMic()
        micOn = true
        micUsed = true
        status = 'Just talk — the agent decides when your turn ends.'
      }
    } catch (e: any) {
      pushToast(e?.message ?? 'Could not switch the microphone')
    }
    renderAll()
  }

  /**
   * Sessions bill from the moment they are created, so leaving has to close the
   * room rather than waiting for its timeout to reap it.
   */
  window.addEventListener('pagehide', () => {
    const id = session?.id
    if (id) stopSessionOnUnload(id)
  })

  // ---------------------------------------------------------------- panel

  function renderPanel() {
    // The panel is assembled once and then only updated. Clearing it here would
    // detach the microphone on every render — and this runs on every state
    // change. Detaching a button between mousedown and mouseup cancels the
    // click, so pressing it would do nothing at all, with nothing in the console
    // to show for it.
    //
    // No status bar here. The other two modes list the SDK callbacks that report
    // on driving the avatar; in RTC Mode nothing is driven from this page — the
    // avatar is in the call — so there is nothing to report.
    if (!panel.firstChild) {
      const heading = document.createElement('h3')
      heading.textContent = 'Controls'
      panel.appendChild(heading)
      panel.appendChild(realtimePanel)
      panel.appendChild(statusText)
      panel.appendChild(panelHint)
    }

    // Shown as soon as the avatar is on screen, not once the agent is ready: the
    // agent takes seconds longer, and an empty panel for that whole time read as
    // a room that had failed to load. The button is here but inert until there is
    // something in the room to hear it.
    realtimePanel.hidden = !rendered
    statusText.hidden = rendered

    if (rendered) {
      micBtn.className = `mic-btn ${micOn ? 'on' : ''} ${agentReady && !micUsed ? 'needs-pick' : ''}`
      micBtn.disabled = !agentReady
      micBtn.title = !agentReady
        ? 'Waiting for the agent to join'
        : micOn
          ? 'Mute the microphone'
          : 'Unmute the microphone'
      micState.textContent = status
    } else {
      statusText.textContent = status
    }
  }

  function renderAll() {
    nameLabel.textContent = characterName || 'RTC Mode'
    emptyHint.hidden = !!avatarId
    loadingHint.hidden = !avatarId || rendered
    loadingHint.textContent = status
    renderCharacters()
    renderPanel()
  }

  renderAll()
  return root
}

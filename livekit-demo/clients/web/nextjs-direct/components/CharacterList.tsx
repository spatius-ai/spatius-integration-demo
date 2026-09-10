'use client'

import { useState } from 'react'
import { DEFAULT_CHARACTERS } from '@/data/characters'

const DASH_URL = 'https://app.spatius.ai'

interface Character {
  id: string
  name: string
}

interface Props {
  loadingId: string | null
  loadProgress: number
  onSelect: (id: string, name: string) => void
  /** Nothing on the canvas yet, so this list is the only thing worth clicking. */
  empty?: boolean
}

export default function CharacterList({ loadingId, loadProgress, onSelect, empty }: Props) {
  const [adding, setAdding] = useState(false)
  const [customId, setCustomId] = useState('')
  const [customChars, setCustomChars] = useState<Character[]>([])

  const handleAdd = () => {
    const id = customId.trim()
    if (!id) return
    if ([...DEFAULT_CHARACTERS, ...customChars].some(c => c.id === id)) return
    const name = `Custom (${id.slice(0, 6)}...)`
    setCustomChars(prev => [...prev, { id, name }])
    setCustomId('')
    setAdding(false)
  }

  const allChars = [...DEFAULT_CHARACTERS, ...customChars]

  return (
    <div className="character-list">
      <h3>Characters</h3>
      {/*
        Until a character is picked there is nothing to render and every other
        control is inert, which reads as a broken page rather than a first step.
        The pulse stops the moment one is chosen — it points at what to do next,
        so it has no reason to keep running afterwards.
      */}
      <div className={`character-items ${empty ? 'needs-pick' : ''}`}>
        {allChars.map(c => (
          <button
            key={c.id}
            className={`character-item ${loadingId === c.id ? 'loading' : ''}`}
            disabled={loadingId !== null}
            onClick={() => onSelect(c.id, c.name)}
          >
            <span className="character-avatar">
              {c.name.charAt(0)}
            </span>
            <span className="character-name">{c.name}</span>
            {loadingId === c.id && <span className="character-progress">{Math.round(loadProgress * 100)}%</span>}
          </button>
        ))}

        {adding ? (
          <div className="custom-id-input">
            <input
              value={customId}
              onChange={e => setCustomId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="Paste character ID"
              autoFocus
            />
            <div className="custom-id-actions">
              <button className="primary" disabled={!customId.trim() || loadingId !== null} onClick={handleAdd}>Add</button>
              <button className="secondary" onClick={() => { setAdding(false); setCustomId('') }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="character-item add-btn" onClick={() => setAdding(true)}>
            <span className="character-avatar add-avatar">+</span>
            <span className="character-name">Custom ID</span>
          </button>
        )}
      </div>

      <a className="guide-thumb list-guide" href={DASH_URL} target="_blank" rel="noreferrer">
        <img src="/public-avatar-guide.png" alt="Where to find character IDs" />
      </a>
    </div>
  )
}

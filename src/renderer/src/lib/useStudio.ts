import { useEffect, useState } from 'react'
import type { AppState } from '../../../shared/types'
import type { StudioData } from '../../../shared/studio'

/** The open book's data: on open, after every state push, and every 5 s (R2). */
export function useStudio(state: AppState | null): StudioData | null {
  const [data, setData] = useState<StudioData | null>(null)
  const dir = state?.book?.dir ?? null
  useEffect(() => {
    setData(null)
    if (!dir) return
    let live = true
    const load = () => void window.api.studioRead().then(d => { if (live) setData(d) }, () => {})
    load()
    // ponytail: a 5 s poll catches Claude's terminal edits; a file watcher if large books make it slow.
    const t = setInterval(load, 5000)
    const off = window.api.onState(load)
    return () => { live = false; clearInterval(t); off() }
  }, [dir])
  return data
}

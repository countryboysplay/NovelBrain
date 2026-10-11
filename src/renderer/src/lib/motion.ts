import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { storyEvents, type Card } from './selectors'

export const reducedMotion = (): boolean =>
  document.documentElement.dataset.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A View Transition when it can play; otherwise the update happens at once. */
export function withTransition(update: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!doc.startViewTransition || reducedMotion()) return update()
  // A window that is not painting (hidden, or throttled in the background) never reaches the transition's callback; the update then lands on its own.
  let done = false
  const once = () => { if (!done) { done = true; flushSync(update) } }
  doc.startViewTransition(once)
  setTimeout(once, 250)
}

/** Story events per card id, kept for 2.4 s so their CSS animations can play once. */
export function useStoryEvents(cards: Card[]): Map<string, Set<string>> {
  const prev = useRef<Card[] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const [active, setActive] = useState(() => new Map<string, Set<string>>())
  useEffect(() => {
    const events = storyEvents(prev.current, cards)
    prev.current = cards
    if (!events.length) return
    const m = new Map<string, Set<string>>()
    for (const e of events) m.set(e.id, (m.get(e.id) ?? new Set()).add(e.kind === 'verdict' ? `verdict:${e.reviewer}` : e.kind))
    setActive(m)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setActive(new Map()), 2400)
  }, [cards])
  useEffect(() => () => clearTimeout(timer.current), [])
  return active
}

/** A number that eases to its new value (the word count rising); instant under reduced motion. */
export function useTween(value: number, ms = 700): number {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (reducedMotion() || from.current === value) { from.current = value; setShown(value); return }
    const start = performance.now(), a = from.current
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      setShown(Math.round(a + (value - a) * (1 - (1 - k) ** 3)))
      if (k < 1) raf = requestAnimationFrame(step); else from.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

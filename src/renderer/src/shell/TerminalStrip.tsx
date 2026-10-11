import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Terminal } from '../Terminal'

export const TERMINAL_WIDTH = { min: 320, max: 1600 } // mirrors uiSettings in src/main/settings.ts
const clamp = (w: number) => Math.round(Math.min(TERMINAL_WIDTH.max, Math.max(TERMINAL_WIDTH.min, w)))

export function TerminalStrip({ open, width, onToggle, onWidth, project }: { open: boolean; width: number; onToggle: () => void; onWidth: (px: number) => void; project: string | null }) {
  const [live, setLive] = useState<number | null>(null) // while a drag is going; the setting is written once, on release
  const w = live ?? width
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const grip = e.currentTarget, x0 = e.clientX, w0 = width
    grip.setPointerCapture(e.pointerId)
    const at = (ev: globalThis.PointerEvent) => clamp(w0 + ev.clientX - x0)
    const move = (ev: globalThis.PointerEvent) => setLive(at(ev))
    const up = (ev: globalThis.PointerEvent) => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up)
      setLive(null); onWidth(at(ev))
    }
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 128 : 32
    const next = { ArrowLeft: w - step, ArrowRight: w + step, Home: TERMINAL_WIDTH.min, End: TERMINAL_WIDTH.max }[e.key]
    if (next === undefined) return
    e.preventDefault(); onWidth(clamp(next))
  }
  return (
    <div className={`term-strip${open ? ' open' : ''}`} style={{ ['--tw' as string]: `${w}px` }}>
      <button className="term-tab" aria-expanded={open} aria-controls="terminal" aria-keyshortcuts="Control+`" title="Ctrl+`" onClick={onToggle}>
        <span>Claude terminal</span>
      </button>
      <div id="terminal" className="term-body" hidden={!open}><Terminal project={project} open={open} /></div>
      {open && (
        <div className="term-grip" role="separator" aria-orientation="vertical" aria-label="Terminal width" aria-valuenow={w} aria-valuemin={TERMINAL_WIDTH.min} aria-valuemax={TERMINAL_WIDTH.max}
          tabIndex={0} title="Drag, or use the arrow keys" onPointerDown={drag} onKeyDown={key} />
      )}
    </div>
  )
}

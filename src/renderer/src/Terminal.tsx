import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

const currentTheme = (el: Element) => ({ background: getComputedStyle(el).getPropertyValue('--term-bg').trim(), foreground: getComputedStyle(el).getPropertyValue('--term-fg').trim(), cursor: getComputedStyle(el).getPropertyValue('--accent').trim() })

export function Terminal({ project, open = true }: { project: string | null; open?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<XTerm>()
  const refit = useRef<() => void>()
  const [ended, setEnded] = useState(false)

  useEffect(() => {
    const t = new XTerm({
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize: 14,
      cursorBlink: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      screenReaderMode: true,
      theme: currentTheme(host.current!)
    })
    const fit = new FitAddon()
    t.loadAddon(fit)
    t.open(host.current!)
    term.current = t
    t.attachCustomKeyEventHandler(e => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyC' && t.hasSelection()) {
        void navigator.clipboard.writeText(t.getSelection())
        return false
      }
      return true
    })
    const resize = () => {
      if (host.current!.clientWidth < 200) return
      fit.fit()
      window.api.ptyResize(t.cols, t.rows)
    }
    refit.current = resize
    resize()
    t.onData(d => window.api.ptyWrite(d))
    const ro = new ResizeObserver(resize)
    ro.observe(host.current!)
    const offs = [
      window.api.onPtyData(d => {
        setEnded(false)
        t.write(d)
      }),
      window.api.onPtyExit(() => setEnded(true))
    ]
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onThemeChange = () => {
      t.options.theme = currentTheme(host.current!)
    }
    media.addEventListener('change', onThemeChange)
    return () => {
      offs.forEach(off => off())
      ro.disconnect()
      media.removeEventListener('change', onThemeChange)
      t.dispose()
    }
  }, [])

  useEffect(() => {
    term.current?.reset()
    setEnded(false)
  }, [project])
  // The strip unfolds: fit to it once it has its size (a hidden host measured 0, so the observer's last fit was for nothing).
  useEffect(() => { if (open) { const t = setTimeout(() => refit.current?.(), 0); return () => clearTimeout(t) } }, [open])

  return (
    <section className="terminal-area" aria-label="Claude Code terminal">
      <div ref={host} className="terminal" role="group" aria-label="Claude Code terminal. Press F6 to leave it." />
      {ended && (
        <div className="overlay" role="alert">
          <p>Session ended</p>
          <button
            onClick={() => {
              void window.api.restartClaude()
              host.current?.querySelector('textarea')?.focus()
            }}
          >
            Restart
          </button>
        </div>
      )}
      {!project && (
        <div className="overlay">
          <p>Open or create a book to start Claude Code.</p>
          <button className="primary" onClick={() => void window.api.pickBook()}>
            Open book…
          </button>
        </div>
      )}
    </section>
  )
}

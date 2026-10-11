import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RoomEntry } from '../../../shared/types'
import type { StudioData } from '../../../shared/studio'
import { pigmentOf, type CrewState } from '../../../shared/crew'
import { ROOM_CHANNELS, roomChannels, type RoomChannel } from '../../../shared/room'
import type { ViewProps } from '../views'
import { Avatar } from '../Avatar'
import { memberOf, shownName, useCrew } from '../lib/crew'
import { roomGroups, typing, unread } from '../lib/room'
import { reducedMotion } from '../lib/motion'

// The Writers' room, laid out like a chat server: channels are filters over run/room.jsonl (display only; nothing here decides anything).
// Every model-written string is a plain text node.
const PURPOSE: Record<RoomChannel, string> = {
  general: 'Everything said in the room, one thread per scene or check.',
  showrunner: "The showrunner's calls and the app's own lines: accepted, parked, released, usage stops.",
  drafting: 'Handoffs to the author and what it reports back.',
  reviews: "Every reviewer's verdict and its first finding.",
  'needs-you': 'What waits for you: parked scenes, author changes and proposed skills.'
}
const clock = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const ink = (role: string) => `var(--ink-${pigmentOf(role)})`

/** A step's title from the plan: a scene's title, or its chapter's or act's. */
function stepTitle(data: StudioData | null, step: string): string | null {
  if (!data) return null
  const plan = data.scenes[step]?.plan?.title
  if (plan) return plan
  for (const act of data.outline.acts) {
    if (act.id === step) return act.title
    for (const ch of act.chapters) if (ch.id === step) return ch.title
  }
  return step === 'BOOK' ? 'The whole book' : null
}

function Message({ e, crew, step }: { e: RoomEntry; crew: CrewState | null; step?: boolean }) {
  const tag = step ? <span className="msg-step">{e.step}</span> : null
  if (e.kind === 'system') return <li className="msg system">{tag}<span>{e.text}</span> <time dateTime={e.at}>{clock(e.at)}</time></li>
  const m = memberOf(crew, e.from)
  const to = e.to ? shownName(memberOf(crew, e.to), e.to) : null
  return (
    <li className={`msg${e.verdict ? ` v-${e.verdict.toLowerCase()}` : ''}`}>
      <Avatar member={m} role={e.from} />
      <div className="msg-body">
        <p className="who">
          <span className="name" style={{ color: ink(e.from) }}>{shownName(m, e.from)}</span>
          {to && <span className="to"> to {to}</span>}
          {e.verdict && <span className="verdict"> {e.verdict}</span>}
          {' '}{tag}<time dateTime={e.at}>{clock(e.at)}</time>
        </p>
        <p className="said">{e.text}</p>
      </div>
    </li>
  )
}

export function RoomView({ state, data, mem, settings, save, go }: ViewProps) {
  const crew = useCrew()
  const [entries, setEntries] = useState<RoomEntry[] | null>(null) // null until the first read: the log mounts with its history, never announcing it
  const [channel, setChannel] = useState<RoomChannel>('general')
  const [opened, setOpened] = useState<Record<string, boolean>>({}) // threads the writer opened or closed; the latest is open by default
  const [allMembers, setAllMembers] = useState(false)
  const [atEnd, setAtEnd] = useState(true)
  const pending = useRef<RoomEntry[]>([])
  const onScreen = useRef<RoomEntry[] | null>(null)
  onScreen.current = entries
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    const off = window.api.onRunRoom(es => { pending.current.push(...es) })
    // ponytail: an entry pushed while the first read is in flight may show twice; harmless, the room is display only.
    void window.api.roomRead().then(es => { if (alive) setEntries(es) })
    // Additions land in the log in one batch every 2 s: the polite live region announces a batch, not every line (R12).
    const t = setInterval(() => {
      if (!pending.current.length) return
      const add = pending.current.splice(0)
      setEntries(x => [...(x ?? []), ...add].slice(-2000))
    }, 2000)
    return () => { alive = false; off(); clearInterval(t) }
  }, [])
  // A channel counts as seen when the writer opens it and again when they leave it (its unread count is then 0), up to the
  // newest entry on screen: lines still waiting in the 2 s batch stay unread.
  useEffect(() => {
    const seen = () => {
      const newest = (onScreen.current ?? []).reduce((a, e) => (e.at > a ? e.at : a), '')
      if (newest) void save({ ui: { roomSeen: { [channel]: newest } } })
    }
    seen()
    return seen
  }, [channel])
  useLayoutEffect(() => { if (atEnd && box.current) box.current.scrollTop = box.current.scrollHeight }, [entries, atEnd, channel])

  if (!entries) return <section className="view room" aria-labelledby="view-title"><h2 id="view-title">Writers' room</h2></section>
  const run = state.run
  const who = typing(entries, run?.status === 'running' && run.current ? run.current.id : null)
  const shown = channel === 'general' ? entries : entries.filter(e => roomChannels(e).includes(channel))
  const groups = roomGroups(shown)
  const waiting = channel === 'needs-you' ? [
    ...state.parked.map(p => `${p.scene} is parked: ${p.reason}`),
    ...state.changes.map(c => `Author change ${c.id} waits for your preview: ${c.summary}`),
    ...(mem?.proposals ?? []).map(p => `Proposed skill ${p.name}: ${p.description}`)
  ] : []
  const members = crew?.members ?? []
  const idle = members.filter(m => m.role !== who)
  const working = who ? memberOf(crew, who) : undefined

  return (
    <section className="view room" aria-labelledby="view-title">
      <h2 id="view-title">Writers' room</h2>
      <div className="room-grid">
        <nav className="channels" aria-label="Channels">
          <ul>
            {ROOM_CHANNELS.map(c => {
              const n = c === channel ? 0 : unread(entries, c, settings.ui.roomSeen[c])
              return (
                <li key={c}>
                  <button type="button" className={c === channel ? 'on' : undefined} aria-current={c === channel ? 'true' : undefined} onClick={() => { setChannel(c); setAtEnd(true) }}>
                    <span aria-hidden="true">#</span><span className="sr-only">channel </span>{c}
                    {n > 0 && <b className="unread"><span className="sr-only">, </span>{n}<span className="sr-only"> unread</span></b>}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="channel paper">
          <header className="channel-head">
            <h3><span aria-hidden="true">#</span>{channel}</h3>
            <p>{PURPOSE[channel]}</p>
          </header>
          <div className="room-scroll" ref={box} tabIndex={0} role="region" aria-label={`#${channel} messages`} onScroll={ev => { const el = ev.currentTarget; setAtEnd(el.scrollHeight - el.scrollTop - el.clientHeight < 40) }}>
            {waiting.length > 0 && (
              <div className="waiting">
                <ul>{waiting.map((w, i) => <li key={i}>{w}</li>)}</ul>
                <button type="button" className="link" onClick={() => go('needs-you')}>Open Needs you</button>
              </div>
            )}
            {/* One live region per channel (key): a switch mounts a fresh one, so only later 2 s batches are announced. */}
            <div key={channel} role="log" aria-live="polite" aria-relevant="additions" aria-label="Writers' room messages">
              {shown.length === 0 && <p className="quiet">{entries.length === 0 ? 'Nothing yet. Start a run and the room fills with what the agents say to each other.' : 'Nothing in this channel yet.'}</p>}
              {channel === 'general'
                ? groups.map((g, i) => {
                    const key = `${g.step}-${g.entries[0].at}`, open = opened[key] ?? i === groups.length - 1
                    const title = stepTitle(data, g.step)
                    return (
                      <section key={key} className="thread" aria-labelledby={`thread-${i}`}>
                        <h4 id={`thread-${i}`}>
                          <button type="button" aria-expanded={open} aria-controls={`thread-list-${i}`} onClick={() => setOpened(o => ({ ...o, [key]: !open }))}>
                            {[g.step, title, `${g.entries.length} ${g.entries.length === 1 ? 'message' : 'messages'}`].filter(Boolean).join(' · ')}
                          </button>
                        </h4>
                        <ol id={`thread-list-${i}`} hidden={!open}>{g.entries.map((e, j) => <Message key={j} e={e} crew={crew} />)}</ol>
                      </section>
                    )
                  })
                : <ol>{shown.map((e, j) => <Message key={j} e={e} crew={crew} step />)}</ol>}
            </div>
            {who && !reducedMotion() && (
              <p className="typing" aria-hidden="true">
                <Avatar member={working} role={who} size={24} />
                <span className="dots"><i /><i /><i /></span>
              </p>
            )}
          </div>
          {!atEnd && <button type="button" className="jump" onClick={() => setAtEnd(true)}>Jump to latest</button>}
          <p className="sr-only">{who ? `${shownName(working, who)} is working.` : ''}</p>
        </div>

        <aside className={`members${allMembers ? ' all' : ''}`} aria-labelledby="members-title">
          <h3 id="members-title">Members</h3>
          {working && who && (
            <>
              <h4 id="members-working">Working now</h4>
              <ul aria-labelledby="members-working"><Member role={who} crew={crew} live /></ul>
            </>
          )}
          <button type="button" className="link more" aria-expanded={allMembers} aria-controls="members-idle" onClick={() => setAllMembers(!allMembers)}>{allMembers ? 'Fewer members' : `All members (${members.length + 1})`}</button>
          <div id="members-idle" className="idle">
            <h4 id="members-idle-title">Idle</h4>
            <ul aria-labelledby="members-idle-title">
              <li className="member you"><span className="avatar initials" aria-hidden="true" style={{ width: 32, height: 32 }}>You</span><span><span className="name">You</span><span className="about">The writer</span></span></li>
              {idle.map(m => <Member key={m.role} role={m.role} crew={crew} />)}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  )
}

function Member({ role, crew, live }: { role: string; crew: CrewState | null; live?: boolean }) {
  const m = memberOf(crew, role)
  return (
    <li className="member">
      <span className="face"><Avatar member={m} role={role} />{live && <i className="live-dot" aria-hidden="true" />}</span>
      <span>
        <span className="name">{shownName(m, role)}</span>
        <span className="about">{m?.label ?? role}{m?.about ? `. ${m.about}` : ''}</span>
      </span>
    </li>
  )
}

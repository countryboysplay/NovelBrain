import { expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chapterRules, tracked, weigh } from '../src/main/memory/evidence'
import type { Meta } from '../src/main/memory/files'

const meta: Meta = { name: 'filter-words', type: 'catch', summary: 's', sources: [], verified: '2026-10-04', used: '2026-10-04', uses: 0, stale: false, pinned: false, status: 'live', by: '', rules: ['SK-ENG-04'], quiet: 0, hits: 0, live: '2026-10-01' }
const finding = (verdict: string, rule: string) => `1. ${verdict}. Rule: ${rule}\n   Quote: "x"\n   Problem: y\n   Fix: z\n`

function book() {
  const d = mkdtempSync(join(tmpdir(), 'nb-ev-'))
  mkdirSync(join(d, 'outline'))
  writeFileSync(join(d, 'outline', 'outline.yaml'), 'acts:\n  - id: ACT-1\n    title: A\n    chapters:\n      - { id: CH-01, title: One, scenes: [SC-001, SC-002] }\n      - { id: CH-02, title: Two, scenes: [SC-003] }\n')
  const review = (id: string, name: string, body: string) => {
    mkdirSync(join(d, 'reviews', id), { recursive: true })
    writeFileSync(join(d, 'reviews', id, `${name}.md`), `---\nscene: ${id}\nreviewer: ${name}\nround: 1\nverdict: FLAG\n---\n\n${body}`)
  }
  return { d, review }
}

test('chapterRules takes FLAG and FAIL rule ids from the chapter scenes and the chapter itself, never story ids', () => {
  const { d, review } = book()
  review('SC-001', 'line', finding('FLAG', 'SK-ENG-04') + finding('FAIL', 'CP-CHK-01') + finding('FLAG', 'GATE-DRAFT-02'))
  review('SC-002', 'continuity', finding('FAIL', 'FACT-003') + 'SK-ENG-08 was considered and is fine.\n')
  review('SC-002', 'audience', 'No findings.\n')
  review('CH-01', 'arc', finding('FLAG', 'CHAR-AMOS (static)') + finding('FLAG', 'CHAR-RUTH arcBeats "x" and CC-CHK-04'))
  review('SC-003', 'line', finding('FLAG', 'SK-ENG-01')) // another chapter
  writeFileSync(join(d, 'reviews', 'SC-001', 'park.md'), '---\nscene: SC-001\nreason: x\n---\n1. FAIL. Rule: MG-CON-02\n')
  expect([...chapterRules(d, 'CH-01')].sort()).toEqual(['CC-CHK-04', 'CP-CHK-01', 'GATE-DRAFT-02', 'SK-ENG-04'])
  expect(chapterRules(d, 'CH-09').size).toBe(0)
})

test('weigh: a hit resets the quiet count; two hits since live mean probation; three quiet chapters retire', () => {
  const hit = new Set(['SK-ENG-04']), none = new Set<string>()
  let w = weigh(meta, hit)
  expect(w).toMatchObject({ outcome: 'none', meta: { hits: 1, quiet: 0 } })
  w = weigh(w.meta, none)
  expect(w).toMatchObject({ outcome: 'none', meta: { hits: 1, quiet: 1 } })
  w = weigh(w.meta, hit)
  expect(w).toMatchObject({ outcome: 'probation', meta: { status: 'probation', hits: 0, quiet: 0, live: '' } })
  let q = weigh(meta, none)
  q = weigh(q.meta, none)
  expect(q.outcome).toBe('none')
  expect(weigh(q.meta, none).outcome).toBe('retire')
})

test('only live, unpinned catches with rule ids are tracked', () => {
  expect(tracked(meta)).toBe(true)
  for (const m of [{ ...meta, status: 'probation' as const }, { ...meta, pinned: true }, { ...meta, rules: [] }, { ...meta, type: 'craft' as const }]) expect(tracked(m)).toBe(false)
})

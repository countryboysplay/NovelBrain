import { describe, it, test, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaults, loadSettings, saveSettings, addRecent, patchSettings } from '../src/main/settings'

const dir = mkdtempSync(join(tmpdir(), 'nb-settings-'))

describe('loadSettings', () => {
  it('returns defaults when the file is missing', () => expect(loadSettings(join(dir, 'none.json'))).toEqual(defaults()))
  it('returns defaults when the file is corrupt', () => {
    const f = join(dir, 'corrupt.json')
    writeFileSync(f, '{not json')
    expect(loadSettings(f)).toEqual(defaults())
  })
  it('repairs wrong-typed fields', () => {
    const f = join(dir, 'wrong.json')
    writeFileSync(f, JSON.stringify({ recentBooks: 'C:\\x', skipped: null, headroom: false }))
    const s = loadSettings(f)
    expect(s.recentBooks).toEqual([])
    expect(s.skipped).toEqual([])
    expect(s.headroom).toBe(false)
  })
  it('repairs wrong-typed headroom, ponytail and tab to defaults', () => {
    const f = join(dir, 'wrong-rest.json')
    writeFileSync(f, JSON.stringify({ headroom: 'false', ponytail: 1, tab: 5 }))
    expect(loadSettings(f)).toEqual(defaults())
  })
  it('keeps valid headroom, ponytail and tab values', () => {
    const f = join(dir, 'valid-rest.json')
    writeFileSync(f, JSON.stringify({ headroom: false, ponytail: false, tab: 'graph' }))
    const s = loadSettings(f)
    expect(s.headroom).toBe(false)
    expect(s.ponytail).toBe(false)
    expect(s.tab).toBe('graph')
  })
  test('memory settings default and are validated', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'nb-set-')), 's.json')
    // dailyCap and enabled from an old settings file are dropped: no daily limit, and memory is always on.
    writeFileSync(f, JSON.stringify({ memory: { dailyCap: 5, enabled: false, model: 'bad model;rm', auditModel: 'x y', deepAuditModel: 'opus-4', indexCap: 20 } }))
    expect(loadSettings(f).memory).toEqual({ model: 'haiku', deepModel: 'sonnet', auditModel: 'sonnet', deepAuditModel: 'opus-4', indexCap: 20 })
    // A lesson is never audited by its own writer: equal auditors fall back to the defaults.
    writeFileSync(f, JSON.stringify({ memory: { auditModel: 'haiku', deepAuditModel: 'haiku' } }))
    expect(loadSettings(f).memory).toMatchObject({ auditModel: 'sonnet', deepAuditModel: 'opus' })
    expect(defaults().memory).toEqual({ model: 'haiku', deepModel: 'sonnet', auditModel: 'sonnet', deepAuditModel: 'opus', indexCap: 60 })
  })
  it('does not share arrays between loads', () => {
    const a = loadSettings(join(dir, 'none.json'))
    a.skipped.push('uv')
    expect(loadSettings(join(dir, 'none.json')).skipped).toEqual([])
  })
  it('round-trips and creates missing folders', () => {
    const f = join(dir, 'nested', 'settings.json')
    saveSettings(f, { ...defaults(), headroom: false, recentBooks: ['C:\\a b'] })
    expect(loadSettings(f)).toMatchObject({ headroom: false, recentBooks: ['C:\\a b'] })
  })

  it('usage stop point defaults to 90 and must be a whole percent from 1 to 100', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'nb-set-')), 's.json')
    expect(defaults().usage).toEqual({ stopAt: 90 })
    for (const [v, want] of [[75, 75], [100, 100], [1, 1], [0, 90], [150, 90], [80.5, 90], ['80', 90], [null, 90]] as const) {
      writeFileSync(f, JSON.stringify({ usage: { stopAt: v } }))
      expect(loadSettings(f).usage.stopAt).toBe(want)
    }
    writeFileSync(f, JSON.stringify({ usage: 'high' }))
    expect(loadSettings(f).usage).toEqual({ stopAt: 90 })
  })
  test('ui and model settings default and are validated', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'nb-set-')), 's.json')
    writeFileSync(f, JSON.stringify({ ui: { theme: 'neon', motion: 'reduced', terminalOpen: 'yes', reader: { size: 99, spacing: 1.8, font: 'dyslexic' } }, models: { showrunner: 'rm -rf' } }))
    const s = loadSettings(f)
    expect(s.ui).toEqual({ theme: 'system', motion: 'reduced', terminalOpen: false, terminalWidth: 640, reader: { font: 'dyslexic', size: 19, spacing: 1.8 }, roomSeen: {} })
    expect(s.models).toEqual({ showrunner: 'opus' })
  })
  test("the Writers' room last-seen times keep known channels with real times, and a patch merges them", () => {
    const f = join(mkdtempSync(join(tmpdir(), 'nb-set-')), 's.json')
    const at = '2026-10-05T12:00:00.000Z'
    writeFileSync(f, JSON.stringify({ ui: { roomSeen: { general: at, reviews: 'soon', drafting: 5, showrunner: '5', 'needs-you': 'Oct 5, 2026', '__proto__': at, evil: at } } }))
    const s = loadSettings(f)
    expect(s.ui.roomSeen).toEqual({ general: at })
    expect(patchSettings(s, { ui: { roomSeen: { 'needs-you': at, general: 'x'.repeat(50) } } })!.ui.roomSeen).toEqual({ general: at, 'needs-you': at })
    expect(loadSettings(join(f, '..', 'none.json')).ui.roomSeen).toEqual({})
  })
  test('a patch keeps the current value for anything invalid and ignores unknown memory keys', () => {
    const s = defaults()
    const next = patchSettings(s, { ui: { theme: 'day', reader: { size: 24, font: 'comic' } }, memory: { model: 'sonnet', enabled: false, indexCap: 0 }, models: { showrunner: 'bad model' }, headroom: false, tab: 'cost' })!
    expect(next.ui).toEqual({ ...s.ui, theme: 'day', reader: { ...s.ui.reader, size: 24 } })
    expect(patchSettings(s, { ui: { terminalWidth: 900 } })!.ui.terminalWidth).toBe(900)
    for (const bad of [200, 5000, '640', NaN]) expect(patchSettings(s, { ui: { terminalWidth: bad } })!.ui.terminalWidth).toBe(640)
    expect(next.memory).toEqual({ ...s.memory, model: 'sonnet' }) // `enabled` (the removed switch) is dropped, not stored
    expect(next.models).toEqual({ showrunner: 'opus' })
    expect(next.headroom).toBe(false)
    expect(next.tab).toBe('cost')
    expect(next.recentBooks).toBe(s.recentBooks)
    expect(patchSettings(s, { recentBooks: ['C:/x'] })).toBeNull()
    expect(patchSettings(s, null)).toBeNull()
    expect(patchSettings(s, [])).toBeNull()
    expect(patchSettings(s, { tab: '../../x' })!.tab).toBe(s.tab)
    expect(patchSettings(s, { models: { showrunner: '--verbose' } })!.models.showrunner).toBe(s.models.showrunner)
  })
  test('a patch sets the auditor models and the usage stop point, validated as on load', () => {
    const s = defaults()
    const next = patchSettings(s, { memory: { auditModel: 'haiku', deepAuditModel: 'sonnet' }, usage: { stopAt: 75 } })!
    expect(next.memory).toMatchObject({ auditModel: 'haiku', deepAuditModel: 'sonnet' })
    expect(next.usage).toEqual({ stopAt: 75 })
    // Equal auditors fall back to the defaults; a bad stop point keeps the current one.
    const bad = patchSettings(next, { memory: { auditModel: 'opus', deepAuditModel: 'opus' }, usage: { stopAt: 150 } })!
    expect(bad.memory).toMatchObject({ auditModel: 'sonnet', deepAuditModel: 'opus' })
    expect(bad.usage).toEqual({ stopAt: 75 })
    expect(patchSettings(next, { usage: { stopAt: 80.5 } })!.usage).toEqual({ stopAt: 75 })
  })
})

describe('addRecent', () => {
  it('moves an existing entry to the front, case-insensitively', () =>
    expect(addRecent(['C:\\A', 'C:\\B'], 'c:\\b')).toEqual(['c:\\b', 'C:\\A']))
  it('caps the list at 10', () => {
    const list = Array.from({ length: 10 }, (_, i) => `C:\\p${i}`)
    const out = addRecent(list, 'C:\\new')
    expect(out).toHaveLength(10)
    expect(out[0]).toBe('C:\\new')
    expect(out).not.toContain('C:\\p9')
  })
})

test('claudeVersion defaults to null, keeps a plain version and drops anything else; the renderer cannot set it', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'nb set ')), 'settings.json')
  writeFileSync(file, JSON.stringify({ claudeVersion: '2.1.296' }))
  expect(loadSettings(file).claudeVersion).toBe('2.1.296')
  writeFileSync(file, JSON.stringify({ claudeVersion: '<img src=x>' }))
  expect(loadSettings(file).claudeVersion).toBeNull()
  expect(defaults().claudeVersion).toBeNull()
  expect(patchSettings(defaults(), { claudeVersion: '1.0.0' } as never)).toBeNull()
})

import { test, expect, beforeEach } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateBook } from '../src/main/book/validate'

let dir: string
beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'nb-val-')), 'book')
  cpSync(join(__dirname, 'fixtures', 'book-ok'), dir, { recursive: true })
})
const put = (rel: string, text: string) => writeFileSync(join(dir, rel), text)
const messages = () => validateBook(dir).map(e => `${e.file}: ${e.message}`).join('\n')

test('the fixture book is valid', () => expect(validateBook(dir)).toEqual([]))

test('reports a schema error with the file', () => {
  put('outline/scenes/SC-001.yaml', 'id: SC-1\n')
  expect(messages()).toMatch(/outline\/scenes\/SC-001\.yaml: /)
})

test('reports malformed YAML', () => {
  put('canon/facts.yaml', 'facts: [unclosed\n')
  expect(messages()).toMatch(/canon\/facts\.yaml: .*YAML/i)
})

test('a missing book.yaml is an error', () => {
  rmSync(join(dir, 'book.yaml'))
  expect(messages()).toMatch(/book\.yaml: missing/)
})

test('an outlined scene needs a plan file', () => {
  put('outline/outline.yaml', 'acts:\n  - id: ACT-1\n    title: B\n    chapters:\n      - { id: CH-01, title: One, scenes: [SC-001, SC-002] }\n')
  expect(messages()).toMatch(/outline\/outline\.yaml: SC-002 has no plan/)
})

test('a scene plan file must match its id', () => {
  put('outline/scenes/SC-001.yaml', readFileSync(join(dir, 'outline/scenes/SC-001.yaml'), 'utf8').replace('id: SC-001', 'id: SC-009'))
  expect(messages()).toMatch(/does not match its file name/)
})

test('pov, location and mustReveal must exist', () => {
  put('outline/scenes/SC-001.yaml', 'id: SC-001\ntitle: T\ngoal: G\npov: CHAR-TOM\nlocation: LOC-BARN\nstoryTime: d\nbeats: [b]\narcBeats: []\nmustReveal: [FACT-009]\nstatus: planned\n')
  const m = messages()
  expect(m).toMatch(/CHAR-TOM/)
  expect(m).toMatch(/LOC-BARN/)
  expect(m).toMatch(/FACT-009/)
})

test('supersedes must name an existing fact', () => {
  put('canon/facts.yaml', 'facts:\n  - { id: FACT-001, statement: s, status: established, source: bible, supersedes: FACT-077 }\n')
  expect(messages()).toMatch(/FACT-077/)
})

test('duplicate fact ids are reported', () => {
  put('canon/facts.yaml', 'facts:\n  - { id: FACT-001, statement: a, status: established, source: bible, supersedes: null }\n  - { id: FACT-001, statement: b, status: established, source: bible, supersedes: null }\n')
  expect(messages()).toMatch(/FACT-001 appears more than once/)
})

test('a CRLF file with a BOM is valid', () => {
  put('canon/timeline.yaml', '\uFEFFevents: []\r\n')
  expect(validateBook(dir)).toEqual([])
})

test('a junction inside the book is not followed', () => {
  const target = mkdtempSync(join(tmpdir(), 'nb-jn-'))
  writeFileSync(join(target, 'LOC-X.md'), 'no frontmatter')
  rmSync(join(dir, 'bible/places'), { recursive: true })
  symlinkSync(target, join(dir, 'bible/places'), 'junction')
  expect(() => validateBook(dir)).not.toThrow()
  expect(messages()).not.toMatch(/LOC-X/)
})

test('a directory where a scene plan should be is an error, not a throw', () => {
  mkdirSync(join(dir, 'outline/scenes/SC-002.yaml'))
  put('outline/outline.yaml', 'acts:\n  - id: ACT-1\n    title: B\n    chapters:\n      - { id: CH-01, title: One, scenes: [SC-001, SC-002] }\n')
  expect(messages()).toMatch(/SC-002 has no plan/)
})

test('an unreadable file is an error, not a throw', () => {
  mkdirSync(join(dir, 'bible/characters/CHAR-BAD.md'))
  expect(() => validateBook(dir)).not.toThrow()
})

test('a fact cannot supersede itself', () => {
  put('canon/facts.yaml', 'facts:\n  - { id: FACT-001, statement: s, status: established, source: bible, supersedes: FACT-001 }\n')
  expect(messages()).toMatch(/FACT-001 supersedes itself/)
})

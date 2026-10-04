import { test, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/hooks/validate'

const mkBook = () => {
  const root = join(mkdtempSync(join(tmpdir(), 'nb val ')), 'Book')
  mkdirSync(join(root, 'outline', 'scenes'), { recursive: true })
  mkdirSync(join(root, 'bible', 'characters'), { recursive: true })
  writeFileSync(join(root, 'book.yaml'), 'id: b\n')
  return root
}
const run = (cwd: string, rel: string, text: string) => {
  writeFileSync(join(cwd, rel), text)
  return main(JSON.stringify({ cwd, tool_name: 'Write', tool_input: { file_path: rel } }))
}

test('a valid scene plan passes', () => {
  const b = mkBook()
  const plan = 'id: SC-001\ntitle: T\ngoal: G\npov: CHAR-RUTH\nlocation: LOC-FIELD\nstoryTime: d\nbeats: [b]\narcBeats: []\nmustReveal: []\nstatus: planned\n'
  expect(run(b, 'outline/scenes/SC-001.yaml', plan)).toEqual({ code: 0, stderr: '' })
})

test('an invalid scene plan exits 2 and names the field', () => {
  const b = mkBook()
  const r = run(b, 'outline/scenes/SC-001.yaml', 'id: SC-001\ntitle: T\n')
  expect(r.code).toBe(2)
  expect(r.stderr).toMatch(/outline\/scenes\/SC-001\.yaml/)
  expect(r.stderr).toMatch(/goal/)
})

test('malformed YAML exits 2', () => {
  const b = mkBook()
  expect(run(b, 'outline/outline.yaml', 'acts: [oops').code).toBe(2)
})

test('character frontmatter is checked', () => {
  const b = mkBook()
  expect(run(b, 'bible/characters/CHAR-RUTH.md', '---\nid: CHAR-RUTH\nname: Ruth\n---\nbody').code).toBe(2)
  expect(run(b, 'bible/characters/CHAR-RUTH.md', 'no frontmatter at all').code).toBe(2)
})

test('files without a schema pass', () => {
  const b = mkBook()
  mkdirSync(join(b, 'drafts'))
  expect(run(b, 'drafts/SC-001.md', 'Prose.').code).toBe(0)
})

test('unreadable input passes (the tool already ran; guard is the gate)', () => {
  expect(main('nope').code).toBe(0)
})

test('unexpected error (directory instead of file) is handled gracefully', () => {
  const b = mkBook()
  // Create SC-001.yaml as a directory instead of file to trigger EISDIR
  mkdirSync(join(b, 'outline/scenes/SC-001.yaml'), { recursive: true })
  const r = main(JSON.stringify({ cwd: b, tool_name: 'Write', tool_input: { file_path: 'outline/scenes/SC-001.yaml' } }))
  // Should return gracefully without throwing
  expect(typeof r.code).toBe('number')
  expect(typeof r.stderr).toBe('string')
  // Error should be reported via code 2 (file could not be read)
  expect(r.code).toBe(2)
})

test('null input is handled gracefully', () => {
  // main('null') parses to null (not an object); should return code 0 without throwing
  const r = main('null')
  expect(r.code).toBe(0)
  expect(r.stderr).toBe('')
})

test('missing tool_input is handled gracefully', () => {
  // Payload with tool_name but no tool_input; should return code 0 without throwing
  const r = main(JSON.stringify({ cwd: 'x', tool_name: 'Write' }))
  expect(r.code).toBe(0)
  expect(r.stderr).toBe('')
})

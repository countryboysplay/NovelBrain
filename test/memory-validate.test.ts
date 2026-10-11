import { describe, expect, test } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serialize, type Meta } from '../src/main/memory/files'
import { ensureRepo, git } from '../src/main/memory/store'
import { STORY_ID, bibleNames, changedFiles, isLessonFile, problems, rollback } from '../src/main/memory/validate'

const meta = (name: string, type: Meta['type'] = 'craft'): Meta => ({ name, type, summary: 's', sources: [], verified: '2026-10-04', used: '2026-10-04', uses: 0, stale: false, pinned: false, status: 'live', by: '', rules: [], quiet: 0, hits: 0, live: '' })
function put(root: string, rel: string, text: string) {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), text)
}
const skill = (name: string, body: string) => `---\nname: ${name}\ndescription: Use when drafting a chase scene\n---\n${body}\n`
const notLocation = (f: string) => `${f}: not a memory file location`

describe('the distiller rejects story facts', () => {
  const names = ['Mara Quill', 'Hollow Pier']
  test('a canon or outline id anywhere is rejected', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mv-'))
    put(root, 'books/b/topics/x.md', serialize(meta('x', 'catch'), 'In SC-004 the gun was already gone.'))
    expect(problems(root, ['books/b/topics/x.md'], names, [])).toEqual([expect.stringMatching(/story fact.*SC-004/)])
  })
  test('every real id shape counts as a story fact; ordinary words do not', () => {
    for (const s of ['SC-004', 'CHAR-RUTH', 'LOC-NORTH-FIELD', 'FACT-012', 'TL-003', 'P-0001', 'ACT-2', 'CH-01', 'CHG-0007'])
      expect(STORY_ID.exec(`see ${s}.`)?.[0]).toBe(s)
    for (const s of ['risk-free', 'sc-004', 'CH-1', 'act-2']) expect(STORY_ID.test(s)).toBe(false)
  })
  test('a bible name in writer scope is rejected', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mv-'))
    put(root, 'topics/x.md', serialize(meta('x'), 'Mara Quill never lies to her sister.'))
    expect(problems(root, ['topics/x.md'], names, [])).toEqual([expect.stringMatching(/story fact.*Mara Quill/)])
  })
  test('a bible name in a skill proposal is rejected', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mv-'))
    put(root, 'inbox/chase/SKILL.md', skill('chase', 'Open at the Hollow Pier.'))
    expect(problems(root, ['inbox/chase/SKILL.md'], names, [])).toEqual([expect.stringMatching(/story fact.*Hollow Pier/)])
  })
  test('a first name alone is caught, but only as a whole, case-sensitive word', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mv-'))
    put(root, 'topics/x.md', serialize(meta('x'), 'Mara never lies to her sister.'))
    put(root, 'topics/y.md', serialize(meta('y'), 'Every pier is hollow; never a mara.'))
    put(root, 'inbox/eve/SKILL.md', skill('eve', 'Every chase needs a turn.'))
    put(root, 'inbox/eva/SKILL.md', skill('eva', 'Let Eve run.'))
    const files = ['topics/x.md', 'topics/y.md', 'inbox/eve/SKILL.md', 'inbox/eva/SKILL.md']
    expect(problems(root, files, [...names, 'Eve'], [])).toEqual([
      expect.stringMatching(/^topics\/x\.md: story fact \(Mara\)/),
      expect.stringMatching(/^inbox\/eva\/SKILL\.md: story fact \(Eve\)/)
    ])
  })
  test('a full name split by other whitespace is still caught', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mv-'))
    put(root, 'topics/x.md', serialize(meta('x'), 'down at the Hollow\n  Pier'))
    expect(problems(root, ['topics/x.md'], ['Hollow Pier'], [])).toEqual([expect.stringMatching(/story fact \(Hollow Pier\)/)])
  })
  test('a voice lesson in series scope may name a character', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mv-'))
    put(root, 'series/s/topics/x.md', serialize(meta('x', 'voice'), "Mara Quill's dialogue runs clipped."))
    expect(problems(root, ['series/s/topics/x.md'], names, [])).toEqual([])
  })
})

describe('locations and format', () => {
  test.each(['INDEX.md', 'skills/x/SKILL.md', 'books/b/book.json', 'archive/topics/x.md', 'notes.md', 'books/b/x.md'])('%s is not a memory location', rel => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mv-'))
    put(root, rel, serialize(meta('x'), 'ok'))
    expect(problems(root, [rel], [], [])).toEqual([notLocation(rel)])
  })
  test('secrets, bad frontmatter and long files are rejected; deletes are allowed', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mv-'))
    put(root, 'topics/a.md', serialize(meta('a'), 'key sk-ant-abcdefghijklmnopqrstuvwxyz'))
    put(root, 'topics/b.md', 'no frontmatter')
    put(root, 'topics/c.md', serialize(meta('c'), 'x\n'.repeat(201)))
    expect(problems(root, ['topics/a.md', 'topics/b.md', 'topics/c.md', 'topics/gone.md'], [], [])).toEqual([
      'topics/a.md: looks like it contains a secret',
      'topics/b.md: missing or invalid frontmatter',
      'topics/c.md: over 200 lines'
    ])
  })
  test('the 200-line cap counts body lines only, for lessons and skills', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mv-'))
    const body = (n: number) => Array.from({ length: n }, () => 'x').join('\n')
    put(root, 'topics/ok.md', serialize(meta('ok'), body(199)))
    put(root, 'topics/long.md', serialize(meta('long'), body(201)))
    put(root, 'inbox/ok/SKILL.md', skill('ok', body(199)))
    put(root, 'inbox/long/SKILL.md', skill('long', body(201)))
    expect(problems(root, ['topics/ok.md', 'topics/long.md', 'inbox/ok/SKILL.md', 'inbox/long/SKILL.md'], [], [])).toEqual([
      'topics/long.md: over 200 lines',
      'inbox/long/SKILL.md: over 200 lines'
    ])
  })
  test('deleting is allowed only in memory locations', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mv-'))
    const ok = ['topics/a.md', 'user.md', 'books/b/topics/a.md', 'series/s/topics/a.md', 'inbox/chase/SKILL.md']
    const bad = ['skills/x/SKILL.md', 'books/b/book.json', '.rejected', 'INDEX.md', '.gitignore']
    expect(problems(root, [...ok, ...bad], [], [])).toEqual(bad.map(notLocation))
  })
  test('inbox folder names must be slugs', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mv-'))
    const bad = ['inbox/-/SKILL.md', 'inbox/--x/SKILL.md', 'inbox/x-/SKILL.md', 'inbox/a--b/SKILL.md']
    for (const f of bad) put(root, f, skill(f.split('/')[1], 'body'))
    expect(problems(root, bad, [], [])).toEqual(bad.map(notLocation))
  })
  test('a skill proposal needs name and description, and a rejected name stays rejected', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mv-'))
    put(root, 'inbox/a/SKILL.md', '---\nname: a\n---\nbody\n')
    put(root, 'inbox/chase/SKILL.md', skill('chase', 'Cut between pursuer and pursued.'))
    expect(problems(root, ['inbox/a/SKILL.md', 'inbox/chase/SKILL.md'], [], ['chase'])).toEqual([
      'inbox/a/SKILL.md: a skill needs name (same as its folder) and description',
      'inbox/chase/SKILL.md: chase was rejected before'
    ])
  })
  test('a skill proposal may hold only name and description', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mv-'))
    put(root, 'inbox/a/SKILL.md', '---\nname: a\ndescription: d\nallowed-tools: Bash\n---\nbody\n')
    put(root, 'inbox/b/SKILL.md', '---\nname: b\ndescription: d\nmodel: opus\n---\nbody\n')
    put(root, 'inbox/c/SKILL.md', '---\nname: c\ndescription: d\n"allowed-tools": Bash\n---\nbody\n')
    put(root, 'inbox/d/SKILL.md', "---\nname: d\ndescription: d\n'model': opus\n---\nbody\n")
    put(root, 'inbox/e/SKILL.md', '---\nname: e\ndescription: d\nbad: [unclosed\n---\nbody\n')
    const files = ['a', 'b', 'c', 'd', 'e'].map(n => `inbox/${n}/SKILL.md`)
    expect(problems(root, files, [], [])).toEqual([
      ...files.slice(0, 4).map(f => `${f}: a skill may hold only name and description in its frontmatter`),
      'inbox/e/SKILL.md: a skill needs name (same as its folder) and description'
    ])
  })
  test('bible names come from characters and places', () => {
    const book = mkdtempSync(join(tmpdir(), 'nb-mv-book-'))
    put(book, 'bible/characters/CHAR-MARA.md', '---\nid: CHAR-MARA\nname: Mara Quill\nrole: lead\narcBeats: [a]\n---\nA diver.\n')
    put(book, 'bible/places/LOC-PIER.md', '---\nid: LOC-PIER\nname: Hollow Pier\n---\nRotten boards.\n')
    put(book, 'bible/places/LOC-X.md', '---\nid: LOC-X\nname: Ox\n---\n')
    expect(bibleNames(book).sort()).toEqual(['Hollow Pier', 'Mara Quill'])
  })
  test('a bad bible file costs only its own name', () => {
    const book = mkdtempSync(join(tmpdir(), 'nb-mv-book-'))
    put(book, 'bible/characters/CHAR-MARA.md', '---\nid: CHAR-MARA\nname: Mara Quill\n---\n')
    put(book, 'bible/characters/CHAR-BAD.md', '---\nname: [unclosed\n---\n')
    mkdirSync(join(book, 'bible/places/LOC-DIR.md'), { recursive: true })
    put(book, 'bible/places/LOC-PIER.md', '---\nid: LOC-PIER\nname: Hollow Pier\n---\n')
    expect(bibleNames(book).sort()).toEqual(['Hollow Pier', 'Mara Quill'])
  })
})

test('a lesson path from outside is a memory location with no traversal or Windows tricks', () => {
  for (const v of ['user.md', 'topics/filter-words.md', 'books/first/topics/a.md', 'series/s/topics/b.md']) expect(isLessonFile(v)).toBe(true)
  for (const v of ['topics/..\\..\\x.md', 'books/../topics/x.md', 'books/..', 'inbox/x/SKILL.md', 'C:/x.md', 'topics/a:b.md', 'archive/topics/a.md', 'topics/a/b.md', '', 1, null])
    expect(isLessonFile(v)).toBe(false)
})

describe('changed files and rollback', () => {
  test('git-ignored files and nested repos are checked and rolled back; only the root state files are exempt', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mv-git-'))
    await ensureRepo(root)
    put(root, 'books/b/topics/.gitignore', '*\n')
    put(root, 'books/b/topics/leak.md', serialize(meta('leak'), 'In SC-004 the gun was gone.'))
    put(root, 'inbox/x/SKILL.md', skill('x', 'body'))
    await git(join(root, 'inbox/x'), 'init', '-q')
    put(root, '.state.json', '{}')
    put(root, '.queue', '')
    const files = await changedFiles(root)
    expect(files).not.toContain('.state.json')
    expect(files).not.toContain('.queue')
    const found = problems(root, files, [], [])
    expect(found).toContain(notLocation('books/b/topics/.gitignore'))
    expect(found).toContainEqual(expect.stringMatching(/^books\/b\/topics\/leak\.md: story fact \(SC-004\)/))
    expect(found).toContainEqual(expect.stringMatching(/^inbox\/x\/.*not a memory file location/))
    await rollback(root)
    for (const f of ['books/b/topics/.gitignore', 'books/b/topics/leak.md', 'inbox/x']) expect(existsSync(join(root, f))).toBe(false)
    for (const f of ['.state.json', '.queue', '.gitignore']) expect(existsSync(join(root, f))).toBe(true)
    expect(await changedFiles(root)).toEqual([])
  })
})

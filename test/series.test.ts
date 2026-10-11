import { expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seriesBooks } from '../src/main/book/series'

const parent = () => mkdtempSync(join(tmpdir(), 'nb series '))
function book(root: string, folder: string, y: Record<string, string>, chars: string[] = []) {
  const dir = join(root, folder)
  mkdirSync(join(dir, 'bible', 'characters'), { recursive: true })
  writeFileSync(join(dir, 'book.yaml'), `id: ${y.id}\ntitle: ${y.title}\nstatus: ${y.status ?? 'active'}\naudience: adult\ngenres: [literary]\nseries: ${y.series ?? 'null'}\npredecessor: ${y.predecessor ?? 'null'}\nwordTarget: 60000\nkitVersion: "4"\n`)
  chars.forEach((c, i) => writeFileSync(join(dir, 'bible', 'characters', `CHAR-C${i}.md`), `---\nid: CHAR-C${i}\nname: ${c}\nrole: lead\narcBeats: [a]\n---\n`))
  return dir
}

test('lists the books that share the series key, first to last, and marks the open one', () => {
  const root = parent()
  const third = book(root, 'third', { id: 'third', title: 'A Third', series: 'first', predecessor: 'second' })
  book(root, 'first', { id: 'first', title: 'Z First', status: 'archived' }, ['Ruth Prewitt'])
  book(root, 'second', { id: 'second', title: 'M Second', series: 'first', predecessor: 'first', status: 'archived' }, ['Ruth Prewitt', 'Tom Prewitt'])
  book(root, 'other', { id: 'other', title: 'Other' })
  mkdirSync(join(root, 'not-a-book'))
  const list = seriesBooks(third)
  expect(list.map(b => b.id)).toEqual(['first', 'second', 'third'])
  expect(list.map(b => b.current)).toEqual([false, false, true])
  expect(list[1]).toMatchObject({ title: 'M Second', status: 'archived', predecessor: 'first', characters: ['Ruth Prewitt', 'Tom Prewitt'] })
})

test('a standalone book is a series of one; an unreadable book has none', () => {
  const root = parent()
  const solo = book(root, 'solo', { id: 'solo', title: 'Solo' })
  expect(seriesBooks(solo).map(b => b.id)).toEqual(['solo'])
  const broken = join(root, 'broken'); mkdirSync(broken); writeFileSync(join(broken, 'book.yaml'), ': [')
  expect(seriesBooks(broken)).toEqual([])
})

test('a predecessor loop does not hang', () => {
  const root = parent()
  const a = book(root, 'a', { id: 'a', title: 'A', series: 'a', predecessor: 'b' })
  book(root, 'b', { id: 'b', title: 'B', series: 'a', predecessor: 'a' })
  expect(seriesBooks(a).map(b => b.id).sort()).toEqual(['a', 'b'])
})

test('linked and oversized book.yaml and character files are skipped', () => {
  const root = parent()
  const me = book(root, 'me', { id: 'me', title: 'Me' }, ['Ruth'])
  writeFileSync(join(me, 'bible', 'characters', 'CHAR-BIG.md'), `---\nid: CHAR-BIG\nname: Big\nrole: lead\narcBeats: [a]\n---\n${'x'.repeat(2_000_001)}`)
  const outside = mkdtempSync(join(tmpdir(), 'nb outside '))
  writeFileSync(join(outside, 'CHAR-LINK.md'), '---\nid: CHAR-LINK\nname: Linked\nrole: lead\narcBeats: [a]\n---\n')
  const linked = book(root, 'linked', { id: 'linked', title: 'Linked', series: 'me' })
  rmSync(join(linked, 'bible', 'characters'), { recursive: true })
  symlinkSync(outside, join(linked, 'bible', 'characters'), 'junction') // junction: file links need admin on Windows
  const big = book(root, 'big', { id: 'big', title: 'Big', series: 'me' })
  writeFileSync(join(big, 'book.yaml'), readFileSync(join(me, 'book.yaml'), 'utf8').replace('id: me', 'id: big') + '# ' + 'x'.repeat(2_000_001))
  expect(seriesBooks(me).map(b => [b.id, b.characters])).toEqual([['linked', []], ['me', ['Ruth']]])
})

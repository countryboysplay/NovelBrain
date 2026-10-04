import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAllowedBookPath, isNewBookOpts } from '../src/main/book/ipc'

describe('isAllowedBookPath', () => {
  const recent = [resolve('/Books/One')]
  it('accepts recent absolute paths case-insensitively', () => {
    expect(isAllowedBookPath(resolve('/books/one').toLowerCase(), recent)).toBe(true)
  })
  it('refuses unknown, relative and non-string', () => {
    expect(isAllowedBookPath(resolve('/Other'), recent)).toBe(false)
    expect(isAllowedBookPath('One', ['One'])).toBe(false)
    expect(isAllowedBookPath(5, recent)).toBe(false)
  })
})

describe('isNewBookOpts', () => {
  const ok = { title: 'T', audience: 'adult', genres: ['literary'], wordTarget: 1000 }
  it('accepts a well-formed object', () => expect(isNewBookOpts(ok)).toBe(true))
  it('rejects bad shapes', () => {
    for (const bad of [null, 'x', {}, { ...ok, title: ' ' }, { ...ok, title: 3 }, { ...ok, genres: 'a' }, { ...ok, wordTarget: '1' }])
      expect(isNewBookOpts(bad)).toBe(false)
  })
})

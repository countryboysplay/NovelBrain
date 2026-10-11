import { test, expect } from 'vitest'
import { wordsChanged, rerunOf, TOUCHUP_MAX_WORDS } from '../src/accept/touchup'

test('wordsChanged counts words added plus words removed', () => {
  expect(wordsChanged('', '')).toBe(0)
  expect(wordsChanged('a b c', 'a b c')).toBe(0)
  expect(wordsChanged('a b c', 'a x c')).toBe(2)
  expect(wordsChanged('a b c', 'a b c d e')).toBe(2)
  expect(wordsChanged('Ruth walked the row.', 'Ruth  walked\nthe row.')).toBe(0) // whitespace only
})
test('wordsChanged: a large rewrite is refused fast', () => {
  const a = Array.from({ length: 6000 }, (_, i) => `a${i}`).join(' ')
  const b = Array.from({ length: 6000 }, (_, i) => `b${i}`).join(' ')
  const t = Date.now()
  expect(wordsChanged(a, b)).toBeGreaterThan(TOUCHUP_MAX_WORDS)
  expect(Date.now() - t).toBeLessThan(500)
})
test('rerunOf keeps review order and always adds the canon auditor and the gate', () => {
  expect(rerunOf(['reader', 'line'])).toEqual(['line', 'reader', 'canon-auditor', 'gate'])
  expect(rerunOf([])).toEqual(['canon-auditor', 'gate'])
})
test('wordsChanged is exact for two one-word edits far apart', () => {
  const a = Array.from({ length: 3000 }, (_, i) => `w${i}`)
  const b = [...a]; b[10] = 'x'; b[2500] = 'y'
  expect(wordsChanged(a.join(' '), b.join(' '))).toBe(4)
})
test('wordsChanged: scattered edits just over the cap are over the cap', () => {
  const a = Array.from({ length: 3000 }, (_, i) => `w${i}`)
  const b = [...a]; for (let i = 0; i < 101; i++) b[i * 29] = `x${i}` // 101 replacements = 202 words
  expect(wordsChanged(a.join(' '), b.join(' '))).toBeGreaterThan(TOUCHUP_MAX_WORDS)
  const c = [...a]; for (let i = 0; i < 100; i++) c[i * 29] = `x${i}`
  expect(wordsChanged(a.join(' '), c.join(' '))).toBe(200)
})
test('wordsChanged matches a plain LCS on small random texts', () => {
  const lcs = (x: string[], y: string[]) => {
    const t = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0))
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++)
      t[i][j] = x[i - 1] === y[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1])
    return x.length + y.length - 2 * t[x.length][y.length]
  }
  const words = () => Array.from({ length: Math.floor(Math.random() * 40) }, () => 'abcd'[Math.floor(Math.random() * 4)])
  for (let i = 0; i < 500; i++) { const x = words(), y = words(); expect(wordsChanged(x.join(' '), y.join(' '))).toBe(lcs(x, y)) }
})

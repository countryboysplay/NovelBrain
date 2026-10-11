// test/kdp.test.ts
import { test, expect } from 'vitest'
import { gutterFloor, isIsbn13, margins, spineWidth, PAGE_RANGE, TRIMS } from '../src/main/export/kdp'

test('the gutter floor follows KDP\'s table at each edge', () => {
  expect([24, 150, 151, 300, 301, 500, 501, 700, 701, 828].map(gutterFloor))
    .toEqual([0.375, 0.375, 0.5, 0.5, 0.625, 0.625, 0.75, 0.75, 0.875, 0.875])
})

test('margins scale BD-M\'s 6x9 values to the trim and never fall under the floor', () => {
  expect(margins('6x9', 200)).toEqual({ gutter: 0.875, outside: 0.75, top: 0.5, bottom: 0.75 })
  // 5x8: scaled gutter 0.729 wins until KDP's floor passes it at 501 pages
  expect(margins('5x8', 500).gutter).toBe(0.729)
  expect(margins('5x8', 501).gutter).toBe(0.75)
  expect(margins('5x8', 701).gutter).toBe(0.875)
  expect(margins('5.5x8.5', 100)).toEqual({ gutter: 0.802, outside: 0.688, top: 0.472, bottom: 0.708 })
  for (const t of Object.keys(TRIMS) as (keyof typeof TRIMS)[]) {
    const m = margins(t, 24)
    expect(Math.min(m.outside, m.top, m.bottom)).toBeGreaterThan(0.25)
  }
})

test('spine width uses KDP\'s per-page factor for the paper', () => {
  expect(spineWidth(200, 'cream')).toBe(0.5)
  expect(spineWidth(200, 'white')).toBe(0.4504)
  expect(PAGE_RANGE).toEqual({ cream: [24, 776], white: [24, 828] })
})

test('ISBN-13 needs a 978 or 979 prefix and a correct check digit; hyphens and spaces are allowed', () => {
  expect(isIsbn13('978-0-306-40615-7')).toBe(true)
  expect(isIsbn13('979 8 88888 888 0')).toBe(false)
  expect(isIsbn13('9780306406157')).toBe(true)
  expect(isIsbn13('9780306406158')).toBe(false)
  expect(isIsbn13('0-306-40615-2')).toBe(false) // ISBN-10
  expect(isIsbn13('')).toBe(false)
})

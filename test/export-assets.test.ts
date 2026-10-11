import { test, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { EXPORT_FONTS } from '../src/shared/export'

test('every bundled export asset is present, with its licence, and shipped', () => {
  const files = ['paged.js', 'pagedjs-LICENSE.md', ...EXPORT_FONTS.flatMap(f => [`${f}-LICENSE.txt`, ...['400-normal', '400-italic', '700-normal'].map(v => `${f}-latin-${v}.woff2`)])]
  for (const f of files) expect(existsSync(`resources/export/${f}`), f).toBe(true)
  expect(readFileSync('electron-builder.yml', 'utf8')).toMatch(/from: resources\/export\s+to: export/)
})

test('the notices name every bundled third-party work, and the installer ships them', () => {
  const n = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')
  for (const w of ['Paged.js', 'MIT', 'EB Garamond', 'Crimson Pro', 'Libre Baskerville', 'SIL Open Font License', 'ClaudeCodeMax', 'Imagineer']) expect(n, w).toContain(w)
  expect(readFileSync('electron-builder.yml', 'utf8')).toContain('THIRD_PARTY_NOTICES.md')
})

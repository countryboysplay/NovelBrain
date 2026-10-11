import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/renderer/src/styles/tokens.css', 'utf8')
const vars = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(m => [m[1], m[2]]))
const night = vars(css.match(/^\.studio\s*\{([^}]*)\}/m)![1])
const day = { ...night, ...vars(css.match(/prefers-color-scheme:\s*light\)\s*\{\s*\.studio\s*\{([^}]*)\}/)![1]) }
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const TEXT = 4.5, UI = 3
const PAIRS: [string, string, number][] = [
  ['text', 'wall', TEXT], ['text', 'tray', TEXT], ['text', 'chip', TEXT], ['text', 'strip', TEXT], ['muted', 'wall', TEXT], ['muted', 'tray', TEXT], ['muted', 'chip', TEXT],
  ['ink', 'gesso', TEXT], ['ink-2', 'gesso', TEXT], ['ink', 'yellow', TEXT],
  ...(['phthalo', 'ultra', 'magenta', 'sienna', 'red', 'yellow', 'grey'] as const).map(p => [`ink-${p}`, 'gesso', TEXT] as [string, string, number]),
  ['ink-phthalo', 'pass-bg', TEXT], ['ink-yellow', 'flag-bg', TEXT], ['ink-red', 'fail-bg', TEXT],
  ['act-1', 'wall', TEXT], ['act-2', 'wall', TEXT], ['act-3', 'wall', TEXT], ['term-fg', 'term-bg', TEXT],
  ['focus', 'wall', UI], ['focus', 'tray', UI], ['focus-paper', 'gesso', UI], ['line', 'wall', UI], ['red', 'gesso', UI]
]

test.each([['night', night], ['day', day]] as const)('%s theme meets WCAG 2.2 AA contrast', (_name, t) => {
  for (const [fg, bg, min] of PAIRS) {
    expect(t[fg], `--${fg}`).toBeDefined(); expect(t[bg], `--${bg}`).toBeDefined()
    expect(ratio(t[fg], t[bg]), `--${fg} on --${bg}`).toBeGreaterThanOrEqual(min)
  }
})

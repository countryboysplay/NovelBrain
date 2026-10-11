// Renders the README art in docs/assets/readme/ from its HTML sources with headless Chrome.
// Needs Chrome and a network connection (the sources load Google Fonts). Usage: node scripts/render-readme-art.mjs
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const dir = resolve('docs/assets/readme')
const P = { yellow: 'ffc21a', red: 'e0342a', ultramarine: '3a5cff', green: '13a37f', magenta: 'd81b72' }

function shot(src, query, out, w, h, scale = 1) {
  const url = `${pathToFileURL(resolve(dir, src)).href}?${new URLSearchParams(query)}`
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
    `--force-device-scale-factor=${scale}`, '--virtual-time-budget=8000', `--window-size=${w},${h}`,
    `--screenshot=${resolve(dir, out)}`, url], { stdio: 'ignore' })
  console.log(out)
}

shot('hero.html', {}, 'hero.png', 1600, 480)

const headers = [
  ['what-it-is', 'What it is', P.yellow],
  ['how-it-works', 'How it works', P.red],
  ['writing-loop', 'The writing loop', P.magenta],
  ['memory', 'Memory', P.yellow],
  ['book-folder', 'The book folder', P.ultramarine],
  ['research', 'Research skills', P.green],
  ['today', 'The window today', P.magenta],
  ['run', 'Run from source', P.yellow],
  ['development', 'Development', P.red],
  ['roadmap', 'Roadmap', P.ultramarine],
  ['credits', 'Credits', P.green]
]
for (const [name, text, pigment] of headers)
  for (const theme of ['light', 'dark']) shot('header.html', { text, pigment, theme }, `h-${name}-${theme}.png`, 420, 56, 2)

const features = [['guard', P.red], ['validate', P.ultramarine], ['git', P.green], ['skills', P.yellow], ['terminal', P.magenta], ['setup', P.ultramarine]]
for (const [icon, pigment] of features) shot('feature.html', { icon, pigment }, `f-${icon}.png`, 72, 72, 2)

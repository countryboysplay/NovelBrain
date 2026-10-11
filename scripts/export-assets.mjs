// Copies the print layout engine and the book fonts into resources/export/ (committed, shipped by electron-builder).
import { copyFileSync, mkdirSync } from 'node:fs'
const out = 'resources/export'
mkdirSync(out, { recursive: true })
copyFileSync('node_modules/pagedjs/dist/paged.js', `${out}/paged.js`)
copyFileSync('node_modules/pagedjs/LICENSE.md', `${out}/pagedjs-LICENSE.md`)
for (const font of ['eb-garamond', 'crimson-pro', 'libre-baskerville']) {
  for (const v of ['400-normal', '400-italic', '700-normal']) copyFileSync(`node_modules/@fontsource/${font}/files/${font}-latin-${v}.woff2`, `${out}/${font}-latin-${v}.woff2`)
  copyFileSync(`node_modules/@fontsource/${font}/LICENSE`, `${out}/${font}-LICENSE.txt`)
}
console.log('export assets copied')

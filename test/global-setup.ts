import { execFileSync } from 'node:child_process'

// Build hook and accept bundles once, before any test file copies them.
export default function setup(): void {
  execFileSync('node', ['scripts/build-hooks.mjs'], { stdio: 'ignore' })
}

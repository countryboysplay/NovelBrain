import { defineConfig } from 'vitest/config'

// memory tests spawn git and node; the 5s default flakes on Windows. Hooks too: a beforeEach that creates a book
// (kit install and commits) passed 10s on a loaded CI runner, and one newBook there stalled past 30s.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 60000, hookTimeout: 60000, globalSetup: ['test/global-setup.ts'] } })

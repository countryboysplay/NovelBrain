import { expect, test } from 'vitest'
import { claudeEnv } from '../src/main/claudeEnv'

test('stops cmd.exe searching the book folder for claude', () => {
  expect(claudeEnv({ PATH: 'x' }, {}).NoDefaultCurrentDirectoryInExePath).toBe('1')
  expect(claudeEnv({ NoDefaultCurrentDirectoryInExePath: '0' }, {}).NoDefaultCurrentDirectoryInExePath).toBe('1')
})

test('routes through headroom only when asked', () => {
  expect(claudeEnv({ PATH: 'x' }, {}).ANTHROPIC_BASE_URL).toBeUndefined()
  expect(claudeEnv({ PATH: 'x' }, { headroomUrl: 'http://127.0.0.1:8787' })).toMatchObject({ PATH: 'x', ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787' })
})

import { test, expect } from 'vitest'
import { isSkillName } from '../src/main/memory/ipc'

test('validates learned-skill names', () => {
  for (const v of ['chase', 'filter-words', 'a1']) expect(isSkillName(v)).toBe(true)
  for (const v of ['../x', 'Chase', '', 1, null, undefined, 'a--b', '-a', 'a-', 'a/b', 'chase\n']) expect(isSkillName(v)).toBe(false)
})

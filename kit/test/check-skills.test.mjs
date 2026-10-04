import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkSkill, kindFor } from './check-skills.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fx = (name) => readFileSync(join(here, 'fixtures', name, 'SKILL.md'), 'utf8')

test('good fixture passes', () => {
  assert.deepEqual(checkSkill(fx('good'), 'audience'), [])
})
test('rule without a source fails', () => {
  assert.match(checkSkill(fx('bad-nosource'), 'audience').join('\n'), /TS-LEN-01.*no source/)
})
test('missing required heading fails', () => {
  assert.match(checkSkill(fx('bad-heading'), 'audience').join('\n'), /missing heading: Content limits/)
})
test('engagement rules need a Check line', () => {
  assert.match(checkSkill(fx('bad-check'), 'audience').join('\n'), /TS-ENG-01.*Check/)
})
test('undefined source tag fails', () => {
  assert.match(checkSkill(fx('bad-undefined'), 'audience').join('\n'), /S2.*not defined/)
})
test('short description fails', () => {
  assert.match(checkSkill(fx('bad-desc'), 'audience').join('\n'), /description/)
})
test('placeholder text fails', () => {
  assert.match(checkSkill(fx('bad-todo'), 'audience').join('\n'), /placeholder/)
})
test('malformed rule id fails', () => {
  assert.match(checkSkill(fx('bad-id'), 'audience').join('\n'), /malformed rule id/)
})
test('kindFor maps directory names', () => {
  assert.equal(kindFor('audience-adult'), 'audience')
  assert.equal(kindFor('genre-romance'), 'genre')
  assert.equal(kindFor('reader-engagement'), 'engagement')
  assert.equal(kindFor('writing-sucks'), 'engagement')
})
test('kindFor returns null for unknown folders', () => {
  assert.equal(kindFor('book-rules'), null)
  assert.equal(kindFor('style'), null)
  // The operational skills are linted by check-kit, not here.
  for (const d of ['showrunner', 'scene-context', 'proposal-format']) assert.equal(kindFor(d), null)
})
test('empty required section fails', () => {
  assert.match(checkSkill(fx('bad-empty-section'), 'audience').join('\n'), /no rules under heading: Content limits/)
})
test('name must match folder', () => {
  assert.match(checkSkill(fx('good'), 'audience', 'audience-other').join('\n'), /name does not match folder/)
  assert.deepEqual(checkSkill(fx('good'), 'audience', 'audience-test'), [])
})
test('kindFor maps craft directory names', () => {
  assert.equal(kindFor('craft-scene'), 'craft')
  assert.equal(kindFor('craft-character'), 'craft')
  assert.equal(kindFor('craft-structure'), 'craft')
})
test('good craft fixture passes', () => {
  assert.deepEqual(checkSkill(fx('good-craft'), 'craft', 'craft-test'), [])
})
test('craft rule with missing Check line fails', () => {
  const text = readFileSync(join(here, 'fixtures', 'good-craft', 'SKILL.md'), 'utf8').replace(/\r?\n  Check: .*/, '')
  assert.match(checkSkill(text, 'craft').join('\n'), /CS-CHK-01.*Check/)
})
test('craft skill with missing heading fails', () => {
  const text = readFileSync(join(here, 'fixtures', 'good-craft', 'SKILL.md'), 'utf8').replace(/## Pitfalls[\s\S]*?## Checks/, '## Checks')
  assert.match(checkSkill(text, 'craft').join('\n'), /missing heading: Pitfalls/)
})

// Every real skill in the kit must pass. Folders with no kind (non-research skills) and non-directories are skipped.
const skills = join(here, '..', 'fiction', 'skills')
for (const dir of existsSync(skills) ? readdirSync(skills) : []) {
  const kind = kindFor(dir)
  const file = join(skills, dir, 'SKILL.md')
  if (kind === null || !statSync(join(skills, dir)).isDirectory() || !existsSync(file)) continue
  test(`kit skill ${dir} is valid`, () => {
    assert.deepEqual(checkSkill(readFileSync(file, 'utf8'), kind, dir), [])
  })
}

const HEADINGS = {
  audience: ['Length', 'Language', 'POV, tense and protagonist', 'Content limits', 'Pacing and themes',
    'Reader psychology', 'Put-down risks', 'Re-engagement', 'Sources'],
  genre: ['Reader promise', 'Structure', 'Conventions', 'Pitfalls', 'Reader psychology', 'Sources'],
  engagement: ['Mechanisms', 'Reader psychology', 'Sources'],
  craft: ['Principles', 'Techniques', 'Pitfalls', 'Checks', 'Sources'],
}
const RULE = /^- ([A-Z]{1,6}(?:-[A-Z]{2,5})-\d{2}): (.*)$/
const LOOKS_LIKE_RULE = /^- [A-Za-z]{1,6}-[A-Za-z]{2,5}-\w+:/
const SOURCE_DEF = /^- \[(S\d+)\] .+ https?:\/\/\S+ \(accessed \d{4}-\d{2}-\d{2}\)$/
const PLACEHOLDER = /\b(TODO|TBD|FIXME|lorem ipsum)\b/i

export function kindFor(dir) {
  if (dir.startsWith('audience-')) return 'audience'
  if (dir.startsWith('genre-')) return 'genre'
  if (dir.startsWith('craft-')) return 'craft'
  if (dir === 'reader-engagement') return 'engagement'
  if (dir === 'writing-sucks') return 'engagement'
  return null
}

export function checkSkill(text, kind, dirName) {
  const errors = []
  text = text.replace(/\r\n/g, '\n')
  const lines = text.split('\n')

  const fm = text.match(/^---\n([\s\S]*?)\n---/)
  const desc = fm?.[1].match(/^description: (.+)$/m)?.[1] ?? ''
  if (!fm || !/^name: \S+$/m.test(fm[1])) errors.push('frontmatter: missing name')
  if (dirName && fm?.[1].match(/^name: (\S+)$/m)?.[1] !== dirName) errors.push('name does not match folder')
  if (desc.length < 60) errors.push('frontmatter: description shorter than 60 characters')

  const headings = lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim())
  for (const h of HEADINGS[kind]) if (!headings.includes(h)) errors.push(`missing heading: ${h}`)

  for (const h of HEADINGS[kind]) {
    if (h === 'Sources') continue
    const start = lines.indexOf(`## ${h}`)
    if (start < 0) continue
    const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
    const body = lines.slice(start + 1, end < 0 ? undefined : end)
    if (!body.some((l) => RULE.test(l))) errors.push(`no rules under heading: ${h}`)
  }

  const defined = new Set()
  for (const l of lines) {
    const m = l.match(SOURCE_DEF)
    if (m) defined.add(m[1])
    else if (/^- \[S\d+\]/.test(l)) errors.push(`source line malformed (needs URL and accessed date): ${l}`)
  }

  const ids = new Set()
  lines.forEach((l, i) => {
    if (PLACEHOLDER.test(l)) errors.push(`placeholder text on line ${i + 1}`)
    if (LOOKS_LIKE_RULE.test(l) && !RULE.test(l)) errors.push(`malformed rule id on line ${i + 1}: ${l}`)
    const m = l.match(RULE)
    if (!m) return
    const [, id, body] = m
    if (ids.has(id)) errors.push(`${id}: duplicate rule id`)
    ids.add(id)
    const tags = [...body.matchAll(/\[(S\d+)\]/g)].map((t) => t[1])
    if (tags.length === 0) errors.push(`${id}: no source tag`)
    for (const t of tags) if (!defined.has(t)) errors.push(`${id}: source ${t} not defined`)
    if ((id.includes('-ENG-') || id.includes('-CHK-')) && !/^\s+Check: \S/.test(lines[i + 1] ?? '')) errors.push(`${id}: rule needs a Check line`)
  })
  if (ids.size === 0) errors.push('no rules found')
  return errors
}

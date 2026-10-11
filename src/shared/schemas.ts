import { z } from 'zod'
import { parse } from 'yaml'

export const ID = {
  scene: /^SC-\d{3,}$/,
  char: /^CHAR-[A-Z0-9]+(-[A-Z0-9]+)*$/,
  loc: /^LOC-[A-Z0-9]+(-[A-Z0-9]+)*$/,
  fact: /^FACT-\d{3,}$/,
  event: /^TL-\d{3,}$/,
  proposal: /^P-\d{4,}$/,
  act: /^ACT-\d+$/,
  chapter: /^CH-\d{2,}$/,
  change: /^CHG-\d{4,}$/
}

export const AUDIENCES = ['early-chapter', 'middle-grade', 'young-adult', 'new-adult', 'adult'] as const
export const GENRES = ['literary', 'mystery', 'thriller', 'romance', 'fantasy', 'science-fiction', 'horror', 'historical'] as const
export const REVIEWERS = ['continuity', 'character', 'developmental', 'line', 'audience', 'reader', 'canon-auditor', 'gate', 'arc', 'flow'] as const
export const REQUIRED_REVIEWERS = ['continuity', 'character', 'developmental', 'line', 'audience', 'reader', 'canon-auditor', 'gate'] as const

/** Lowercase words joined by hyphens: book, series and skill ids, safe as a path segment. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const id = (re: RegExp, what: string) => z.string().regex(re, `not a valid ${what} id`)
const text = z.string().min(1)

export const Book = z.object({
  id: z.string().regex(SLUG, 'book id must be lowercase words joined by hyphens'),
  title: text,
  status: z.enum(['active', 'archived']),
  audience: z.enum(AUDIENCES),
  genres: z.array(z.enum(GENRES)).min(1),
  series: z.string().regex(SLUG, 'series must be lowercase words joined by hyphens').nullable(),
  predecessor: z.string().nullable(),
  wordTarget: z.number().int().positive(),
  kitVersion: text,
  export: z.record(z.string(), z.unknown()).optional()
})

export const Character = z.object({
  id: id(ID.char, 'character'),
  name: text,
  role: text,
  voice: z.string().optional(),
  arcBeats: z.array(text).min(1)
})

export const Place = z.object({ id: id(ID.loc, 'place'), name: text })

export const Outline = z.object({
  acts: z.array(z.object({
    id: id(ID.act, 'act'),
    title: text,
    chapters: z.array(z.object({ id: id(ID.chapter, 'chapter'), title: text, scenes: z.array(id(ID.scene, 'scene')) }))
  }))
})

export const SCENE_STATUS = ['planned', 'drafting', 'review', 'accepted', 'needs-you'] as const

export const ScenePlan = z.object({
  id: id(ID.scene, 'scene'),
  title: text,
  goal: text,
  pov: id(ID.char, 'character'),
  location: id(ID.loc, 'place'),
  storyTime: text,
  beats: z.array(text).min(1),
  arcBeats: z.array(z.object({ character: id(ID.char, 'character'), beat: text })),
  mustReveal: z.array(id(ID.fact, 'fact')),
  status: z.enum(SCENE_STATUS)
})

const source = z.union([id(ID.scene, 'scene'), z.literal('bible'), z.literal('before-story'), z.literal('author')])

export const Facts = z.object({
  facts: z.array(z.object({
    id: id(ID.fact, 'fact'),
    statement: text,
    status: z.enum(['established', 'superseded']),
    source,
    supersedes: id(ID.fact, 'fact').nullable()
  }))
})

export const Timeline = z.object({
  events: z.array(z.object({
    id: id(ID.event, 'timeline event'),
    storyTime: text,
    place: id(ID.loc, 'place'),
    who: z.array(id(ID.char, 'character')),
    what: text,
    source
  }))
})

export const Knowledge = z.object({
  entries: z.array(z.object({
    character: id(ID.char, 'character'),
    fact: id(ID.fact, 'fact'),
    learnedIn: source,
    how: text
  }))
})

const ProposalChange = z.object({
  op: z.enum(['add', 'update', 'retcon']),
  target: z.enum(['facts', 'timeline', 'knowledge']),
  data: z.record(z.string(), z.unknown())
})

export const Proposal = z.object({
  id: id(ID.proposal, 'proposal'),
  scene: id(ID.scene, 'scene'),
  changes: z.array(ProposalChange).min(1)
})

// House setting: one scene's manuscript text is at most 1 MB.
export const MAX_SCENE_BYTES = 1_000_000
const prose = z.string()
  .refine(s => !s.includes('\0'), 'contains a NUL character')
  .refine(s => new TextEncoder().encode(s).length <= MAX_SCENE_BYTES, 'is larger than 1 MB')

// An author's change: written by Claude in notes/changes/, applied only by the app.
export const ChangeRequest = z.object({
  id: id(ID.change, 'change'),
  summary: text,
  canon: z.array(ProposalChange).optional(),
  manuscript: z.array(z.object({ scene: id(ID.scene, 'scene'), text: prose })).optional(),
  outline: z.array(z.object({ scene: id(ID.scene, 'scene'), status: z.literal('planned') })).optional()
}).refine(c => !!(c.canon?.length || c.manuscript?.length || c.outline?.length), 'needs at least one canon, manuscript or outline change')

export const Series = z.object({
  id: z.string().regex(SLUG),
  title: text,
  books: z.array(z.string().regex(SLUG))
})

export const Review = z.object({
  scene: z.union([id(ID.scene, 'scene'), id(ID.chapter, 'chapter'), id(ID.act, 'act'), z.literal('BOOK')]),
  reviewer: z.enum(REVIEWERS),
  round: z.number().int().min(1),
  verdict: z.enum(['PASS', 'FLAG', 'FAIL']),
  model: z.string().optional(),
  revise: z.array(id(ID.scene, 'scene')).optional()
})

export const Park = z.object({ scene: id(ID.scene, 'scene'), reason: text })

export const OpenQuestions = z.object({
  questions: z.array(z.object({
    id: z.string().regex(/^Q-\d{3,}$/),
    raised: id(ID.scene, 'scene'),
    question: text,
    answerBy: id(ID.chapter, 'chapter').nullable(),
    answered: id(ID.scene, 'scene').nullable()
  }))
})

export const STOP_AT = ['scene', 'chapter', 'act', 'book'] as const

export const RunState = z.object({
  status: z.enum(['idle', 'running', 'paused', 'usage-limit', 'checkpoint', 'needs-you', 'done', 'error']),
  stopAt: z.enum(STOP_AT),
  // Old state files predate the option; they paused at every act.
  pauseAtActs: z.boolean().default(true),
  spentUsd: z.number().min(0),
  current: z.object({ kind: z.enum(['scene', 'chapter', 'act', 'book']), id: text, round: z.number().int().min(1) }).nullable(),
  completed: z.array(id(ID.scene, 'scene')),
  parked: z.array(id(ID.scene, 'scene')),
  checkedChapters: z.array(id(ID.chapter, 'chapter')),
  checkedActs: z.array(id(ID.act, 'act')),
  // Old state files predate the book check; a finished book is checked on its next run.
  checkedBook: z.boolean().default(false),
  resumeAfter: z.string().nullable(),
  lastError: z.string().nullable()
})

export function parseYamlText(text: string): unknown {
  return parse(text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'))
}

export function parseFrontmatter(text: string): { data: unknown; body: string } | null {
  const t = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const m = t.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  return m ? { data: parse(m[1]), body: m[2] } : null
}

const RULES: [RegExp, z.ZodTypeAny, boolean][] = [
  [/^book\.yaml$/, Book, false],
  [/^series\.yaml$/, Series, false],
  [/^outline\/outline\.yaml$/, Outline, false],
  [/^outline\/scenes\/SC-\d{3,}\.yaml$/, ScenePlan, false],
  [/^canon\/facts\.yaml$/, Facts, false],
  [/^canon\/timeline\.yaml$/, Timeline, false],
  [/^canon\/knowledge\.yaml$/, Knowledge, false],
  [/^proposals\/P-\d{4,}\.yaml$/, Proposal, false],
  [/^reviews\/(SC-\d{3,}|CH-\d{2,}|ACT-\d+)\/park\.md$/, Park, true],
  [/^reviews\/(SC-\d{3,}|CH-\d{2,}|ACT-\d+|BOOK)\/[a-z-]+\.md$/, Review, true],
  [/^notes\/open-questions\.yaml$/, OpenQuestions, false],
  [/^notes\/changes\/CHG-\d{4,}\.yaml$/, ChangeRequest, false],
  [/^bible\/characters\/CHAR-[A-Z0-9-]+\.md$/, Character, true],
  [/^bible\/places\/LOC-[A-Z0-9-]+\.md$/, Place, true]
]

export function schemaFor(relPath: string): { schema: z.ZodTypeAny; frontmatter: boolean } | null {
  const r = RULES.find(([re]) => re.test(relPath))
  return r ? { schema: r[1], frontmatter: r[2] } : null
}

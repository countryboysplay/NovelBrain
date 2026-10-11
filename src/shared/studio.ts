import type { z } from 'zod'
import type { Book, Character, Facts, Knowledge, OpenQuestions, Outline, Place, REVIEWERS, ScenePlan, Timeline } from './schemas'
import type { SpendEntry } from '../main/run/state'
export type { SpendEntry }

export type BookT = z.infer<typeof Book>
export type OutlineT = z.infer<typeof Outline>
export type ScenePlanT = z.infer<typeof ScenePlan>
export type FactT = z.infer<typeof Facts>['facts'][number]
export type EventT = z.infer<typeof Timeline>['events'][number]
export type KnowT = z.infer<typeof Knowledge>['entries'][number]
export type QuestionT = z.infer<typeof OpenQuestions>['questions'][number]
export type CharacterT = z.infer<typeof Character> & { body: string }
export type PlaceT = z.infer<typeof Place> & { body: string }
export interface WorldDoc { file: string; title: string; body: string }
export type Reviewer = (typeof REVIEWERS)[number]
export interface Verdict { reviewer: Reviewer; verdict: 'PASS' | 'FLAG' | 'FAIL'; round: number }
export interface SceneInfo { plan: ScenePlanT | null; words: number; accepted: boolean; hasDraft: boolean; verdicts: Verdict[]; park: string | null }
export interface StudioData {
  book: BookT | null
  characters: CharacterT[]
  places: PlaceT[]
  world: WorldDoc[]
  outline: OutlineT
  scenes: Record<string, SceneInfo>
  facts: FactT[]
  events: EventT[]
  knowledge: KnowT[]
  questions: QuestionT[]
  git: { commits: number; clean: boolean }
  spend: SpendEntry[]
}
export interface SceneDetail { id: string; manuscript: string | null; draft: string | null; reviews: (Verdict & { body: string })[]; park: string | null }
export interface ManuscriptScene { id: string; title: string; act: string; chapter: string; chapterTitle: string; text: string }
export interface SeriesBook { id: string; title: string; status: 'active' | 'archived'; dir: string; predecessor: string | null; current: boolean; characters: string[] }

export const countWords = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0)

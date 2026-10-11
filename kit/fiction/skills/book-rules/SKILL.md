---
name: book-rules
description: Use in every Novel Brain book task. Gives the founding rule, what each folder of the book is, who may write where, why plans are not facts, and how proposals and retcons change canon.
---

# Book rules

## The founding rule
The manuscript is prose. Canon is truth. The outline is intent. Memory is evidence. Character state is the present. The Brain must never confuse them.

## The folders
- `book.yaml`: the book's title, audience, genres, word target, series and predecessor, and whether it is active or archived. Read it; never write it.
- `bible/`: the design. `characters/CHAR-*.md` (name, role, voice, arc beats, then a description), `places/LOC-*.md`, and `world/*.md` (world rules, themes, `style.md` the voice sheet, `brief.md` for the blurb, promise, shelf, comps, ending and genre notes, `structure.md` for the structural framework). Intent, freely revised by the story architect.
- `outline/`: intent. `outline.yaml` orders acts, chapters and scenes; `scenes/SC-###.yaml` is each scene's plan, with its status: `planned`, `drafting`, `review`, `accepted` or `needs-you`.
- `canon/`: truth. `facts.yaml` (facts with status `established` or `superseded`), `timeline.yaml` (events in story time) and `knowledge.yaml` (which character knows which fact, and how). Written only by Novel Brain's acceptance step.
- `manuscript/SC-###.md`: accepted prose, exactly as the reader will see it. Written only by acceptance.
- `drafts/SC-###.md`: pending prose for a scene being written.
- `proposals/P-####.yaml`: pending canon changes, one per scene, in the proposal-format skill's shape.
- `reviews/<id>/`: review files for a scene (`SC-###`), a chapter (`CH-##`) or an act (`ACT-#`), and `park.md` when a scene waits for the writer.
- `notes/`: working notes, including `open-questions.yaml`, the questions the story has opened and where they are answered.
- `run/state.yaml`: the run loop's state, written only by the app.
- `art/`: cover and interior art.
- Memory, injected by the app at session start, is evidence about how this writer likes their books written. It never holds story facts.

## Who writes where
- The story architect writes `bible/`, `outline/` and `notes/open-questions.yaml`.
- The author writes `drafts/`. The canon keeper writes `proposals/`. Each reviewer writes only its own file in `reviews/`.
- The showrunner writes `reviews/SC-###/park.md`, scene plan `status` lines and `notes/open-questions.yaml`.
- Nobody in a Claude session writes `canon/`, `manuscript/`, `run/`, `book.yaml`, `series.yaml`, `.claude/`, `.novelbrain/` or `.git/`. A guard blocks those writes, and every write in an archived book. Only the acceptance step, run as `node .novelbrain/accept.mjs SC-###`, moves a draft into the manuscript and applies its proposal to canon in one git commit.

## Plans are not facts
- A scene plan says what a scene should do. Until the scene is accepted, nothing in the plan is true. Never cite a plan as evidence that something happened, and never treat a planned event as canon.
- What happened is in `canon/` and `manuscript/`. What a character knows is in `canon/knowledge.yaml`, not in what the reader or the narrator knows.
- A character's belief can be wrong. Objective truth lives in `canon/facts.yaml`; a character's knowledge is only what `canon/knowledge.yaml` records or what they learn on the page.

## Proposals and retcons
- Prose proposes canon; it never rewrites it. After a draft, the canon keeper writes what the prose established as a proposal. The proposal is applied only when every review passes and acceptance succeeds.
- Facts are never edited. A deliberate change of truth is a retcon: a new fact that supersedes an established one. The old fact stays in canon as `superseded`, and git keeps every earlier version.
- An earlier book in a series is history. Its canon is read, never changed.
- Discovery is allowed: a scene may establish something the plan did not foresee, as long as the proposal records it and the reviewers accept it.

## When the author asks you to change canon or the manuscript
- Do not try to edit `canon/`, `manuscript/` or `book.yaml` directly; the guard blocks it. Write a ChangeRequest instead, then tell the author to approve it in Novel Brain. Only the app applies it, in one git commit, after the author sees a before and after view.
- File: `notes/changes/CHG-####.yaml`, four digits. Take the next free number: Glob `notes/changes/**/CHG-*.yaml` (pending, `applied/` and `rejected/`), take the highest, add one (`CHG-0001` if none). `id` inside the file equals the file name without `.yaml`.
- Shape: `id`, a one-line `summary`, and at least one of these lists:
  - `canon`: changes in the proposal-format skill's shape (`op`, `target`, `data`). Facts are never edited: a changed fact is a `retcon` that supersedes it. New facts and events get `source: author`.
  - `manuscript`: `{ scene: SC-###, text: <the whole new scene text> }`, only for scenes in `outline/outline.yaml`. The text replaces the scene file completely, so include every unchanged paragraph. At most 1 MB per scene.
  - `outline`: `{ scene: SC-###, status: planned }` to reopen a scene so the run writes it again.
- Example:

```yaml
id: CHG-0003
summary: Amos was in town the night the barn burned
canon:
  - op: retcon
    target: facts
    data: { statement: Amos was in town the night the barn burned., supersedes: FACT-003 }
outline:
  - { scene: SC-012, status: planned }
```

## Lessons
`bible/world/lessons.md` holds this book's craft lessons: short, numbered, one line each ("Close every scene on its outcome."). It is spoiler-free: never a story fact, a culprit, a plant or a twist; story facts live in canon and the bible. The showrunner writes it; the story-architect, author and line editor read it before they work. Memory's lessons (`.novelbrain/memory.md`) are the writer's across books; this file is this book's.

## No spoilers in replies
The writer reads replies, step notes and the writers' room. Never name the solution, a character's hidden role or what a planted clue means in a reply or a note; say what happened in story terms ("Tiffany finds the second jacket") or craft terms ("the clue in beat 3 is too plain"). Files keep the full truth; only replies hold back.

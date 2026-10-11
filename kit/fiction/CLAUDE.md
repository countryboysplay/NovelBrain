# This book

The manuscript is prose. Canon is truth. The outline is intent. Memory is evidence. Character state is the present. The Brain must never confuse them.

## Folders
- `bible/`: the design (characters, places, world rules, style guide). Intent.
- `outline/`: the order of acts, chapters and scenes, and each scene's plan. Intent, not fact.
- `canon/`: what is true in the story (facts, timeline, who knows what). Written only by Novel Brain's acceptance step.
- `manuscript/`: accepted prose. Written only by the acceptance step.
- `drafts/`, `proposals/`, `reviews/`: work in progress: prose drafts, proposed canon changes, review verdicts.
- `notes/`: working notes, including `open-questions.yaml`.
- `run/state.yaml`: the run loop's state, written only by the app.
- Lessons from earlier sessions are in `.novelbrain/memory.md` (written by Novel Brain; read-only).

## Working rules
- Run steps through the commands in .claude/commands; the showrunner skill explains the procedure.
- The book-rules skill says who writes where. Writes to `canon/`, `manuscript/`, `run/`, `book.yaml`, `series.yaml`, `.claude/`, `.novelbrain/` and `.git/` are blocked; prose proposes canon through `proposals/` and only acceptance applies it.
- The only shell commands allowed are `node .novelbrain/accept.mjs SC-###`, `node .novelbrain/accept.mjs SC-### --touchup` and `node .novelbrain/accept.mjs SC-### --sealed`, and read-only `git diff`, `git log` and `git show`.
- The audience and genre skills for this book are named in `book.yaml`: read `.claude/skills/audience-<audience>/SKILL.md` and `.claude/skills/genre-<genre>/SKILL.md` for each of its genres before writing or judging prose.

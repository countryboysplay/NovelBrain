---
name: showrunner
description: Use when a Novel Brain command runs a step of the book (write, revise or review a scene, plan or check a chapter, check an act or the book, add a character). It is the orchestrator procedure that dispatches the kit agents, gates each stage, runs acceptance and ends with the one-line JSON result the app reads.
---

# Showrunner

You run exactly one step of writing this book, in this session, and then stop. You are the orchestrator: the agents in `.claude/agents/` do the writing and reviewing, and Novel Brain's acceptance step changes canon and the manuscript. You decide what runs next from the files they leave behind.

## Ground rules
1. Run the procedure yourself, in this main session. Subagents cannot dispatch subagents, so never hand the procedure to an agent; you dispatch every agent directly with the Agent tool.
2. Keep your context small. Never read a whole draft, a whole manuscript scene or the manuscript folder. Read plans, `run/state.yaml`, `notes/open-questions.yaml`, review frontmatter and the FAIL and FLAG finding lines of reviews. To see a review's verdict, Grep for `^verdict:` or Read the file with `limit: 8`. To collect findings, Grep for `^[0-9]+\. (FAIL|FLAG)\.` with 3 lines of context after.
3. Every dispatch prompt names the agent's target id, the round, the mode or stage when the agent has modes, and any extra files to read. Ask every agent to write its files and reply in at most 5 lines. Never paste prose or whole reviews into a prompt; name the file instead.
4. Agents that are independent of each other run in parallel: send their Agent calls in one message.
5. You may write only these files: `reviews/SC-###/park.md`, the `status` field of `outline/scenes/SC-###.yaml`, `notes/open-questions.yaml` and `bible/world/lessons.md`. Never write `canon/`, `manuscript/`, `run/`, `book.yaml`, `series.yaml`, `.claude/`, `.novelbrain/` or `.git/`; the guard blocks it and only acceptance changes canon and the manuscript. Never write drafts, proposals or reviews yourself; the agents own them.
6. The only shell commands you may run are `node .novelbrain/accept.mjs SC-###`, `node .novelbrain/accept.mjs SC-### --touchup` and `node .novelbrain/accept.mjs SC-### --sealed`, exactly as written (from the book folder, no `cd`, no pipes, no redirection) and read-only `git diff`, `git log` and `git show` with plain flags such as `--stat`, `--oneline` or `-n 5`. Never run any other shell command; the guard refuses it.
7. Your final reply ends with one line of JSON and nothing after it, as the step's Reply section shows. Put any explanation on the lines before it. The app parses only that last line. The JSON always has the keys `"step"`, `"id"`, `"outcome"`, `"rounds"`, `"commit"`, `"revise"` and `"note"`, in that order, on one line, with no code fence around it.
8. If a step cannot start or continue (a missing plan, an archived book, an agent that keeps returning `BLOCKED`, a tool error you cannot work around), stop and reply with outcome `error` and the reason in `note`.
9. Read `.novelbrain/memory.md` if it exists. Put the names of its recurring catches into the author's brief for every scene and revision (the author reads the full text itself). Memory holds lessons, never story facts; canon wins over memory.

## Reading the agents' replies
- `author` returns `DRAFTED SC-### round N` or `BLOCKED: <reason>`. `canon-keeper` returns `PROPOSED P-#### for SC-###`. `story-architect` returns `DONE` or `BLOCKED: <reason>`.
- Reviewers return `PASS`, `FLAG` or `FAIL` and their review path. The file is the record; trust the file's `verdict:` over the reply.
- `gate-checker` returns `STAGES PASS: <stages>`, `STAGES FLAG: <stages>` or `STAGES FAIL: <stages>`, then for a FAIL the agents that must redo work. A draft-stage or proposals-stage gate leaves `verdict: FAIL` in `gate.md` because of `GATE-REV-00` even when its stages pass; that is expected and clears only at the reviews-stage gate. Judge an early gate by its `STAGES` line, never by the file.

## Rounds
- A round is one pass of draft, proposal and eight reviews (seven reviewers plus the gate) for one scene. Every review file carries `round:` in its frontmatter, and acceptance requires all eight at the same round.
- The first round of a run is R = 1 + the highest `round:` in `reviews/SC-###/*.md` (Grep `^round:` in that folder; `park.md` has none). With no reviews yet, R = 1.
- A run gets at most three rounds: R, R + 1 and R + 2. The last of them is the last round. For a scene written for the first time that is round 3.
- A touch-up (scene procedure, Touch-up) reruns some reviews at R + 1 and keeps the others at R; it does not count toward the three-round cap, and `rounds` counts it.
- `rounds` in the reply is the number of rounds this run used, a polish round included.

## Lessons
When the writer asks you to remember a craft lesson for this book, or the same fault fails a round twice in this book, add one numbered line to `bible/world/lessons.md` (create it with the heading `# Lessons` if it is missing), as the book-rules skill's Lessons section says. Never put a story fact in it.

## No spoilers in replies
Your final reply's `note`, everything you say before it, and every dispatch prompt (the writers' room shows them) follow the book-rules skill's No spoilers in replies section. Files keep the full truth.

## Scene procedure (`/write-scene SC-###`)
1. Read `run/state.yaml` (read only, to see the run's settings), `outline/scenes/SC-###.yaml` and `notes/open-questions.yaml`. Use Glob on `reviews/SC-###/` to see which review files exist, and work out R as Rounds says. If the plan is missing or its status is `accepted`, stop and reply `error`. If `reviews/SC-###/park.md` exists, the scene was parked before and the writer has released it: Read it, and give its reason to the author in the first round as extra findings. Then Glob `bible/world/`. If `style.md` or `brief.md` is missing, dispatch `story-architect` to write the voice sheet (as the style skill describes) and the brief (as its Output describes), whichever is missing, from `book.yaml`, the bible, the skills and two or three accepted scenes if there are any, and wait for it before drafting. If it returns `BLOCKED`, go on without them (the style skill's fallback applies) and say so in `note`.
2. If the plan's status is `planned` or `needs-you`, set it to `drafting` (change only the `status` line). Leave an `accepted` status alone (a revision that does not replan); acceptance sets it again.
3. Draft. Dispatch `author` with the scene id and round R. A redraft is any round after this run's first round; say so, and that it must read every review file of round R - 1 in `reviews/SC-###/`, plus any extra findings files or refusal reasons you carry forward. The first round of a run is never a redraft, even when R is above 1 (a revision, a released park, or a run restarted after an error): tell the author it is not a redraft and give it only the extra findings, if any (the revision's review file, the park reason). Ask it to use one of its at most 5 reply lines for the open question ids (from `notes/open-questions.yaml`) the scene answers on the page, and any new question the scene deliberately leaves the reader with, in one sentence each.
4. Propose. Dispatch `canon-keeper` with the scene id and round R. If its reply names a likely accidental contradiction of canon (prose that contradicts an established fact without the plan meaning it to), do not send it to review: re-dispatch `author` for the same round with the contradiction as a FAIL finding, then `canon-keeper` again. If the plan means the change, tell the canon-keeper to propose it as a retcon instead. This counts toward step 5's two fixes.
5. Early gate. Dispatch `gate-checker` with target SC-###, round R, stages `draft, proposals`. If it returns `STAGES FAIL`, re-dispatch the agents it names (author or canon-keeper) with `reviews/SC-###/gate.md` as findings to fix, then run the same gate again. If the author is re-dispatched, re-dispatch canon-keeper after it, because the proposal must describe the current draft. Allow two such fixes per round; if the gate still fails, the round has failed: carry `gate.md`'s findings into the next round as extra findings and go to step 9.
6. If the plan's status is `drafting`, set it to `review`. Review. In one message, dispatch in parallel `continuity-reviewer`, `character-reviewer`, `developmental-editor`, `line-editor`, `audience-reviewer`, `reader` and `canon-auditor`, each with the scene id and round R, and scene mode for those with modes. They write `reviews/SC-###/continuity.md`, `character.md`, `developmental.md`, `line.md`, `audience.md`, `reader.md` and `canon-auditor.md`. Tell the reader only the scene id and the round: never a goal, a beat or why the scene exists.
7. Final gate. Always dispatch `gate-checker` (model opus) with target SC-###, round R, stage `reviews`, even when every reviewer passed; acceptance requires its `gate.md` at round R. If it returns `STAGES FAIL`, re-dispatch only the reviewers it names, for the same round R, then run the reviews-stage gate again. Allow two such fixes per round; if the gate still fails, the round has failed: carry `gate.md`'s findings forward and go to step 9. If a reviewer's FAIL that the gate does not question has already failed the round, skip the gate's redo requests for other reviewers and go to step 9; redoing them cannot save the round.
8. Verdicts. Grep `^verdict:` in the eight files `continuity.md`, `character.md`, `developmental.md`, `line.md`, `audience.md`, `reader.md`, `canon-auditor.md` and `gate.md`. If any is FAIL, the round has failed; go to step 9. If none is FAIL, decide whether to polish before acceptance:
   - Polish only when R is this run's first round. A run polishes at most once.
   - Count the FLAG findings (Grep `^[0-9]+\. FLAG\.`) in `line.md`, `developmental.md`, `audience.md` and `reader.md`. Polish when the count is 3 or more, or when any FLAG finding cites a craft-tells rule (Grep `Rule: CT-`).
   - The scene that opens the book (the first scene of the first chapter of the first act in `outline/outline.yaml`) always polishes when its run's first round passes, whatever the count. With no FLAG findings, tell the author to sharpen its first 250 words and its last paragraph against the audience skill's first-page rules and the voice sheet.
   - To polish, first run exactly `node .novelbrain/accept.mjs SC-### --touchup` to seal round R, so the passing round is kept (ignore its `rerun` list; if it prints `"ok":false`, polish without a seal). Then start round R + 1 at step 3 as a polish round: tell the author it is a redraft after a passing round, that its findings are every FLAG finding of round R, and that it must keep everything the reviews did not question. The polish round runs every step like any round (proposal, gates, all reviews).
   - A failed polish round never goes to step 9 when round R is sealed. If the polish round fails anywhere (step 5, 7 or 8, or a step-10 refusal that would count as a failed round), run exactly `node .novelbrain/accept.mjs SC-### --sealed`: it puts back the passing round R and accepts it, and its JSON is read as step 10 says (a `--sealed` refusal follows step 10's rule). Name the polish round's FAIL findings and round R's FLAG findings in `note`. Without a seal, a failed polish round goes to step 9 like any failed round.
   - Otherwise, if any prose review (`continuity.md`, `character.md`, `developmental.md`, `line.md`, `audience.md` or `reader.md`) has a FLAG finding and this run has not touched up yet, run Touch-up below. Otherwise go to step 10. FLAG findings only in `canon-auditor.md` or `gate.md` never start a touch-up, which cannot fix them: go to step 10 and name them in `note`.
9. A failed round.
   - If R is the last round, park the scene (Parking below) and reply `parked`.
   - Otherwise start round R + 1. If the only FAIL verdict is in `canon-auditor.md` and its FAIL findings are about the proposal rather than the prose (a change the proposal missed, invented or misstated), the draft can stand: re-dispatch `canon-keeper` with `reviews/SC-###/canon-auditor.md` as findings, then go back to step 5 with only the `proposals` stage, then step 6. Rewriting the proposal makes every review older than it, so all seven reviewers and the final gate always run again at the new round; never rerun canon-keeper after the reviews without rerunning them. In every other case go back to step 3 with round R + 1.
10. Accept. Run exactly `node .novelbrain/accept.mjs SC-###`. It prints one line of JSON. Once it prints `"ok":true`, the outcome is `accepted` with that commit, whatever happens afterwards.
    - `{"ok":true,"commit":"<hash>"}`: the scene is accepted. Acceptance moved the draft into `manuscript/`, applied the proposal to canon, set the plan's status to `accepted` and made a git commit. Now update `notes/open-questions.yaml` from the author's last reply: set `answered: SC-###` on each question the scene answered, and add each new question it raised with the next free `Q-###` id, `raised: SC-###`, `answerBy: null` and `answered: null`. Never change any other entry. If the update fails (the hook rejects the file, or the author's line cannot be read), leave the file as it was, say so in `note`, and still reply `accepted` with the commit hash; ground rule 8 never applies after a successful acceptance.
    - `{"ok":false,"reasons":[...]}`: acceptance refused and changed nothing. Route the refusal by which command refused:
      - During a touch-up (Touch-up step 1 returned `"ok":true`), every refusal of plain `node .novelbrain/accept.mjs SC-###`, whatever its reasons (an old or missing rerun review, too many words changed, a changed proposal, anything else), goes to Touch-up step 4's fallback: run `--sealed`. It is never a failed round.
      - A refusal of `node .novelbrain/accept.mjs SC-### --sealed` never leads to `--sealed` again. If a reason names a proposal (`proposals/P-####` or `the proposal`), treat the reasons as FAIL findings and go to step 9. Otherwise reply `error` with the reasons in `note`, without spending a round.
      - Outside a touch-up, only these reasons are scene findings:
        - a reason about a review file (it starts with a reviewer name followed by `review`, for example `line review is at round 1, not 2`), or says `reviews are older`: the reviews must run again;
        - a reason about `drafts/SC-###.md`: the draft must be rewritten;
        - a reason about a proposal (`proposals/P-#### is not a valid proposal`, or one starting `P-#### change`): send it through the canon-keeper path of step 9, as if canon-auditor had failed the proposal.
        Treat those as FAIL findings for the next round and go to step 9; such a refusal counts as a failed round. Every other reason (anything about `book.yaml`, `canon/`, `outline/`, git, the lock or journal, a stray file in `proposals/`, or an internal error) is outside what the agents can fix: reply `error` with the reasons in `note`, without spending a round.

### Touch-up
A touch-up fixes a passing round's FLAG findings without a full round. It never changes the proposal or the plan.
1. Run exactly `node .novelbrain/accept.mjs SC-### --touchup`. It prints one line of JSON. `{"ok":true,"rerun":[...]}` sealed round R and names the reviewers to rerun. `{"ok":false,...}`: skip the touch-up and go to step 10.
2. Dispatch `author` with round R + 1: it is a touch-up of round R; its findings are the FLAG findings of round R in the review files of the reviewers `rerun` names; it changes only the sentences those findings quote, at most 200 words in all, and keeps everything else exactly. Do not dispatch canon-keeper.
3. In one message, dispatch the reviewers in `rerun` other than `gate`, each with the scene id and round R + 1. Then dispatch `gate-checker` with target SC-###, round R + 1, stage `reviews`, and tell it this is a touch-up of round R: the reviewers in `rerun` are at round R + 1 and the others stay at round R. Rerun exactly the `rerun` list, no more and no fewer.
4. If no rerun verdict is FAIL and the gate's stages pass, run step 10. If a rerun verdict is FAIL, the gate fails after its fixes, or acceptance refuses the touch-up, run exactly `node .novelbrain/accept.mjs SC-### --sealed`: it puts back the sealed draft and reviews of round R and accepts them, and its JSON is read as step 10 says. If `--sealed` itself refuses, follow step 10's rule for a `--sealed` refusal; never run `--sealed` again. Name the FLAG findings left unfixed in `note`.
A touch-up does not count toward the three-round cap.

### Parking
Write `reviews/SC-###/park.md` (Read it first if it exists, then replace it in full):
```markdown
---
scene: SC-012
reason: >-
  After three rounds the line review still fails MG-LANG-02 on the opening paragraph, and the audience review fails MG-CON-10 because the plan's beat 3 asks for a death on the page.
---
```
`reason` is one paragraph naming the blocking FAIL findings by reviewer and rule id, and what the writer must decide. Then set the plan's status to `needs-you`. A must-fix content limit FAIL (for example `MG-CON-10`, content beyond the audience's defaults) that survives the last round is always parked for the writer; never work around it by changing the plan yourself.

### Reply
```
{"step":"scene","id":"SC-012","outcome":"accepted","rounds":2,"commit":"abc1234","revise":[],"note":"Accepted at round 2; Q-004 answered."}
```
`outcome` is `accepted`, `parked` or `error`. `commit` is the short hash from acceptance, or `null` when not accepted. `revise` is always `[]` for a scene. `note` is one sentence.

## Revision procedure (`/revise-scene SC-### <review file>`)
The scene is usually already accepted, and a chapter or act check named it in the `revise` list of the given review file (for example `reviews/CH-03/arc.md`).
1. Read the plan and the review file's frontmatter, and Grep the review file for the findings that name this scene or quote it. Those findings are the extra findings for the first round.
2. Decide whether the findings need a new plan (a missing or wrong beat, goal or arc beat in the plan itself) or only new prose. If they need a new plan: an accepted scene's plan is locked, so first reopen it by setting its status to `planned`, then dispatch `story-architect` with the scene id and the review file, asking it to change only this scene's plan as the findings require.
3. Run the scene procedure from step 2 with these differences. Work out R from the existing reviews as Rounds says (the scene's earlier reviews count, so R is usually above 3). Tell the author the scene is a revision: it starts from the accepted text in `manuscript/SC-###.md` (there is no draft), reads the extra findings, and writes the full revised scene to `drafts/SC-###.md`. Tell the canon-keeper the scene is a revision: canon already holds what the earlier version established with source SC-###, so it proposes only what the revision adds or changes, using a retcon where the revision contradicts a fact the earlier version established. Tell the canon-auditor the scene is a revision: its blind list leaves out facts already established in canon (including those with source SC-###, from the earlier version of this scene), and lists a fact the revision changes as one retcon item. Tell the continuity-reviewer the scene is a revision: facts with source SC-### come from the earlier version of this scene, so a change to them that the extra findings file asks for is intended, not a contradiction; the canon-keeper proposes it as a retcon.
4. Reply exactly as the scene procedure does, with `"step":"scene"`. If the revision parks, the accepted text stays in `manuscript/` and the writer decides.

## Review-only procedure (`/review-scene SC-###`)
For the writer, when a draft and proposal exist and only the reviews must run. Work out R as Rounds says, then run scene steps 6 to 8 once: no redraft, no acceptance. Reply:
```
{"step":"review","id":"SC-012","outcome":"pass","rounds":1,"commit":null,"revise":[],"note":"No FAIL verdicts at round 4."}
```
`outcome` is `pass` when no verdict is FAIL, `fail` when any is (name the failing reviewers in `note`), or `error`.

## Chapter plan procedure (`/plan-chapter CH-##`)
1. Read `outline/outline.yaml` and `notes/open-questions.yaml`. The round is 1 + the highest `round:` in `reviews/CH-##/gate.md` and `reviews/CH-##/developmental.md`, or 1.
2. Dispatch `story-architect` to plan every not yet accepted scene of the chapter (adding the chapter and its scene ids to the outline if they are not there), with the open questions the chapter must answer, and to write the voice sheet `bible/world/style.md` and the brief `bible/world/brief.md` first if either is missing.
3. Dispatch `gate-checker` with target CH-##, the round and stage `plan`, and `developmental-editor` with target CH-##, the round and plan mode, in parallel.
4. If the gate returns `STAGES FAIL` or the developmental verdict is FAIL, and fewer than three rounds have run, dispatch `story-architect` again with `reviews/CH-##/gate.md` and `reviews/CH-##/developmental.md` as findings, then repeat step 3 at the next round. After three failed rounds, stop.
5. Reply:
```
{"step":"plan","id":"CH-03","outcome":"pass","rounds":1,"commit":null,"revise":[],"note":"Four scenes planned."}
```
`outcome` is `pass`, `parked` (three failed rounds; name the blocking findings in `note`) or `error`.

## Chapter check procedure (`/check-chapter CH-##`)
1. Read `outline/outline.yaml` for the chapter's scene ids, then Grep `^status:` in each `outline/scenes/SC-###.yaml` and confirm every one is `accepted`; if not, reply `error`. The round is 1 + the highest `round:` in `reviews/CH-##/arc.md` and `reviews/CH-##/flow.md`, or 1.
2. Dispatch `arc-auditor` and `flow-reader` in parallel with target CH-## and the round. They write `reviews/CH-##/arc.md` and `reviews/CH-##/flow.md`, each with a `revise:` list when it fails.
3. Dispatch `gate-checker` with target CH-##, the round, stage `reviews`, and the reviews `arc.md` and `flow.md`. If it returns `STAGES FAIL`, re-dispatch the reviewers it names once and gate again.
4. Read the `verdict:` and `revise:` lines of `arc.md` and `flow.md`.
   - Both PASS or FLAG, and the gate's stages pass: outcome `pass`.
   - Either FAIL: outcome `revise`, with `revise` the union of both `revise:` lists, keeping only accepted scene ids of this chapter, in outline order. Put the review file each scene came from in `note`, for example `SC-011 from reviews/CH-03/arc.md`.
   - Either FAIL with an empty union, or the gate still failing after its fix: outcome `parked`, naming the problem in `note`.
5. Reply:
```
{"step":"chapter","id":"CH-03","outcome":"revise","rounds":1,"commit":null,"revise":["SC-011"],"note":"SC-011 from reviews/CH-03/arc.md: Ruth's arc beat is missing."}
```
`revise` is `[]` unless the outcome is `revise`.

### Shared review files
The chapter plan and chapter check procedures both write `reviews/CH-##/gate.md` (and the plan's `developmental.md` sits in the same folder), the act and book checks both write `reviews/ACT-#/continuity.md` and `gate.md`, and the book check writes `reviews/BOOK/developmental.md` and `gate.md`. That is intended: each run rewrites the file in full at its own round, and nothing reads the earlier file once the step that wrote it has finished.

## Act check procedure (`/check-act ACT-#`)
1. Read `outline/outline.yaml` for the act's chapters and scenes. The round is 1 + the highest `round:` in `reviews/ACT-#/*.md`, or 1.
2. In parallel, dispatch `developmental-editor` in act mode and `continuity-reviewer` in sweep mode, each with target ACT-# and the round. They read the act's plans, its accepted scenes and `canon/`, and write `reviews/ACT-#/developmental.md` and `reviews/ACT-#/continuity.md`.
3. Dispatch `gate-checker` (model opus) with target ACT-#, the round, stage `reviews`, and the reviews `developmental.md` and `continuity.md`. If it returns `STAGES FAIL`, re-dispatch the reviewers it names once and gate again.
4. Decide the outcome as the chapter check does, from the `verdict:` and `revise:` lines of the two act reviews, keeping only accepted scene ids of this act.
5. Reply:
```
{"step":"act","id":"ACT-1","outcome":"pass","rounds":1,"commit":null,"revise":[],"note":"Act 1 holds; two FLAGs for the writer."}
```

## Book check procedure (`/check-book [focus]`)
1. Read `outline/outline.yaml`, then Grep `^status:` in every `outline/scenes/SC-###.yaml` it lists and confirm every one is `accepted`; if not, reply `error`. The book round is 1 + the highest `round:` in `reviews/BOOK/*.md`, or 1. Each act's round is 1 + the highest `round:` in `reviews/ACT-#/*.md`, or 1.
2. In one message, dispatch `developmental-editor` in book mode with target BOOK and the book round, and `continuity-reviewer` in sweep mode once per act, each with target ACT-# and that act's round; each sweep reads all of `canon/` as well as its act. If the writer gave a focus with the command, give it to every agent as what to look at first.
3. Dispatch `gate-checker` (model opus) with target BOOK, the book round, stage `reviews` and the review `developmental.md`, and once per act with target ACT-#, its round, stage `reviews` and the review `continuity.md`. If a gate returns `STAGES FAIL`, re-dispatch the reviewers it names once and gate again.
4. Decide the outcome as the chapter check does, from the `verdict:` and `revise:` lines of `reviews/BOOK/developmental.md` and every act's `continuity.md`, keeping only accepted scene ids of the book, in outline order. Put the review file each scene came from in `note`, for example `SC-031 from reviews/BOOK/developmental.md`.
5. Reply:
```
{"step":"book","id":"BOOK","outcome":"pass","rounds":1,"commit":null,"revise":[],"note":"The ending keeps the brief's promise; two FLAGs for the writer."}
```

## New character procedure (`/new-character <description>`)
Dispatch `story-architect` with the writer's description, asking it to create one character file in `bible/characters/` and to change no plan or outline. Reply:
```
{"step":"character","id":"CHAR-RUTH","outcome":"done","rounds":1,"commit":null,"revise":[],"note":"Created bible/characters/CHAR-RUTH.md."}
```
`outcome` is `done` or `error`.

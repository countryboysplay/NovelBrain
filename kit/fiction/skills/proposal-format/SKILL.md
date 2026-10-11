---
name: proposal-format
description: Use when writing or checking a canon proposal (proposals/P-####.yaml), to get its exact YAML shape, the supported operations and targets, NEW-n references, retcon rules and file numbering.
---

# Proposal format

A proposal is how a scene asks to change canon. Nothing in it is true until the scene is accepted; then Novel Brain's acceptance step applies it to `canon/`, gives every new fact and event its id, and deletes the proposal file.

## File
- One proposal file per scene: `proposals/P-####.yaml`, four digits, directly in `proposals/` (no subfolders, no other file names; acceptance refuses a stray file there).
- The `id` inside the file equals the file name without `.yaml`.
- A proposal's number is its scene's number, four digits at least: SC-012's proposal is `proposals/P-0012.yaml`. Ids never repeat between scenes.
- If the scene already has a proposal (an earlier round), rewrite that same file in full instead of adding a second one. Find it with Grep for `scene: SC-###` in `proposals/`.

## Shape
```yaml
id: P-0007
scene: SC-012
changes:
  - op: add
    target: facts
    data:
      statement: The brass key Ruth found opens the cellar under the chapel.
  - op: retcon
    target: facts
    data:
      statement: Amos was in town the night the barn burned, not at the farm.
      supersedes: FACT-003
  - op: add
    target: timeline
    data:
      storyTime: Day 3, dusk
      place: LOC-FARM-WELL
      who: [CHAR-RUTH]
      what: Ruth climbs down the well and recovers the key.
  - op: add
    target: knowledge
    data:
      character: CHAR-RUTH
      fact: NEW-1
      how: She tried the key in the cellar door.
```
`changes` has at least one entry. A hook rejects a file that does not match this shape; fix it and write it again.

## Operations
Only these four are supported; anything else makes acceptance refuse the scene.
- `add` on `facts`: `data.statement`, one self-contained sentence. Acceptance gives it the next `FACT-###` id, status `established` and source the scene.
- `retcon` on `facts`: `data.statement` and `data.supersedes`, an established `FACT-###` id. The old fact becomes `superseded` and stays in canon as history; the new statement gets a new id.
- `add` on `timeline`: `data.storyTime`, `data.place` (an existing `LOC-` id with a file in `bible/places/`), `data.who` (a list of existing `CHAR-` ids with files in `bible/characters/`) and `data.what`.
- `add` on `knowledge`: `data.character` (an existing `CHAR-` id), `data.fact` and `data.how` (how they learned it). A knowledge entry the character already has is skipped.
- Never use `update`. Facts are never edited in place; a changed fact is a retcon.

## NEW-n references
A knowledge entry may point at a fact this same proposal creates: `NEW-1` is the first fact the proposal adds or retcons, counting both `add` and `retcon` changes on `facts` in file order from 1, `NEW-2` the second, and so on. Every other `fact` value is an existing `FACT-###` id.

## Retcons
- Retcon only when the prose deliberately contradicts an established fact and the scene plan intends it (a reveal that the earlier fact was wrong or has changed). An accidental contradiction is a prose error for the author to fix, not a retcon.
- `supersedes` must name a fact whose status is `established`. A superseded fact cannot be superseded again; retcon the fact that replaced it.
- The superseded fact is never deleted. Earlier scenes keep what they said; the record shows when and where the truth changed.
- In a series, an earlier book's canon is history and is never retconned from this book. Name a contradiction with an earlier book in your reply so the writer can decide.

## Correction or later development
- A correction retcons a fact that was never true (the earlier scene got it wrong, or a reveal shows it was a lie). The new statement replaces it.
- A later development retcons a fact that was true and has since been overtaken. The new statement keeps the true part and adds the change, so canon still says what was true then: "The transfer was set for 8 a.m.; it was later put on hold." Never retcon a true fact into a statement that erases it.
- The canon-auditor lists a later development as one retcon item, the same as a correction.

## What belongs in a proposal
Only what the prose shows or states as true: names, places, objects, relationships, abilities, injuries, deaths, world rules, secrets revealed, events later scenes could depend on, and who learned which fact. Not the plan's intent, not a character's mistaken belief (that is a knowledge question), not the reader's guesses.

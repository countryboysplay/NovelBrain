---
name: scene-context
description: Use when drafting or reviewing one scene, to know exactly which files to read for it (plan, POV knowledge, relevant facts, the previous scene's ending, the next plan) and what never to read.
---

# Scene context

A scene is written and judged from a small, chosen set of files, never from the whole book. Read only what this list names for the scene id you were given.

## Read
1. The scene plan, `outline/scenes/SC-###.yaml`: goal, pov, location, storyTime, beats, arcBeats, mustReveal and status.
2. `outline/outline.yaml`, only to find the previous and next scene ids in outline order and which chapter this scene is in.
3. The POV character's knowledge: every entry in `canon/knowledge.yaml` whose `character` is the plan's `pov`, and the statement of each fact those entries point to in `canon/facts.yaml`.
4. The facts the scene depends on: every fact in the plan's `mustReveal`, and every fact the previous two scenes' proposals or accepted canon introduced (facts in `canon/facts.yaml` whose `source` is either of the two previous scene ids). Follow a `supersedes` link only to learn that the old fact is history.
5. The bible files for the POV character, every other character in `arcBeats` or the beats, and the plan's location.
6. The previous scene's ending: the last 300 words or so of `manuscript/<previous scene id>.md`. Read the file with an offset near its end rather than all of it when it is long. If the previous scene is not accepted yet, skip this.
7. The next scene's plan, `outline/scenes/<next scene id>.yaml`, so this scene hands on what the next one needs.
8. `canon/timeline.yaml` events near the plan's storyTime, to place the scene in time.
9. If `book.yaml` has a `predecessor`, the earlier book's `../<predecessor>/canon/` is read-only reference for what already happened; never write to it and never treat it as this book's canon.

## Never read
- The whole manuscript, or any accepted scene other than the previous one's ending (a revision may read its own accepted text when the showrunner says so).
- Other scenes' drafts in `drafts/`.
- `proposals/`, unless your role is to write or audit this scene's proposal.
- Other reviewers' files, unless your role is to check them.

## Why
Each step starts with an empty context. Reading only what the scene needs keeps attention on the scene and keeps canon, plans and prose apart: the plan is intent, canon is truth, the previous scene's prose is how the reader last left the story.

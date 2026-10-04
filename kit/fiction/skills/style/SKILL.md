---
name: style
description: Use when writing or judging this book's prose, to find which voice and language rules apply, either the book's own style guide if it has one, otherwise the audience skill's language and POV rules.
---

# Style

1. If `bible/world/style.md` exists, Read it. It is the book's style guide and the first authority on voice, tense, POV, sentence rhythm, dialogue punctuation, vocabulary and any deliberate departures from common advice. It overrides the craft skills and the writing-sucks checks wherever they disagree.
2. If it does not exist, Read `book.yaml`, then Read `.claude/skills/audience-<audience>/SKILL.md`, where `<audience>` is the `audience` value in `book.yaml`, and follow its LANG and POV rules for language level, sentence and paragraph length, vocabulary, POV and tense.
3. In either case, every character speaks in the voice their bible file gives them (`bible/characters/CHAR-*.md`, the `voice` field). A character's voice is a deliberate choice, not an error.
4. Keep one tense and one POV mode across the book: follow the style guide, or the tense and POV of the accepted scenes when the guide is silent.
5. Never invent a style rule. When neither the style guide nor the audience skill settles a choice, follow what the accepted scenes already do.

---
name: style
description: Use when writing or judging this book's prose, to find the voice rules (the book's voice sheet, bible/world/style.md) and what applies while it does not exist yet; the story architect uses it to write that sheet.
---

# Style

1. `bible/world/style.md` is the book's voice sheet. Read it before you write or judge a line of prose. It is the first authority on voice, tense, POV, sentence rhythm, dialogue punctuation, vocabulary and any deliberate departure from common advice. It overrides the craft skills and the writing-sucks checks wherever they disagree. It never overrides an audience content limit (a CON rule).
2. If it does not exist yet (a book begun before the sheet was required), Read `book.yaml`, then Read `.claude/skills/audience-<audience>/SKILL.md`, where `<audience>` is the `audience` value in `book.yaml`, follow its LANG and POV rules for language level, sentence and paragraph length, vocabulary, POV and tense, and follow what the accepted scenes already do. The showrunner has the story architect write the sheet before the next scene is drafted.
3. In either case, every character speaks in the voice their bible file gives them (`bible/characters/CHAR-*.md`, the `voice` field). A character's voice is a deliberate choice, not an error.
4. Keep one tense and one POV mode across the book: follow the voice sheet, or the tense and POV of the accepted scenes when the sheet is silent.
5. Never invent a style rule. When neither the voice sheet nor the audience skill settles a choice, follow what the accepted scenes already do.

## The voice sheet
The story architect writes `bible/world/style.md` as a Markdown file with these nine sections as `## ` headings, in this order, each followed by content. Only Banned may say `None.`

### Narrator
One paragraph: who tells the story, from how close, in which person and tense, and with what attitude to the people in it.

### Diction and register
The words this narrator reaches for and the ones it never uses: plain or ornate, period or modern, regional, clean or profane. Three to six example words or phrases it would use.

### Rhythm
Sentence and paragraph targets as numbers inside the audience skill's LANG range (for example "most sentences 8 to 18 words; one long sentence a page at most; paragraphs of one to four sentences"), and how the rhythm changes for action, dialogue and reflection.

### Figurative language
A budget (for example "at most one simile or metaphor per 300 words") and the image families this book draws on, taken from its viewpoint characters' work, place and history (a farming book draws on weather, soil and machinery). Every comparison comes from what the viewpoint character knows.

### Humour and attitude
What the narrator finds funny, if anything, and how it shows (dry understatement, banter, none), and what it takes seriously.

### Interiority and emotion
How thought is rendered (italics, free indirect, tagged) and how emotion reaches the page: through action and the body, through what the character notices, or named outright, and how often a feeling may be named.

### The narrator never
Five or more concrete rules for this voice, each starting "Never" (for example "Never names a feeling the scene has already shown", "Never ends a scene on a summary of what it meant", "Never explains a joke").

### Banned
Words and phrases this book never uses: its own clichés and the tics its reviews keep catching. `None.` until there are some.

### Samples
Two or three paragraphs of 80 to 150 words in this voice, each from a different kind of moment (action, dialogue, quiet). When scenes are accepted, quote them from `manuscript/`: the voice already on the page is the voice. Otherwise write them new, and when you work with the writer in the terminal, show them and change them until the writer agrees.

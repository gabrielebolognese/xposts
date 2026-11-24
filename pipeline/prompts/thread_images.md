# Stage: thread_images

You draw the images of one X thread: exactly one image for every part, the main post and each reply. Each image is a DIAGRAM that explains its part: cards with the text inside them, joined by arrows. It is shown right under its part's text, 4:5 portrait, about 380 pixels wide on a phone.

The tool: {{TOOL}}. The thread has {{TOTAL}} parts, numbered 0 to {{MAX_PART}} (part 0 is the main post).

## The thread

{{PARTS}}

Numbers in the thread and the fact each comes from:
{{NUMBERS}}

## The owner's style (strict)

- White background, black only. No colour anywhere: no accent, no coloured text, borders or fills. Black text, black borders, black arrows.
- Every image is a diagram of cards and arrows. Every word sits inside a card, or is a short label on an arrow. Nothing else on the page: no title above the diagram, no headline, no caption outside a card.
- Zero decorative text: no kickers, taglines, slogans, labels like "THE CATCH" or "BONUS", no handle, no part numbers, no category. Every word must explain something.
- Zero decorative graphics: no icons, no emojis, no glows, shadows, gradients, background shapes, dots or ornaments. Only cards, arrows and the words inside them.
- Different fonts with different jobs, already set up as classes: `t` (a bold sans, the card's title), `b` (a serif, what the card says), `c` (a mono, commands, code, file names, ports), `n` (a big bold number inside a card). A card usually has a `t` and a `b`, or a `c`.

## How you write it

You write only the body, the HTML of the diagram. The page is 1080x1350 with 72 pixel margins, so the diagram has 936 x 1206 pixels. It must FILL the page: from its top card to its bottom card at least 70% of that height (about 850 pixels), with no big empty band; a 3-card diagram is too small, use 4 to 7 cards or bigger ones. Code renders it and sends back anything that spills over, overlaps, sits outside a card or fills too little. Use only these classes, with no style attributes (sizes, spacing and long commands are handled by code):
- `<div class="card">` a card: a black rounded border with its text inside; `card bold` (a thicker border) for the one card the part is about; `card dashed` for something optional or outside the tool
- inside a card: `<div class="t">Title</div>`, `<div class="b">What it says</div>`, `<div class="c">npm install x</div>`, `<div class="n">64.3<small>%</small></div>`, or a short `<ul>` / `<ol>` list
- `<div class="col">` cards and arrows top to bottom; `<div class="row">` left to right (2 or 3 cards across at most, they share the width)
- arrows between cards: `<div class="arrow down"></div>` in a column, `<div class="arrow right"></div>` in a row (also `up`, `left`); a short label inside, `<div class="arrow down"><span>sends</span></div>`, says what flows along it
- branching and merging: between one card and a row of N cards, put `<div class="arrows">` holding N arrows (`<div class="arrows"><div class="arrow down"></div><div class="arrow down"></div></div>`), so each arrow lands on (or leaves from) its own card. A single arrow next to a row of cards points into the gap between them: never do that
- `<div class="grid2">` two columns of cards; `<div class="gap"></div>` a space
- nest freely: a row of cards inside a column, a column inside a row, so arrows can branch (one card on top, an arrow down to a row of 3 cards)
- for a shape rows and columns cannot draw, an inline `<svg>` with black strokes, white fills, arrowheads drawn as black polygons, and text of 28px or more; its words still go inside drawn boxes

Ideas for diagrams (pick what explains the part, vary them across the thread):
- a flow: input card, arrow, the tool's card (bold), arrow, result card
- before and after: two cards side by side, an arrow from the old way to the new one, each with its numbers
- a hub: one card on top, arrows down to the 3 or 4 things it connects to
- steps: command cards in a column joined by arrows, each card a `t` saying what the step does and a `c` with the exact command from the text
- a number that matters: a card with an `n` and a `b` saying what it measures, with arrows to the cards that explain it

The main post (part 0): the thread's core in one diagram, built around its most important fact. The last part (the setup guide): the steps, with the exact commands from the text.

## The GitHub screenshot

{{REPO}}

When the tool has a repository, exactly ONE part (the reply that introduces the tool) is `kind` `github`: its diagram includes the real screenshot of the GitHub page as one of its cards. Write `<div class="card shot">[[SCREENSHOT]]<div class="t small">owner/repo</div></div>` where it belongs in the diagram (code puts the screenshot where [[SCREENSHOT]] is, in grey). Give that card the full width of the image, never in a row beside another card, so the page stays readable, and join it with arrows to the cards around it (for example: the screenshot card, an arrow down, a card with what it is, a row of what it offers). Every other part is `kind` `card` and has no [[SCREENSHOT]].

## Rules for the words

- Only what the part's text says. Every number in a diagram must appear in the thread or the facts below, written the same way. Never invent a figure, a name, a feature or a result.
- Short: card titles of 1 to 5 words, card text of at most 15 words, about 20 to 50 words per image, never more than {{WORDS}}. Big readable text beats more text.
- No em dashes, no en dashes, no emojis, no web addresses (owner/repo names are fine), no hashtags.

## Background

The tool, as analysed:
{{BRIEF}}

The facts (the only source for anything that is not in the thread):
{{FACTS}}

## Answer

Only the JSON object of the schema: `parts`, one entry for EVERY part 0 to {{MAX_PART}}, each with `part`, `kind` (`card`, or `github` for the one screenshot part), `layout` (what the diagram is: `flow`, `before_after`, `hub`, `steps`, `number`, `screenshot`) and `body_html`.

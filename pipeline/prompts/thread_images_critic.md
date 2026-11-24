# Stage: thread_images_critic

You review the images of one X thread before they are posted. Each image goes right under its part's text, 4:5 portrait, seen about 380 pixels wide on a phone while scrolling. Open every image file below with the Read tool and look at it.

{{IMAGES}}

The owner's style, which every image must follow exactly:
- a white background and black only: no colour anywhere
- a diagram: cards with the text inside them, joined by arrows that make sense (they show what flows, leads to or connects to what)
- every word inside a card or on an arrow; nothing decorative: no kickers, taglines, labels, titles above the diagram, icons, shadows or ornaments
- different fonts with different jobs: a bold sans for card titles, a serif for card text, a mono for commands
- a GitHub screenshot, when there is one, is a card inside the diagram with arrows to the rest, as wide as the image so it can be read (not squeezed beside another card). It is a real capture, greyed on purpose: its own figures (stars, forks, issues) are real, not invented, and it cannot be cropped or recoloured, so judge only its size and its place in the diagram

Score each image from 1 to 10. {{MIN}} or more means it can be posted as it is. Judge:
- style: everything above holds; any colour or decoration is a major issue
- readable: every word reads at phone size; nothing tiny, crowded or cramped (a long command set a little smaller so it stays on one line is intended: do not ask to split it or enlarge it)
- explains: the diagram makes its part easier to understand at a glance, with a clear direction, and it is true to the part's text (no numbers, names or claims the text does not have)
- no defects: nothing overlapping, cut off, spilling over a card, misaligned, empty or broken; arrows start and end at cards and point the right way; no big empty half of the image

For every image under {{MIN}}, list the concrete issues and how to fix each one ("the arrow points from the result back to the input: reverse it", "the bottom card has 30 words: cut it to 12"). Never invent issues to look thorough: a good image gets a high score and no issues.

## Answer

Only the JSON object of the schema: `parts`, one entry per image, each with `part` (the part number given above), `score` and `issues` (empty when there are none).

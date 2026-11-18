# Stage: article_cover

Design the cover image of an X Article as one self-contained HTML file. It is rendered at exactly {{WIDTH}} x {{HEIGHT}} pixels (2x for sharpness) and exported as a PNG.

The article: "{{TITLE}}" ({{PILLAR_NAME}}).
The cover text: "{{COVER_TEXT}}"
What it is about:
{{GIST}}

## What makes it work

- It is seen as a small card in the timeline, about 500 pixels wide on a phone. The cover text must be readable there: at least 96 px, heavy weight, at most 2 lines, very high contrast with its background.
- One strong visual next to or behind the text, built with CSS or inline SVG, that fits this subject: for example a chart drawn from the article's real numbers, a terminal window with a real command, a ranked bar list, a pipeline diagram, a cost receipt. Real numbers only, from the article.
- Colours and mood chosen for this subject, not a generic template. Dark or light, whatever fits.
- Keep everything important at least 60 px from the edges.

## Hard rules

- Exactly the cover text as given (you may set one or two of its words in a different colour). No other text longer than a few words, no paragraphs.
- Self-contained: no network requests of any kind. No web fonts, no image URLs, no scripts. Use system fonts: "Segoe UI", "Segoe UI Black", Arial, "Arial Black", Impact, Georgia, Consolas.
- html and body: margin 0, width {{WIDTH}}px, height {{HEIGHT}}px, overflow hidden. Nothing may spill outside the frame or be cut off.
- No logos of real companies or products, no faces, no emojis, no em dashes.

{{FIX}}

## Answer

Only the JSON object of the schema: html (the complete file, starting with <!doctype html>).

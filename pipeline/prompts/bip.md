You write today's build-in-public post for X, in the owner's own voice ("I" and "me" are fine). The owner builds Claude Studio, a daily series: every night Claude Code builds one edge-pushing project on its own, and a recording of it is posted. The post covers the owner's whole day, not only Claude Studio.

Today is {{DATE}}, day {{DAY}}. The code assembles the post in this order and writes the fixed lines itself:

1. hook (you)
2. "This is day {{DAY}} of building Claude Studio in public." (fixed)
3. "{{LABEL}}" followed by your studio sentence
4. "On X today: ... replies written and ... views." (fixed, the owner's numbers)
5. done (you)
6. "See you on day ..." and the goals not reached yet (fixed)

Write the three parts:

- hook: ONE sentence about BUILDING today: how building with Claude went (what it proved it can do, speed, limits, time, budget, a surprise in the process). Never about what was built (no chess, no simulation subject). The tone to aim for: "Today Claude Opus 5.5 proved to be EXTREMELY capable even with tight time and budget." One word in capitals for emphasis is fine. No question, no clickbait. Do not repeat these recent first lines:
{{RECENT}}
- studio: ONE sentence saying what the Claude Studio project is, from the Claude Studio notes. It goes right after "{{LABEL}} ", so start in lowercase with the thing itself, for example "a chess engine written from scratch that replays the Game of the Century on 8 parallel workers." Together with the label it must stay within 150 characters.
- done: what got done today across all projects, from the brief below. This is the richest part of the post: the brief is a dry list of lines; turn it into a rich, readable post, not an article. Start with the building itself (what was built, fixed, shipped), then the rest. Alternate the forms: a single sentence, then a short list, then a short paragraph, and so on. Keep the most interesting things, merge the small ones, cut the dull ones.

Format rules, for every part:
- Every sentence at most 150 characters. Prefer short ones.
- List lines start with "- " and have at most 60 characters after the dash.
- In done: at most 3 paragraphs (a paragraph is a line of 2 or more sentences), at least one list, and at least one line that is not a list. Separate blocks with one empty line.
- Plain text: X shows no markdown. No **, no #, no backticks, no links, no hashtags, no emojis, no em dashes or en dashes.
- Only facts from the notes below: no invented numbers or events.
- The whole post, fixed lines included, should land around 1,200 to 2,200 characters.

Claude Studio notes:
{{STUDIO}}

Today's brief (what got done in the last 24 hours, since the previous build-in-public post, from the owner's dashboard):
{{BRIEF}}

# Claude Studio: the post

Write today's X post for Claude Studio, the daily series "pushing Claude to the edge". It goes out with the screen recording of the project. It is ONE long post with the structure of a thread: a hook, a promise line, then numbered sections (code puts "1. ", "2. " in front, so do not number them yourself).

- hook: one line, at most 100 characters. The most important text: make people stop on the video. Concrete and specific (what was built, by which model, in how long or for how much), no hype words, no clickbait.
- promise: one line that says what the post delivers, at most 120 characters.
- sections: 4 to 6, each 150 to 400 characters, one distinct piece of information each:
  - what this is and what is really simulated (the science, in plain words)
  - how it was built: the model, the time, the build cost, the lines of code, the review rounds
  - the real numbers from the run (the headline numbers, the live frame rate, the PC it ran on)
  - what made it hard, and where the model struggled or had to simplify (from the notes)
  - the last section is actionable: how a reader can push Claude Code the same way (the approach and the exact kind of instructions that worked), so they can try it tonight
- The whole post at most 2,400 characters.
- The build cost must appear exactly as {{COST}}, and the model as {{MODEL}}.
- Every number must come from the facts below. Never invent or round up a number.
- Plain text only: no links or web addresses, no emojis, no em dashes, no hashtags, no asterisks or backticks.
- Write like a technically sharp person sharing something genuinely impressive: short sentences, natural wording, no corporate language, no "game changer", no "in today's world".
{{RETRY}}
## Facts (the only source of numbers)
{{FACTS}}

## The builder's notes
{{NOTES}}

Answer with the JSON object only.

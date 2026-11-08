# Stage: write

Write the body of a long-form X post. The full rulebook is below; follow it exactly. First pick the strongest hook pair from the candidates (hook_index, counting from 0); the hook lines are added above your body by code, so the body starts with the first paragraph after the hook.

Tell it as the rulebook's problem-solution arc: open with the problem and why it matters, explain the cause, give the steps that solve it, then the takeaway. Use only the facts the reader needs for that arc; leave the rest out, so the post teaches one thing well instead of listing everything the research found.

Body rules (the hook adds about 60 to 100 characters, so aim the body at 1,100 to 2,100):
- paragraphs of 100 to 180 characters, never over 250, one idea each, separated by one empty line
- numbered lists (1. 2. 3.) for steps, bullet lists (- ) for trade-offs, one item per line
- plain text only: X shows markdown literally, so no asterisks, no backticks, no headings with #. Use CAPS for emphasis very sparingly.
- zero emojis, no em dashes, no ellipses, at most one exclamation mark, straight quotes (" and ') only
- no generic openings ("In today's world", "Have you ever wondered", "Here's why"), no filler, no repeated points
- every factual claim and every number must come from the facts below; no invented benchmarks or statistics
- no links: no URLs and no web addresses such as example.com, because X turns them into links and links cut the post's reach. Name the tool, site or source in words instead.
- code: only short lines from the outline's code list, written exactly as they ran
- finish with a takeaway that reinforces the reader contract; no forced engagement question

Also return:
- snippets: every piece of code in the body, verbatim, with the check id that ran it
- numbers: every number in the body (except list markers), verbatim, with the fact id it comes from

Reader contract: {{CONTRACT}}

Hook candidates (JSON):
{{HOOKS}}

Outline:
{{OUTLINE}}

Facts:
{{FACTS}}

The rulebook:
{{RULEBOOK}}

Answer with the JSON object only.

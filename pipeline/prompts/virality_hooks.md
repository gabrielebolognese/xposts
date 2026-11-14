# Stage: virality_hooks

This X thread scored {{SCORE}} out of 100 for virality, below 80. Improve its hook before the discovery is rejected. Write up to {{COUNT}} alternative hooks, one per angle:
1. financial savings
2. free alternative
3. recognizable brand
4. hidden feature
5. unexpected capability
6. time savings
7. problem elimination
8. curiosity
9. technical advantage
10. underrated discovery

Skip an angle the facts cannot honestly support. Do not change the actual discovery and do not invent functionality to get a higher score: if the discovery has no strong hook, return fewer alternatives rather than manufacturing one.

Rules for every alternative:
- one line, at most 180 characters, and it must fit before the promise line "{{PROMISE}}" within 280 characters
- every number from the facts, with the ids of those facts in fact_ids
- no links or web addresses, no emojis, no em dashes, no asterisks or backticks

The evaluator said:
- weaknesses: {{WEAKNESSES}}
- recommended improvement: {{IMPROVEMENT}}

Current hook: {{HOOK}}

The thread (parts separated by #--#; the first part is the main post):
{{POST}}

The analysis:
{{ANALYSIS}}

Facts:
{{FACTS}}

The rulebook:
{{RULEBOOK}}

Answer with the JSON object only.

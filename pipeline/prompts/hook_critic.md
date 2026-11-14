# Stage: hook_critic

You are a demanding editor choosing the hook for an X thread about a discovered tool. The hook decides whether anyone reads the thread, and it must never promise more than the tool delivers.

1. Score every candidate below from 0 to 3 on:
   - accuracy: it matches what the tool really does according to the facts, with nothing inflated (anything below 3 is a serious problem)
   - concreteness: a specific benefit, problem or expense, not a vague claim
   - curiosity: a reader wants to open the thread
   - clarity: understood at a glance on a phone
   - originality: it does not read like a stock template or like AI-generated copy
   Add a short note per candidate.
2. Write 3 improved hooks: take the strongest candidates and make them sharper, more concrete and more accurate. Same rules: one line, at most 180 characters, numbers only from the facts (list their ids in fact_ids), no links or web addresses, no emojis, no em dashes, no asterisks or backticks. In based_on, give the index of the candidate each one improves.
3. In best, pick the strongest of your 3 improved hooks (0, 1 or 2).

Candidates (JSON, index = position from 0):
{{CANDIDATES}}

The analysis:
{{ANALYSIS}}

Facts:
{{FACTS}}

Answer with the JSON object only.

# Stage: hook_score

Score each hook below from 0 to 100 for scroll-stopping power, as the opening line of an X thread that a reader sees in the feed. Reward: an immediate benefit, curiosity, a recognizable subject, a specific promise, value understood in a few seconds, and strong combinations (savings with a recognizable brand, a credible free replacement for an expensive product, a popular tool with a hidden feature). Penalize generic hooks that only announce a topic, engagement bait, and anything the facts do not support. The owner's rule: a hook opens with the reader, a second-person call-out of what they do wrong or overpay for ("You're wasting way too many Claude Code credits") or the outcome they want ("Getting viral on X...", "Running Codex on Claude..."); a hook that opens with the tool's name or a bare statistic scores at most 50.

Set accurate to false for any hook that misrepresents what the tool does, invents functionality, or uses a number or price the facts do not support: an inaccurate hook can never be used, whatever its score. Add a short note per hook.

Each hook is followed in the main post by this promise line: {{PROMISE}}

Hooks (JSON, index = position from 0):
{{HOOKS}}

The replies of the thread (context):
{{REPLIES}}

The analysis:
{{ANALYSIS}}

Facts:
{{FACTS}}

Answer with the JSON object only.

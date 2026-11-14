# Stage: virality

You predict how well an X thread will perform. Do not judge only how informative it is: judge how likely someone is to stop scrolling, open the thread, read it, interact with it and share it, with particular weight on the opening post (the hook). The goal is impressions, reposts, bookmarks, replies, profile visits, new followers and meaningful engagement. The account shares problem-solving discoveries: free tools, open-source repositories, money-saving alternatives, AI tools, developer utilities and useful technology.

1. Score the full thread on these criteria (maximum points in brackets):
   - financial [20]: money saved: avoiding expensive subscriptions, replacing paid software with free alternatives, cutting API or token costs, avoiding purchases, getting expensive functionality without paying. The more substantial and believable, the higher. Large percentages and figures ("save 90%", "save $200 per month") strengthen it only when the facts support them; a verified 90% beats an unsupported 90%, and unsupported savings get no points.
   - brand [15]: a product or company the reader recognizes at once (Claude, ChatGPT, OpenAI, Cursor, GitHub, Google, Microsoft, Adobe, NVIDIA, Midjourney, Notion, Figma, Premiere Pro, After Effects and similar), only when it is genuinely relevant. Highest when the brand meets a surprising discovery, a measurable saving or an unexpected capability.
   - hook [20]: the scroll-stopping power of the opening post: an immediate benefit, curiosity, a recognizable subject, a reason to open the replies, a specific promise, value understood in a few seconds. Combining several triggers scores higher. Generic hooks ("5 useful tools", "check out this repository", "some interesting AI discoveries") score low: the hook must sell the value, not announce the topic.
   - curiosity [10]: the information gap (a hidden feature, an unknown repository, an unexpected alternative, a surprising capability, a shortcut, something people pay for unnecessarily) that the thread really resolves. Empty clickbait gets nothing.
   - problem [10]: how important, recognizable and widespread the problem is (expensive AI usage, repetitive manual work, slow editing, expensive subscriptions, hard workflows) versus a minor convenience.
   - shareability [10]: would readers send it to a friend, share it with colleagues, save it, keep the repository for later?
   - audience [5]: how many people could reasonably benefit. Do not penalize a niche automatically: a very compelling niche solution can still perform.
   - delivery [5]: do the replies fulfill the hook: what the tool does, clear benefits, practical instructions, concrete examples, every reply adding value, an understandable access instruction, no filler?
2. Bonuses: combination [0 to 8] (free + popular brand, savings + a large verified percentage, popular tool + hidden feature, unknown repository + major practical benefit, expensive product + credible free replacement, AI tool + time savings, popular problem + unusually simple solution); recognition [0 to 3] (a product or problem readers instantly understand); novelty [0 to 3] (genuinely surprising and not widely discussed; never above usefulness).
3. Penalties, with points inside the range: misleading_financial [10 to 30] (completely free when restricted, savings without evidence, unrelated price comparisons, invented reductions); weak_hook [5 to 15] (no clear benefit, no recognizable problem, no curiosity, vague); overused [3 to 10] (covered extensively, no new angle; an established tool with a genuinely surprising discovery is not overused); weak_delivery [5 to 15] (fails to explain the tool, repeats, filler, promises more than it delivers, no useful instructions); unverified [10 to 25] (unsupported features, wrong pricing, outdated information, exaggerated capabilities); engagement_bait [3 to 10]. Never count the same weakness twice.
4. hook_score, 0 to 100: the opening post (hook line and promise line) alone, as if it were all a reader sees in the feed, judged with the same criteria and penalties.
5. Also give: a short internal title; the labels (financial_value low, medium, high or exceptional; brand_recognition, curiosity, problem_solving and shareability low, medium or high; evidence_confidence high, medium or low); the main strengths; the main weaknesses; one specific recommended improvement.

A credible thread with a strong financial benefit, a recognizable product and practical value should generally outrank a generic curiosity post. Do not reward aggressive hooks the facts do not support: the winning thread combines an irresistible but accurate hook with a discovery people genuinely want to use.

The thread (parts separated by #--#; the first part is the main post, each next one a reply):
{{POST}}

The analysis:
{{ANALYSIS}}

Facts:
{{FACTS}}

Answer with the JSON object only.

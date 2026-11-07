---
name: x-long-form-posts
description: "Rulebook for the new style of long-form X posts (SaaS, web apps, AI, software development, product design, video editing, content creation). Use whenever writing, drafting, editing or reviewing long-form or new-style posts for this autoposter, and before scheduling a posts file of them."
---

# How to use this rulebook

1. Write every post by the rules below.
2. Put the posts in one .md or .txt posts file, separated by a line with only `#--#` (the format the scheduler already uses).
3. Run `node .claude/skills/x-long-form-posts/check.mjs <posts file>` and fix every problem it reports. It checks the measurable rules: length, paragraph length, hook case, uppercase hook length, emojis, em dashes, markdown symbols.
4. Go through the checklist in section 14 by hand for the rest.
5. Show the posts to the user and schedule them only after they approve.

## How the rules apply in this autoposter

- Hook layout: sentence 1 on the first line, sentence 2 on the second line, then an empty line before the body.
- X shows posts sent through the API as plain text. It does not render markdown, so `**bold**`, `*italics*` and backticks would appear as literal symbols. Bold, italics and code formatting count as "not supported" (sections 2 and 7): use selective CAPS for emphasis, write commands and identifiers as plain text, and put longer code in an image (section 12).
- Lists: numbered items as `1.`, bullets as `-`, one item per line.
- Posts over 280 characters only go through if the posting account has X Premium. The scheduler's orange "over 280 characters" warning is expected for these posts.

---

# X LONG-FORM POST WRITING STANDARD

Editorial specification

## PURPOSE

Create high-quality, information-dense X posts for the SaaS, web apps, AI, software development, product design, video editing, and content creation niches.

The goal is to teach something useful, solve a problem, explain a concept, reveal an opportunity, or help readers make better decisions. Posts should feel like clear, well-structured technical articles adapted to X.

## CORE PRINCIPLE

Value first. Problem first. Explanation second.

Do not optimize for length alone. Optimize for complete explanations, information density, readability, accuracy, and practical usefulness.

## 1. POST LENGTH

- Every standard long-form post must contain between 800 and 3,000 characters.
- Count the entire post, including the hook, spaces, punctuation, and line breaks.
- Recommended target: 1,200 to 2,200 characters.
- Do not add filler to reach 800 characters.
- Do not remove useful information merely to make a post shorter.
- If an idea cannot support a meaningful explanation of at least 800 characters, choose a more substantial angle or do not use the long-form format.

## 2. TWO-SENTENCE HOOK STRUCTURE

The hook has two sentences, in this exact order.

Sentence 1: audience targeting.
- Always write this sentence in lowercase.
- Identify the audience, situation, or specific topic.
- Keep it natural, direct, and recognizable.
- Examples: “claude coders”, “next.js developers”, “saas founders”, “people building their first web app”, “developers using cursor”, “video editors working with ai”.
- Do not use CAPS in this sentence.
- Do not begin with a generic introduction.
- Aim to establish relevance within the first 100 characters of the post.

Sentence 2: attention grabber.
- This sentence gives the reader a concrete reason to continue.
- It may be lowercase or uppercase.
- If the sentence is uppercase, it must contain no more than 50 characters.
- It should communicate a specific benefit, insight, problem, warning, or opportunity.
- It may emphasize one word with asterisks where supported.
- It must not promise something the post does not deliver.
- Do not use clickbait.

Hook examples:

```
next.js developers
claude is far stronger than you think with this skill.
```

```
saas founders
YOU NEED THIS NEW FREE TOOL
```

```
developers building saas products
YOUR DATABASE DESIGN IS PROBABLY WRONG.
```

```
people building with ai
this workflow can save hours of repetitive work.
```

```
solo developers
STOP BUILDING FEATURES NOBODY ASKED FOR.
```

The first sentence identifies who should read. The second sentence gives them a reason to continue. Never reverse this order.

## 3. FIRST 100 CHARACTERS

- Treat the first 100 characters as high-priority space.
- Establish audience relevance immediately.
- Keep the first sentence lowercase.
- Follow it with the attention-grabbing second sentence.
- Do not waste the opening on self-introductions, generic context, disclaimers, or vague claims.
- Make the reader recognize the topic or problem quickly.

## 4. PARAGRAPH FORMATTING

- Maximum paragraph length: 250 characters.
- Recommended paragraph length: 100 to 180 characters.
- Prefer one to three sentences per paragraph.
- Separate paragraphs with one empty line.
- Each paragraph should communicate one main idea.
- Do not create bulky text blocks.
- Do not split sentences artificially just to create visual spacing.
- Keep sentences direct and readable.

## 5. DEFAULT PROBLEM-SOLUTION STRUCTURE

Use this as the default structure for educational and technical posts. Adapt it when another structure better serves the subject.

A. Hook: Use the two-sentence hook structure.

B. Introduction: Briefly introduce the problem, opportunity, or question. Explain why it matters. Do not write a long generic introduction.

C. Problem: Identify the specific issue. Explain what goes wrong, who it affects, and what the consequences are. Use concrete scenarios instead of vague statements.

D. Underlying cause or explanation: Explain why the problem happens. Go beyond describing symptoms. Provide technical, product, business, or design reasoning as appropriate.

E. Solution: Give practical steps, techniques, decisions, or a repeatable workflow. Make the advice actionable.

F. Example: When useful, demonstrate the solution with code, a real scenario, a comparison, a screenshot, a diagram, or a workflow.

G. Takeaway: Finish with a useful conclusion, recommendation, warning, or principle the reader can remember.

Not every post needs all seven sections or these exact headings. Tool discoveries, product comparisons, technical tutorials, and industry analysis may require different structures. The problem and the value delivered must still be clear.

## 6. LISTS

Use lists whenever they make multiple pieces of information easier to process.

Use numbered lists for:
- Step-by-step instructions.
- Processes and sequential workflows.
- Priorities and rankings.
- Implementation steps.

Use bullet lists for:
- Features.
- Benefits and disadvantages.
- Trade-offs.
- Recommendations.
- Checklists.
- Technical considerations.

Do not turn every post into a list. Lists are a readability tool, not a substitute for explanation.

## 7. BOLD TEXT AND VISUAL HIERARCHY

Use bold text selectively for:
- Important technical concepts.
- Key conclusions.
- Critical steps.
- Warnings.
- Important distinctions.

Do not bold entire paragraphs. If everything is emphasized, nothing stands out.

Use CAPS selectively:
- The second hook sentence may be uppercase.
- An uppercase hook must be no longer than 50 characters.
- Occasional uppercase emphasis inside the post is acceptable when genuinely useful.
- Never write entire paragraphs in uppercase.

Use italics sparingly. Use code formatting for commands, function names, code, and technical identifiers when the platform supports it.

## 8. EMOJI POLICY: ZERO EMOJIS

- NEVER use emojis in posts.
- The permitted number of emojis per post is zero.
- Do not use emojis in hooks, headings, lists, examples, section labels, conclusions, or calls to action.
- Do not use emojis as bullets, visual markers, decorations, or replacements for words.
- Use plain text, numbered lists, punctuation, and formatting for structure.
- This rule applies to every post, regardless of topic or tone.

## 9. PUNCTUATION AND STYLE

- Never use em dashes.
- Use periods to separate ideas.
- Use colons to introduce lists or explanations.
- Avoid excessive exclamation marks.
- Avoid unnecessary ellipses.
- Keep sentences direct.
- Prefer precise language over hype.
- Avoid generic openings such as “In today’s world”, “Have you ever wondered”, and “Here’s why” when they add no specific value.
- Do not force engagement questions into every post.

## 10. VALUE AND INFORMATION DENSITY

Every post must provide at least one meaningful takeaway.

Prioritize:
- Practical knowledge readers can implement.
- Technical explanations that clarify how something works.
- Problem-solving that identifies a cause and provides a solution.
- Decision-making guidance that helps readers choose between alternatives.
- Original insight supported by reasoning or experience.
- Specific examples, trade-offs, and limitations.

Avoid:
- Generic AI-generated advice.
- Obvious observations.
- Empty motivational statements.
- Repeating the same point in different words.
- Claims without reasoning or evidence.
- Unverified statistics.
- Recommendations without explaining why.
- Technical-sounding language that teaches nothing.
- Filler added to increase character count.

Every paragraph must earn its place. Remove sentences that add length without adding information.

## 11. TECHNICAL ACCURACY

For SaaS, web apps, software development, and AI posts:
- Verify technical claims.
- Use accurate terminology.
- Use current documentation for changing APIs, products, and tools.
- Explain why a technique works.
- Include implementation details when useful.
- Explain limitations and trade-offs.
- Distinguish established best practices from personal preferences.
- Do not invent benchmarks, test results, statistics, or performance improvements.
- Do not present a context-dependent solution as universally correct.

When providing code:
- Check syntax and correctness.
- Keep examples focused.
- Explain what the code does.
- Include relevant security, reliability, and performance considerations.
- Avoid code that is longer than necessary for the point being taught.

## 12. VISUAL CONTENT

Use visuals when they improve understanding. Suitable formats include:
- Screenshots for product and tool demonstrations.
- Diagrams for architecture and workflows.
- Code snippets for implementation.
- Before-and-after comparisons for UX and design improvements.
- Short videos for product demos, editing workflows, and experiments.
- Comparisons for tools, interfaces, and technical approaches.

Do not attach irrelevant stock images or decorative visuals just to make a post look complete. The visual must support the explanation.

## 13. ENDINGS

Finish with a meaningful conclusion. Suitable endings include:
- A practical recommendation.
- A memorable technical principle.
- A final warning.
- A concise summary of the solution.
- A relevant question when discussion genuinely adds value.

Do not force “What do you think?” into every post. Do not use engagement bait. The ending should reinforce the value of the post rather than merely stop.

## 14. FINAL QUALITY-CONTROL CHECKLIST

Before publishing, verify every item:

- [ ] The first sentence is lowercase and identifies the audience or situation.
- [ ] The second sentence is the attention-grabbing hook.
- [ ] If the second sentence is uppercase, it is no longer than 50 characters.
- [ ] The first 100 characters establish relevance immediately.
- [ ] The post contains between 800 and 3,000 characters.
- [ ] Every paragraph is no longer than 250 characters.
- [ ] Paragraphs are separated by empty lines.
- [ ] Each paragraph communicates one main idea.
- [ ] The problem or opportunity is clearly identified.
- [ ] The underlying cause or reasoning is explained.
- [ ] The solution is practical and actionable.
- [ ] Examples, code, or visuals support the explanation when useful.
- [ ] Lists are used where they improve readability.
- [ ] Bold text and CAPS are used selectively.
- [ ] ZERO EMOJIS appear anywhere in the post.
- [ ] Technical information is accurate and verified.
- [ ] There is no filler, repetition, or generic AI language.
- [ ] The conclusion reinforces a useful takeaway.
- [ ] No em dashes are used.

## FINAL EDITORIAL STANDARD

A reader should finish the post with at least one of the following:
- Knowledge they did not have before.
- A technique they can implement.
- A problem they can now identify or solve.
- A better way to evaluate a product, tool, or technical decision.

Ideally, the post delivers more than one.

Do not optimize for long posts. Optimize for complete explanations. A concise, accurate, practical post is better than a longer post padded with repetition.

Every post must justify the reader’s attention.

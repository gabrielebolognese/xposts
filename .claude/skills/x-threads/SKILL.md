---
name: x-threads
description: Rulebook for the auto post threads (tool, repository and free alternative discoveries posted as X threads). Use whenever writing, drafting, editing or reviewing threads for this autoposter.
---

# How to use this rulebook

1. Write every thread by the rules below.
2. Put one thread in a .txt file: the main post first, then each reply, separated by a line with only `#--#`.
3. Run `node .claude/skills/x-threads/check.mjs <thread file>` and fix every problem it reports. It checks the measurable rules: reply count, length of every part, the main post layout, numbering, emojis, em dashes, markdown symbols, links, the access reply.
4. Go through the quality checklist at the end by hand for the rest.

## Format in this autoposter

- The thread is a main post plus 4 to 7 replies. The runner posts the main post, then each reply as an answer to the one before it.
- Main post: the hook on line 1, an empty line, then one short promise line that says what the thread delivers. At most 280 characters in total.
- Replies: 4 to 7, one distinct piece of information each, at most 280 characters including the number. They start with `1.`, `2.`, `3.` in order (the runner adds the numbers).
- The last reply is always the access reply (see "The final reply").
- Zero emojis. No em dashes. No links anywhere in the thread: no URLs and no web addresses such as example.com, because X turns them into links and links cut the post's reach. Name the tool, site or repository in words instead. Writing a repository as owner/name is fine, it is not a link.
- X shows posts sent through the API as plain text, so markdown such as `**bold**` or backticks would appear as literal symbols. Write commands and names as plain text.

## 1. Writing style

Write in a direct, concise, high-value, curiosity-driven style. The first post must be a strong hook that communicates a specific problem, desirable outcome, financial benefit, or useful discovery.

- Avoid generic introductions, unnecessary storytelling, corporate language, exaggerated claims, and obvious AI-generated phrasing.
- Write like a technically knowledgeable person sharing something genuinely useful with their audience.
- Use simple language, short sentences, clean formatting, and natural wording.
- Every reply must deliver a distinct piece of information. Never waste a reply on filler.
- Prioritize practical value over engagement bait.
- The reader should immediately understand what problem the discovery solves and why they should care.
- Keep the main post short and compelling. Put the actual information, explanations, instructions, and resources in the replies.
- End with actionable instructions for finding or accessing the tool, without a clickable link.

## 2. Content direction

The account discovers and shares problem-solving technologies, tools, repositories, software, AI models, free alternatives, and useful resources. The central question behind every thread:

**What problem does this solve, how much time or money does it save, and why should someone know about it?**

Prioritize free tools that replace expensive software, open-source alternatives to paid products, GitHub repositories with practical applications, AI tools and models that solve real problems, tools that reduce API and token costs, automation and productivity software, developer utilities, video editing and content creation resources, tools that eliminate repetitive work, and lesser-known software that provides significant value. Discovery is not limited to AI.

The goal is to share things people can actually use, not to report that something exists. Every thread must have a clear reason to exist; never publish a generic list just because several tools were found.

Accuracy rules:
- Never claim something is free when it only offers a limited trial or a restricted free tier. Describe pricing and free-tier limits exactly.
- Public source code does not mean free for commercial use. Mention the license when it matters.
- Never recommend abandoned, malicious, misleading or fundamentally broken projects.

## 3. The hook (the most important part)

The hook is the most important text in the thread. It must be problem-solving centered: a concrete benefit, a recognizable frustration solved, an unexpected alternative, or an unnecessary expense challenged.

Example directions (inspiration, not templates):
- Free alternatives: "Why pay $200/month for this when there's a free alternative?", "This open-source tool replaces [expensive software].", "You don't need another subscription to do this."
- Money and token savings: "Reduce your AI API bill without sacrificing performance.", "How to make your AI workflow use fewer tokens."
- Hidden resources: "I found a GitHub repository that solves a problem developers constantly face.", "Most people are overlooking this open-source project."
- Time-saving solutions: "Stop doing [repetitive task] manually.", "This turns a 30-minute workflow into a few clicks."
- Technology discoveries: "You can now run [specific functionality] locally.", "A free solution to a problem most developers pay to solve."

Rules:
- Do not build every hook on the same sentence structure. Generate hooks from the actual discovery.
- Use different angles: financial savings, free access, time savings, replacing paid products, eliminating a frustrating task, hidden functionality, better performance, simpler workflows, access to powerful technology, avoiding subscriptions.
- The hook must accurately represent what the tool does. Never invent savings, percentages, performance improvements or capabilities. If a tool cuts token usage by 30%, do not claim 90%. Every number in the hook must come from the verified facts.

## 4. Thread structure

The main post holds the hook and establishes the promise. The replies deliver the information progressively. The recommended order, merged or shortened when the tool does not need a part:

1. Context: the problem, or why the discovery is useful. Short.
2. Introduction: the tool or repository and what it actually does.
3. Main benefits: the most important features and practical advantages.
4. Practical application: a real-world example of how someone can use it.
5. Instructions: how to access, install, configure or use it, when appropriate.
6. Bonus: a useful trick, limitation, alternative or extra application, when relevant.
7. The final reply: access instructions and CTA.

## 5. The final reply

NEVER, UNDER ANY CIRCUMSTANCES, INCLUDE A CLICKABLE URL OR DIRECT LINK IN THE FINAL REPLY. Tell the reader how to find the resource instead, so it is easy to find without a link. Examples:
- "Go to GitHub and search for: [repository name]."
- "Open GitHub, search for [repository name], and look for the official repository."
- "Search Google for: [exact project name]."
- "Find the project by searching [repository owner] / [repository name] on GitHub."
- "Search for [exact tool name] and open its official website."
- "DM me 'TOOL' and I'll send you the repository."
- "Comment 'LINK' if you want me to send you the resource."

The CTA should be natural and relevant. Do not force engagement requests into every thread. A DM or comment CTA means the account owner answers those people by hand.

## 6. Quality checklist

Before a thread is approved:
- [ ] The hook communicates a real benefit.
- [ ] The promise is accurate.
- [ ] The tool actually solves the stated problem.
- [ ] The project is legitimate.
- [ ] Its pricing is correctly described.
- [ ] The claims are supported by evidence.
- [ ] Every reply provides value.
- [ ] There is no unnecessary repetition.
- [ ] The thread is readable on mobile.
- [ ] The final reply has no clickable link.
- [ ] The final reply explains how to find the resource.
- [ ] The thread sounds natural rather than AI-generated.

The thread should make readers think: "I didn't know this existed", "I could save money with this", "This solves a problem I have", "I should bookmark this".

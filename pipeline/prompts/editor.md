# Stage: editor

You are the final quality control for an X thread before it is published. Judge only; do not rewrite. Code publishes the thread only when nothing you report is blocking, so be exact about what blocks.

1. Answer the 12 checks, each with pass true or false and a short note:
   - benefit_real: the hook communicates a real benefit
   - promise_accurate: the promise (hook and promise line) is accurate
   - solves_problem: the tool actually solves the stated problem
   - legitimate: the project is legitimate (official, maintained, not misleading)
   - pricing_correct: pricing is described correctly (a free tier or trial is never called simply "free")
   - claims_supported: every claim and number is supported by the facts
   - every_reply_valuable: every reply delivers a distinct piece of information
   - no_repetition: no reply repeats another
   - mobile_readable: short sentences, clean formatting, easy to read on a phone
   - final_no_link: the final reply has no link or web address
   - final_explains_access: the final reply explains how to find the tool (search instructions, or a DM or comment CTA)
   - sounds_natural: it reads like a knowledgeable person, not like AI-generated copy (the detector report below lists stock terms it found)
2. List the issues: only real problems, each with the check it fails (kind), the quoted text, a concrete fix, blocking true or false, and earlier (see the review note).
   - Always blocking: benefit_real, promise_accurate, solves_problem, legitimate, pricing_correct, claims_supported, final_no_link, final_explains_access.
   - The other checks block only when clearly bad: a reply that is pure filler, a real repeat, a hard-to-read wall of text, phrasing that obviously reads machine-written.
   - Not issues: wording you would phrase differently, a qualifier you would add, style preferences. Never list something that is fine.

Review note: {{RECHECK}}

Detector report (data): {{DETECTOR}}

The thread (parts separated by #--#; the first part is the main post, each next one a reply):
{{POST}}

The analysis:
{{ANALYSIS}}

Facts:
{{FACTS}}

The rulebook:
{{RULEBOOK}}

Answer with the JSON object only.

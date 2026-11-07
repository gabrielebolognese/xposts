# Stage: editor

You are the final editor of a long-form X post. Judge only; do not rewrite. Leave a list empty when there is nothing to report. Code publishes the post only when every list except paragraphs is empty, so report only real problems, each as a concrete instruction.

- paragraphs: the main idea of each paragraph in a few words, in order
- repeats: paragraphs or sentences that repeat an idea already made (name both)
- deletions: the deletion test: quote every sentence whose removal would lose no information
- slop: generic AI phrasing, hype, empty motivational lines, vague claims (quote them). The tool report below lists stock terms a detector found.
- accuracy: claims or numbers not supported by the facts, or stated more strongly than the facts allow
- privacy: private project names, file paths, client names or internal details from the owner's own projects (those must be told as a general lesson)

Detector report (data): {{DETECTOR}}

The post:
{{POST}}

Facts:
{{FACTS}}

Answer with the JSON object only.

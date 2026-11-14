// Checks the measurable rules of the thread rulebook (SKILL.md) for one thread.
// Usage: node .claude/skills/x-threads/check.mjs <thread.txt> [--json]
// The file holds the main post, then each reply, separated by lines with only #--#.
// --json prints {parts, chars, problems} instead of the text report (the auto post pipeline reads it).
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node check.mjs <thread file> [--json]');
  process.exit(2);
}
const json = process.argv.includes('--json');
const parts = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
  .split(/^[ \t]*#--#[ \t]*$/m).map((p) => p.trim()).filter(Boolean);
const len = (s) => [...s].length;
const start = (s) => (len(s) > 50 ? [...s].slice(0, 50).join('') + '...' : s);
const name = (i) => (i === 0 ? 'main post' : `reply ${i}`);
const MIN_REPLIES = 4;
const MAX_REPLIES = 7;
const MAX_CHARS = 280;

function check() {
  const problems = [];
  const [main = '', ...replies] = parts;
  if (replies.length < MIN_REPLIES || replies.length > MAX_REPLIES) {
    problems.push(`${replies.length} replies, needs ${MIN_REPLIES} to ${MAX_REPLIES}`);
  }
  parts.forEach((p, i) => {
    if (len(p) > MAX_CHARS) problems.push(`${name(i)} has ${len(p)} characters, max ${MAX_CHARS}: "${start(p)}"`);
    if (/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(p)) problems.push(`${name(i)} contains an emoji`);
    if (p.includes(String.fromCharCode(0x2014))) problems.push(`${name(i)} contains an em dash`);
    if (/\*\*|`|(^|\s)\*\S/m.test(p)) problems.push(`${name(i)} contains * or \` markdown, X shows it as literal symbols`);
    if (/https?:\/\/|\bwww\./i.test(p)) problems.push(`${name(i)} contains a link`);
  });

  const blocks = main.split(/\n[ \t]*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length !== 2 || blocks.some((b) => b.includes('\n'))) {
    problems.push('main post must be the hook line, an empty line, then one promise line');
  }

  replies.forEach((r, i) => {
    const want = `${i + 1}. `;
    if (!r.startsWith(want)) problems.push(`reply ${i + 1} must start with "${want.trim()}": "${start(r)}"`);
    else if (!r.slice(want.length).trim()) problems.push(`reply ${i + 1} is empty`);
  });
  const last = replies.at(-1) ?? '';
  if (replies.length && !/\b(search|find|look for|look up|dm|comment|message)\b/i.test(last)) {
    problems.push('the last reply must tell readers how to find the tool (search instructions, or a DM or comment CTA)');
  }
  return problems;
}

{
  const problems = check();
  const chars = parts.map(len);
  if (json) console.log(JSON.stringify({ parts: parts.length, chars, problems }));
  else {
    parts.forEach((p, i) => console.log(`${name(i)}: ${chars[i]} characters  ${start(p.split('\n')[0])}`));
    for (const p of problems) console.log(`  - ${p}`);
    console.log(problems.length ? `\n${problems.length} problems to fix` : '\nok');
  }
  process.exitCode = problems.length ? 1 : 0;
}

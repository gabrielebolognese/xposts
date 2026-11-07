// Checks the measurable rules of the long-form rulebook (SKILL.md) for every post in a posts file.
// Usage: node .claude/skills/x-long-form-posts/check.mjs <posts.md or posts.txt>
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node check.mjs <posts file>');
  process.exit(2);
}
const posts = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
  .split(/^[ \t]*#--#[ \t]*$/m).map((p) => p.trim()).filter(Boolean);
const len = (s) => [...s].length;
const start = (s) => (len(s) > 50 ? [...s].slice(0, 50).join('') + '...' : s);
const isItem = (line) => /^\s*(\d+[.)]|-)\s/.test(line);
let bad = 0;

posts.forEach((post, i) => {
  const problems = [];
  const total = len(post);
  if (total < 800 || total > 3000) problems.push(`${total} characters, needs 800 to 3,000`);

  const [audience = '', grabber = ''] = post.split('\n').map((l) => l.trim()).filter(Boolean);
  if (audience !== audience.toLowerCase()) problems.push(`hook line 1 must be lowercase: "${start(audience)}"`);
  if (/\p{L}/u.test(grabber) && grabber === grabber.toUpperCase() && len(grabber) > 50)
    problems.push(`uppercase hook line 2 is ${len(grabber)} characters, max 50`);

  // list items count one by one, the other lines of a block count as one paragraph
  for (const block of post.split(/\n[ \t]*\n/)) {
    const lines = block.split('\n');
    for (const p of [lines.filter((l) => !isItem(l)).join('\n'), ...lines.filter(isItem)]) {
      if (len(p.trim()) > 250) problems.push(`paragraph of ${len(p.trim())} characters, max 250: "${start(p.trim())}"`);
    }
  }

  if (/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(post)) problems.push('contains an emoji');
  if (post.includes(String.fromCharCode(0x2014))) problems.push('contains an em dash');
  if (/\*\*|`|(^|\s)\*\S/m.test(post)) problems.push('contains * or ` markdown, X shows it as literal symbols');

  if (problems.length) bad++;
  console.log(`post ${i + 1} (${start(audience)}): ${problems.length ? 'FIX' : 'ok'}, ${total} characters`);
  for (const p of problems) console.log(`  - ${p}`);
});

console.log(`\n${posts.length} posts, ${bad} to fix`);
process.exitCode = bad ? 1 : 0;

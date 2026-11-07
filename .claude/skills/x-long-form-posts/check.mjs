// Checks the measurable rules of the long-form rulebook (SKILL.md) for every post in a posts file.
// Usage: node .claude/skills/x-long-form-posts/check.mjs <posts.md or posts.txt> [--json]
// --json prints [{post, chars, problems}] instead of the text report (the auto post pipeline reads it).
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node check.mjs <posts file> [--json]');
  process.exit(2);
}
const json = process.argv.includes('--json');
const posts = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
  .split(/^[ \t]*#--#[ \t]*$/m).map((p) => p.trim()).filter(Boolean);
const len = (s) => [...s].length;
const start = (s) => (len(s) > 50 ? [...s].slice(0, 50).join('') + '...' : s);
const isItem = (line) => /^\s*(\d+[.)]|-)\s/.test(line);
const caps = (s) => /\p{L}{2}/u.test(s) && s === s.toUpperCase();
const BANNED = [/^in today'?s (world|fast|digital)/i, /^have you ever wondered/i, /^here'?s why\b/i, /^let'?s dive in/i];

function check(post) {
  const problems = [];
  const total = len(post);
  if (total < 800 || total > 3000) problems.push(`${total} characters, needs 800 to 3,000`);

  const lines = post.split('\n').map((l) => l.trim()).filter(Boolean);
  const [audience = '', grabber = ''] = lines;
  if (audience !== audience.toLowerCase()) problems.push(`hook line 1 must be lowercase: "${start(audience)}"`);
  if (len(audience) >= 100) problems.push('hook line 1 must end within the first 100 characters');
  if (caps(grabber) && len(grabber) > 50) problems.push(`uppercase hook line 2 is ${len(grabber)} characters, max 50`);

  // list items count one by one, the other lines of a block count as one paragraph
  post.split(/\n[ \t]*\n/).forEach((block, b) => {
    const rows = block.split('\n');
    for (const p of [rows.filter((l) => !isItem(l)).join('\n'), ...rows.filter(isItem)]) {
      const t = p.trim();
      if (len(t) > 250) problems.push(`paragraph of ${len(t)} characters, max 250: "${start(t)}"`);
      if (b > 0 && caps(t) && len(t) > 20) problems.push(`paragraph fully in capitals: "${start(t)}"`);
      if (BANNED.some((r) => r.test(t))) problems.push(`generic opening: "${start(t)}"`);
    }
  });

  if (/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(post)) problems.push('contains an emoji');
  if (post.includes(String.fromCharCode(0x2014))) problems.push('contains an em dash');
  if (/\*\*|`|(^|\s)\*\S/m.test(post)) problems.push('contains * or ` markdown, X shows it as literal symbols');
  if ((post.match(/!/g) ?? []).length > 1) problems.push('more than one exclamation mark');
  if (/\.\.\.|…/.test(post)) problems.push('contains an ellipsis');
  return { chars: total, audience, problems };
}

{
  const results = posts.map((p, i) => ({ post: i + 1, ...check(p) }));
  const bad = results.filter((r) => r.problems.length).length;
  if (json) console.log(JSON.stringify(results));
  else {
    for (const r of results) {
      console.log(`post ${r.post} (${start(r.audience)}): ${r.problems.length ? 'FIX' : 'ok'}, ${r.chars} characters`);
      for (const p of r.problems) console.log(`  - ${p}`);
    }
    console.log(`\n${posts.length} posts, ${bad} to fix`);
  }
  process.exitCode = bad ? 1 : 0;
}

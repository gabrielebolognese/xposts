// Live dashboard for the auto threads: npm run dashboard, then http://localhost:3001
// Shows every thread the runner is making or has made (stage, hook, the full thread, virality score, slot) and the
// runner log, refreshed every few seconds. "Post thread now" leaves a request in pipeline/data/post-now/ for the
// runner's posting loop, which posts the thread within about 30 seconds and records it in posted-now.json, so it is
// never scheduled again; nothing else in the schedule changes. This server never posts and never touches git.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

const ROOT = import.meta.dirname;
const PORT = Number(process.env.DASHBOARD_PORT) || 3001; // tests use another port and DASHBOARD_NO_OPEN=1
const ADDRESS = `http://localhost:${PORT}`;
const STAGES = ['analyze', 'score', 'hooks', 'thread', 'inspect', 'virality'];
const BOM = String.fromCharCode(0xfeff);

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(BOM, ''));
  } catch {
    return fallback;
  }
};
const writeJson = (file, data) => {
  const tmp = `${file}.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1) + '\n');
  fs.renameSync(tmp, file);
};

// The same parts the runner puts in queue/: the main post (hook, empty line, promise), then the numbered replies
export const threadParts = (d) => [`${d.hook.trim()}\n\n${d.promise.trim()}`, ...d.replies.map((r, i) => `${i + 1}. ${r.trim()}`)];

function statusOf(st, entry, early, requested) {
  if (early) return 'posted-now';
  if (requested) return 'posting';
  if (STAGES.includes(st.stage)) return 'making';
  if (st.stage === 'ready') return entry?.status ?? 'waiting';
  return st.stage ?? 'making'; // review or dropped
}

// Every run of the thread pipeline, newest first, with what the dashboard shows about it
export function threads(root = ROOT, limit = 80) {
  const pipe = path.join(root, 'pipeline');
  const runsDir = path.join(pipe, 'runs');
  const pool = readJson(path.join(pipe, 'data', 'virality.json'), {});
  const early = new Map(readJson(path.join(pipe, 'data', 'posted-now.json'), []).map((p) => [p.run, p]));
  const requests = path.join(pipe, 'data', 'post-now');
  const names = fs.existsSync(runsDir)
    ? fs.readdirSync(runsDir).filter((n) => fs.existsSync(path.join(runsDir, n, 'discovery.json'))) // old long-form runs have none
    : [];
  return names.sort().reverse().slice(0, limit).map((run) => {
    const dir = path.join(runsDir, run);
    const st = readJson(path.join(dir, 'state.json'), {});
    const disc = readJson(path.join(dir, 'discovery.json'), {});
    const draft = readJson(path.join(dir, 'draft.json'), null);
    const a = readJson(path.join(dir, 'analysis.json'), null);
    const v = readJson(path.join(dir, 'virality.json'), null);
    const entry = pool[run];
    const status = statusOf(st, entry, early.get(run), fs.existsSync(path.join(requests, `${run}.json`)));
    const failed = readJson(path.join(requests, `${run}.failed`), null);
    let updated = 0;
    try {
      updated = fs.statSync(path.join(dir, 'state.json')).mtimeMs;
    } catch {}
    return {
      run, status, stage: st.stage, updated,
      name: a?.project_name || disc.name || run,
      category: disc.category_name || '',
      problem: a?.problem || disc.candidate?.problem || '',
      repo: a?.repo || disc.repo || '',
      pricing: a?.pricing_model || '', license: a?.license || '',
      slot: entry?.status === 'scheduled' ? entry.slot : null,
      postedAt: early.get(run)?.at || (entry?.status === 'posted' ? entry.slot : null),
      score: v?.final ?? null, classification: v?.classification ?? null,
      hookScore: v?.hook_score ?? null, threadScore: v?.thread_score ?? null,
      strengths: v?.strengths || '', weaknesses: v?.weaknesses || '',
      hook: st.hook || null, fixRound: st.fix_round || 0, outcome: st.outcome || '',
      postUrl: early.get(run)?.url || null, postError: failed?.error || null,
      parts: draft?.hook && draft?.promise && Array.isArray(draft.replies) ? threadParts(draft) : null,
    };
  });
}

function logTail(root = ROOT, n = 60) {
  const file = path.join(root, 'pipeline', 'logs', 'runner.log');
  try {
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    return { lines: lines.slice(-n), updated: fs.statSync(file).mtimeMs };
  } catch {
    return { lines: [], updated: 0 };
  }
}

function state() {
  const pipe = path.join(ROOT, 'pipeline');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date());
  const searches = readJson(path.join(pipe, 'data', 'searches.json'), []).filter((s) => s.at?.startsWith(today)).length;
  const pool = Object.values(readJson(path.join(pipe, 'data', 'virality.json'), {}));
  const madeToday = pool.filter((e) => e.created?.startsWith(today)).length;
  const lock = fs.existsSync(path.join(pipe, '.lock'));
  return { now: Date.now(), threads: threads(), log: logTail(), searches, madeToday, lock, poster: poster(), postedNow: postedNow() };
}

// The posting loop's heartbeat: it writes data/poster.json after every round (every 30 seconds)
function poster(root = ROOT) {
  const at = (readJson(path.join(root, 'pipeline', 'data', 'poster.json'), {}).at || 0) * 1000;
  return { at, on: Date.now() - at < 3 * 60000 };
}

function postedNow(root = ROOT) {
  return readJson(path.join(root, 'pipeline', 'data', 'posted-now.json'), []).slice(-8).reverse();
}

export function requestPost(run, root = ROOT) {
  const t = threads(root, 100000).find((x) => x.run === run);
  if (!t?.parts) throw new Error('This run has no finished thread yet.');
  if (['posted', 'posted-now', 'posting'].includes(t.status)) throw new Error('This thread was already posted or is being posted.');
  if (!poster(root).on) throw new Error('The runner is not running, and it does the posting. Start it with: bash pipeline/run.sh');
  const dir = path.join(root, 'pipeline', 'data', 'post-now');
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(path.join(dir, `${run}.failed`), { force: true });
  writeJson(path.join(dir, `${run}.json`), { run, at: new Date().toISOString() });
  return { ok: true };
}

function serve() {
  http
    .createServer(async (req, res) => {
      const json = (body, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(body));
      };
      try {
        if (req.method === 'GET' && req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(fs.readFileSync(path.join(ROOT, 'dashboard.html')));
        }
        if (req.method === 'GET' && req.url === '/api/state') return json(state());
        // JSON only: browsers won't send a cross-origin JSON POST without CORS, so other sites can't press the button
        if (req.method === 'POST' && req.url === '/api/post-now') {
          if (!String(req.headers['content-type']).startsWith('application/json')) return json({ error: 'JSON requests only' }, 415);
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const { run } = JSON.parse(Buffer.concat(chunks).toString());
          if (typeof run !== 'string' || !/^[\w.-]+$/.test(run)) return json({ error: 'bad run name' }, 400);
          return json(requestPost(run));
        }
        if (req.url.startsWith('/api/')) return json({ error: `unknown request ${req.method} ${req.url}` }, 404);
        res.writeHead(404);
        res.end();
      } catch (err) {
        json({ error: err.message }, 500);
      }
    })
    .listen(PORT, 'localhost', () => {
      console.log(`Dashboard running on ${ADDRESS} (Ctrl+C to stop)`);
      if (process.env.DASHBOARD_NO_OPEN) return;
      const open = { win32: 'start ""', darwin: 'open' }[process.platform] ?? 'xdg-open';
      exec(`${open} ${ADDRESS}`);
    });
}

if (path.basename(process.argv[1] ?? '') === 'dashboard.js') serve();

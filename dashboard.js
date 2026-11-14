// Live dashboard for the auto threads: npm run dashboard, then http://localhost:3001
// Shows every thread the runner is making or has made (stage, hook, the full thread, virality score, slot) and the
// runner log, refreshed every few seconds. "Post thread now" starts the post-now GitHub workflow (the X keys live
// only in GitHub secrets, never on this PC) and records the run in pipeline/data/posted-now.json, so the runner never
// schedules that thread again; nothing else in the schedule changes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec, execFile } from 'node:child_process';

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

function statusOf(st, entry, early) {
  if (early) return 'posted-now';
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
    const status = statusOf(st, entry, early.get(run));
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
  return { now: Date.now(), threads: threads(), log: logTail(), searches, madeToday, lock };
}

// DASHBOARD_FAKE_GH=<script.js> (tests) runs that node script instead of the GitHub CLI, so nothing can be posted
function gh(args) {
  const fake = process.env.DASHBOARD_FAKE_GH;
  return new Promise((resolve, reject) => {
    const tryAt = (bins) => execFile(bins[0], fake ? [fake, ...args] : args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err?.code === 'ENOENT' && bins.length > 1) return tryAt(bins.slice(1));
      if (err) return reject(new Error((stderr || err.message).trim().slice(0, 300)));
      resolve(stdout);
    });
    tryAt(fake ? [process.execPath] : ['gh', 'C:/Program Files/GitHub CLI/gh.exe']);
  });
}

const repo = () => readJson(path.join(ROOT, 'pipeline', 'config.json'), {}).repo;

let runsCache = { at: 0, data: [] };
async function postNowRuns() {
  if (Date.now() - runsCache.at > 15000) {
    try {
      const out = await gh(['run', 'list', '-R', repo(), '--workflow', 'post-now.yml', '-L', '8',
        '--json', 'displayTitle,status,conclusion,url,createdAt']);
      runsCache = { at: Date.now(), data: JSON.parse(out) };
    } catch (err) {
      runsCache = { at: Date.now(), data: [], error: err.message };
    }
  }
  return runsCache;
}

async function postNow(run) {
  const t = threads(ROOT, 100000).find((x) => x.run === run);
  if (!t?.parts) throw new Error('This run has no finished thread yet.');
  if (t.status === 'posted' || t.status === 'posted-now') throw new Error('This thread was already posted.');
  const slot = t.status === 'scheduled' ? t.slot : '';
  const thread = Buffer.from(JSON.stringify(t.parts)).toString('base64');
  await gh(['workflow', 'run', 'post-now.yml', '-R', repo(), '-f', `run=${run}`, '-f', `thread=${thread}`, '-f', `slot=${slot}`]);
  const file = path.join(ROOT, 'pipeline', 'data', 'posted-now.json');
  const list = readJson(file, []);
  list.push({ run, at: new Date().toISOString(), slot });
  writeJson(file, list);
  runsCache.at = 0;
  return { ok: true, slot };
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
        if (req.method === 'GET' && req.url === '/api/post-now-runs') return json(await postNowRuns());
        // JSON only: browsers won't send a cross-origin JSON POST without CORS, so other sites can't press the button
        if (req.method === 'POST' && req.url === '/api/post-now') {
          if (!String(req.headers['content-type']).startsWith('application/json')) return json({ error: 'JSON requests only' }, 415);
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const { run } = JSON.parse(Buffer.concat(chunks).toString());
          if (typeof run !== 'string' || !/^[\w.-]+$/.test(run)) return json({ error: 'bad run name' }, 400);
          return json(await postNow(run));
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

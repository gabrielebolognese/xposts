// A real screenshot of a tool's GitHub page for its thread: github.com/<owner>/<repo> in GitHub's narrow, one-column
// layout, logged out, in GitHub's light theme, at 2x, cut down to what says what the repository is (its name, the About
// text, its website and its stars), so it is wide and short and its text stays readable in a thread image. Only
// GitHub's own hosts are allowed.
// Exits 1 when the page did not render (a missing repo, a rate limit, no network).
//   node pipeline/lib/github-shot.mjs owner/repo out.png [width] [height]
import puppeteer from 'puppeteer-core';

const [repo, out, w = '520', h = '900'] = process.argv.slice(2);
const width = Number(w), height = Number(h);
const CHROME = process.env.STUDIO_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ALLOWED = /^https:\/\/([a-z0-9-]+\.)*(github\.com|githubassets\.com|githubusercontent\.com)\//;

if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) {
  console.error('usage: node github-shot.mjs owner/repo out.png [width] [height]');
  process.exit(2);
}
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--hide-scrollbars', '--lang=en-US'],
  defaultViewport: { width, height, deviceScaleFactor: 2 },
});
try {
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  await page.setRequestInterception(true);
  page.on('request', (r) => (ALLOWED.test(r.url()) || r.url().startsWith('data:') ? r.continue() : r.abort()));
  const res = await page.goto(`https://github.com/${repo}`, { waitUntil: 'networkidle2', timeout: 60000 });
  if (!res || res.status() >= 400) throw new Error(`GitHub answered ${res ? res.status() : 'nothing'} for ${repo}`);
  await page.waitForSelector('#readme, article.markdown-body, [data-testid="readme"]', { timeout: 30000 });
  await page.evaluate(() => {
    // banners and prompts that are not the repository: cookie consent, sign-up nudges, the global header
    for (const sel of ['[class*="cookie" i]', '[id*="cookie" i]', '.js-consent-banner', '.signup-prompt',
      '.flash-full', 'header.HeaderMktg', 'header.Header', '.AppHeader', '[data-testid="banner"]']) {
      for (const el of document.querySelectorAll(sel)) el.remove();
    }
    // what is not the repository itself: the tabs, the sign-in buttons, the topic tags, the file and report links
    document.querySelector('header.GlobalNav')?.remove();
    document.querySelector('a[aria-label*="fork a repository" i]')?.closest('ul')?.remove();
    for (const el of document.querySelectorAll('[class*="TopicTagGroup"]')) el.remove();
    for (const a of document.querySelectorAll('a')) {
      if (/^(readme|.*license|contributing|security policy|activity|custom properties|code of conduct|cite this repository|report repository)$/i
        .test(a.textContent.trim())) (a.closest('div.mt-2') || a).remove();
    }
    window.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 1200));
  // from the repository's name to its stars line; else the top, cut at the lowest y (at most height) that does not
  // run through any line of text
  const clip = await page.evaluate((H) => {
    const title = document.querySelector('#repo-title-component');
    const stars = [...document.querySelectorAll('span')].find((e) => /^[\d.,]+k?\s+stars?$/i.test(e.textContent.trim()));
    if (title && stars) {
      const top = Math.max(0, Math.floor(title.getBoundingClientRect().top - 18));
      const bottom = Math.ceil(stars.getBoundingClientRect().bottom + 18);
      if (bottom - top > 120 && bottom <= H) return { y: top, height: bottom - top };
    }
    const report = [...document.querySelectorAll('a, span, button')].find((e) => /^report repository$/i.test(e.textContent.trim()));
    const end = report && report.getBoundingClientRect().bottom + 22;
    if (end && end > 200 && end <= H) return { y: 0, height: Math.ceil(end) };
    const rects = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.height && r.top < H && r.bottom > H * 0.5) rects.push(r);
    }
    for (let y = H; y > H * 0.6; y -= 2) if (!rects.some((r) => r.top - 6 < y && y < r.bottom + 6)) return { y: 0, height: y };
    return { y: 0, height: H };
  }, height);
  await page.screenshot({ path: out, clip: { x: 0, width, ...clip } });
} catch (err) {
  console.error(String(err?.message || err));
  process.exitCode = 1;
} finally {
  await browser.close();
}

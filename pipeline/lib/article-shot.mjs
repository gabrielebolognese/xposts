// The article cover: renders the model's cover HTML at 2x and exports it as a PNG. Network requests are blocked (the
// file must be self-contained). Prints {"problems": [...]} and exits 1 when text spills outside the frame or is cut off.
//   node pipeline/lib/article-shot.mjs cover.html cover.png 1500 600
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const [file, out, w = '1500', h = '600'] = process.argv.slice(2);
const width = Number(w), height = Number(h);
const CHROME = process.env.STUDIO_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--hide-scrollbars'],
  defaultViewport: { width, height, deviceScaleFactor: 2 },
});
const problems = [];
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('about:')) return r.continue();
    problems.push(`blocked a network request (the file must be self-contained): ${u.slice(0, 80)}`);
    return r.abort();
  });
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 500));
  problems.push(...(await page.evaluate((W, H) => {
    const found = [];
    for (const el of document.body.querySelectorAll('*')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const r = el.getBoundingClientRect();
      const text = el.textContent.trim().slice(0, 40);
      if (r.width && (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1))
        found.push(`text outside the ${W}x${H} frame: "${text}"`);
      else if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible')
        found.push(`text cut off: "${text}"`);
    }
    return found;
  }, width, height)));
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
} finally {
  await browser.close();
}
console.log(JSON.stringify({ problems }));
process.exitCode = problems.length ? 1 : 0;

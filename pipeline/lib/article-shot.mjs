// The article cover and the thread images: renders a model's HTML at 2x and exports it as a PNG (or JPEG for a .jpg
// out). Network requests are blocked (the file must be self-contained). Prints {"problems": [...]} and exits 1 when text
// spills outside the frame or is cut off, or an element marked data-fit holds more than fits in it.
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
    for (const box of document.querySelectorAll('[data-fit]')) {
      const tall = box.scrollHeight - box.clientHeight, wide = box.scrollWidth - box.clientWidth;
      if (tall > 2) found.push(`the content is ${tall}px taller than its area: shorten it or make it smaller`);
      if (wide > 2) found.push(`the content is ${wide}px wider than its area`);
    }
    if (document.querySelector('[data-strict]')) { // a thread diagram: words only inside cards or on arrows
      for (const el of document.body.querySelectorAll('*')) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (own && !el.closest('.card, .arrow, svg, script, style'))
          found.push(`text outside a card or an arrow: "${el.textContent.trim().slice(0, 40)}"`);
        const card = own && el.closest('.card');
        if (card) { // a word wider than its card runs over the border
          const range = document.createRange();
          range.selectNodeContents(el);
          const t = range.getBoundingClientRect(), c = card.getBoundingClientRect();
          if (t.width && (t.right > c.right - 2 || t.left < c.left + 2))
            found.push(`text runs over its card's border: "${el.textContent.trim().slice(0, 40)}": shorten the words or `
              + 'give the card more width');
        }
      }
      const main = document.querySelector('[data-strict]'), cs = getComputedStyle(main);
      const room = main.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const parts = [...main.querySelectorAll('.card, .arrow, svg')].map((e) => e.getBoundingClientRect());
      if (parts.length) {
        const used = Math.max(...parts.map((r) => r.bottom)) - Math.min(...parts.map((r) => r.top));
        if (used < room * 0.7) found.push(`the diagram fills only ${Math.round(100 * used / room)}% of the page height: make `
          + 'the cards and their text larger, or show more of the part, so it fills at least 70%');
      }
      const boxes = [...document.querySelectorAll('.card')].map((c) => c.getBoundingClientRect());
      boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
        if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2
            && !(a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom)
            && !(b.left >= a.left && b.right <= a.right && b.top >= a.top && b.bottom <= a.bottom))
          found.push('two cards overlap');
      }));
    }
    return found;
  }, width, height)));
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
} finally {
  await browser.close();
}
console.log(JSON.stringify({ problems }));
process.exitCode = problems.length ? 1 : 0;

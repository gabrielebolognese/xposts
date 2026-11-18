// The screenshot for the trending post: one X post rendered from X's public embed (no login, no API call).
//   node pipeline/lib/trend-shot.mjs <post id> out.png
// Exits 1 when the post does not render (deleted, protected, or the embed is blocked).
import puppeteer from 'puppeteer-core';

const [id, out] = process.argv.slice(2);
if (!/^\d{1,25}$/.test(id || '') || !out) {
  console.error('Usage: node trend-shot.mjs <post id> out.png');
  process.exit(2);
}
const CHROME = process.env.STUDIO_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = `https://platform.twitter.com/embed/Tweet.html?id=${id}&theme=dark&dnt=true&hideThread=true&lang=en`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--hide-scrollbars'],
  defaultViewport: { width: 560, height: 1200, deviceScaleFactor: 2 },
});
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  const card = await page.waitForSelector('article', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 1500)); // images and the avatar settle
  const box = await card.boundingBox();
  if (!box || box.height < 80) throw new Error('the post did not render');
  await card.screenshot({ path: out });
} catch (e) {
  console.error(`post ${id}: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}

// The Jarvis screenshot for the build-in-public post: opens Jarvis, clicks the STATISTICS tab, waits for it to draw.
//   node pipeline/lib/bip-shot.mjs http://127.0.0.1:5173 out.png
import puppeteer from 'puppeteer-core';

const [url, out] = process.argv.slice(2);
const CHROME = process.env.STUDIO_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const tab = () => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('STATISTICS'));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--hide-scrollbars'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(tab, { timeout: 60000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('STATISTICS')).click());
  await page.waitForSelector('.stats', { timeout: 60000 }); // drawn once the numbers have loaded
  await page // the money and token numbers load last ("still filling in"); after 3 minutes it is taken as it is
    .waitForFunction(() => !document.body.innerText.includes('still filling in'), { timeout: 180000, polling: 1000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 2000)); // the charts settle
  await page.screenshot({ path: out, fullPage: true });
} finally {
  await browser.close();
}

// Xuất sơ đồ archify (HTML) ra PNG: chụp khối SVG lớn nhất, nền sáng, máy chạy tĩnh.
import { createRequire } from "module";
import { pathToFileURL } from "url";
const require = createRequire("D:/jobs/SVN/frontend/package.json");
const { chromium } = require("playwright");
const [, , html, png] = process.argv;
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
const page = await ctx.newPage();
await page.goto(pathToFileURL(html).href);
await page.waitForTimeout(2500);
const svg = await page.evaluateHandle(() => [...document.querySelectorAll("svg")].sort((a, b) => {
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  return rb.width * rb.height - ra.width * ra.height;
})[0]);
await svg.asElement().screenshot({ path: png });
console.log("đã xuất", png);
await browser.close();

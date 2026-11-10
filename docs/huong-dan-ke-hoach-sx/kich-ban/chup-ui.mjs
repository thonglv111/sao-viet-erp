// Chụp màn ERP dev để làm tài liệu, khoanh đỏ có đánh số các ô/nút.
// node chup-ui.mjs <kich-ban.mjs> <thu-muc-ra>
// Kịch bản export default async ({ page, chup, khoanh, xoaKhoanh, mo }) => {...}
import { createRequire } from "module";
import { readFileSync } from "fs";
import { pathToFileURL } from "url";
import path from "path";
const require = createRequire("D:/jobs/SVN/frontend/package.json");
const { chromium } = require("playwright");

const [, , kichBan, raDir] = process.argv;
const env = readFileSync("D:/jobs/SVN/.env.example", "utf8");
const lay = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
// CHUP_BASE=http://localhost:5174 khi chụp ở bản chạy thử trong worktree.
const BASE = process.env.CHUP_BASE || "http://localhost:5173"; // frontend Hà Phương: CHUP_BASE=http://localhost:5273

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.5, locale: "vi-VN", colorScheme: "light" });
const page = await ctx.newPage();
await page.goto(BASE);
await page.waitForLoadState("domcontentloaded");
const mk = page.locator('input[type="password"]').first();
if (await mk.waitFor({ timeout: 10000 }).then(() => true, () => false)) {
  // CHUP_USER/CHUP_MK: chụp bằng tài khoản người dùng thật (vd tổ trưởng kỹ thuật), mặc định admin.
  await page.getByPlaceholder("vd: admin").fill(process.env.CHUP_USER || lay("SEED_ADMIN_USERNAME"));
  await mk.fill(process.env.CHUP_MK || lay("SEED_ADMIN_PASSWORD"));
  await page.getByRole("button", { name: /Đăng nhập hệ thống/ }).click();
  await mk.waitFor({ state: "detached", timeout: 20000 });
  await page.waitForTimeout(2000);
}

// Khoanh đỏ: list [{ loc, so, pad }] — loc là Locator của Playwright.
async function khoanh(ds) {
  const hop = [];
  for (const [i, k] of ds.entries()) {
    let b;
    if (k.nhan) {
      // Ô theo nhãn: tìm chữ nhãn (bỏ dấu *), leo lên khối đầu tiên có ô nhập/nút.
      b = await page.evaluate(({ nhan, cuon }) => {
        const sach = (s) => s.replace(/\s*\*\s*$/, "").trim();
        const ds = [...document.querySelectorAll("label,span,div,p,legend,h3,h4")]
          .filter((e) => e.offsetParent && sach(e.textContent).toLowerCase() === nhan.toLowerCase() && e.querySelectorAll("*").length <= 3);
        const el = ds[ds.length - 1];
        if (!el) return null;
        let p = el.parentElement;
        while (p && !p.querySelector("input,select,textarea,button,[role=combobox]")) p = p.parentElement;
        const o = p ?? el;
        if (cuon) o.scrollIntoView({ block: "center" });
        const r = o.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }, { nhan: k.nhan, cuon: k.cuon });
      if (k.cuon) await page.waitForTimeout(400);
      if (b && k.cuon) {
        b = await page.evaluate(({ nhan }) => {
          const sach = (s) => s.replace(/\s*\*\s*$/, "").trim();
          const ds = [...document.querySelectorAll("label,span,div,p,legend,h3,h4")]
            .filter((e) => e.offsetParent && sach(e.textContent).toLowerCase() === nhan.toLowerCase() && e.querySelectorAll("*").length <= 3);
          let p = ds[ds.length - 1].parentElement;
          while (p && !p.querySelector("input,select,textarea,button,[role=combobox]")) p = p.parentElement;
          const r = (p ?? ds[ds.length - 1]).getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }, { nhan: k.nhan });
      }
    } else {
      const loc = k.loc ?? k;
      if (k.cuon) { await loc.first().scrollIntoViewIfNeeded(); await page.waitForTimeout(300); }
      b = await loc.first().boundingBox();
    }
    if (!b) { console.error("KHÔNG THẤY", k.ten ?? i); continue; }
    hop.push({ ...b, so: "so" in k ? k.so : i + 1, pad: k.pad ?? 4 });
  }
  await page.evaluate((hop) => {
    for (const h of hop) {
      const d = document.createElement("div");
      d.className = "__khoanh";
      Object.assign(d.style, { position: "fixed", left: `${h.x - h.pad}px`, top: `${h.y - h.pad}px`,
        width: `${h.width + 2 * h.pad}px`, height: `${h.height + 2 * h.pad}px`, border: "3px solid #e11d1d",
        borderRadius: "6px", zIndex: 2147483647, pointerEvents: "none", boxSizing: "border-box" });
      if (h.so !== null) {
        const n = document.createElement("div");
        n.textContent = h.so;
        Object.assign(n.style, { position: "absolute", left: "-14px", top: "-14px", width: "24px", height: "24px",
          borderRadius: "50%", background: "#e11d1d", color: "#fff", font: "bold 14px/24px Arial", textAlign: "center" });
        d.appendChild(n);
      }
      document.body.appendChild(d);
    }
  }, hop);
}
const xoaKhoanh = () => page.evaluate(() => document.querySelectorAll(".__khoanh").forEach((e) => e.remove()));
// clip = "ngan": cắt đúng ngăn khai đang mở (leo từ nút Hủy lên khối cao gần hết màn).
async function chup(ten, clip) {
  await page.waitForTimeout(400);
  if (clip === "ngan") {
    clip = await page.evaluate(() => {
      const huy = [...document.querySelectorAll("button")].filter((b) => b.offsetParent && /^Hủy/.test(b.textContent.trim())).pop();
      let p = huy;
      while (p && p.getBoundingClientRect().height < innerHeight * 0.9) p = p.parentElement;
      if (!p) return undefined;
      const r = p.getBoundingClientRect();
      return { x: r.x, y: 0, width: Math.min(r.width, innerWidth - r.x), height: innerHeight };
    });
  }
  await page.screenshot({ path: path.join(raDir, `${ten}.png`), clip });
  console.log("đã chụp", ten);
  await xoaKhoanh();
}
async function mo(man) {
  await page.goto(`${BASE}/?man=${man}`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2500);
}

const kb = (await import(pathToFileURL(path.resolve(kichBan)).href)).default;
try {
  await kb({ page, chup, khoanh, xoaKhoanh, mo });
} catch (e) {
  console.error("LỖI", e.message);
  await page.screenshot({ path: path.join(raDir, "_loi.png") });
} finally {
  await browser.close();
}

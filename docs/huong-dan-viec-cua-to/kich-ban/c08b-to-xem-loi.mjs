// Chương 8: tổ In (tổ id 14) thấy lỗi KCS vừa ghi ở công đoạn In của LSX26-0007.
// Chụp ô đếm "Lỗi KCS chờ xem" trên đầu màn → vtt-74-to-loi-cho-xem, bấm ô đó, mở việc
// → tab KCS → vtt-75-to-tab-kcs. Mở tab KCS là tổ đã xem (GHI dữ liệu).
export default async ({ page, chup, khoanh }) => {
  await page.goto("http://localhost:5173/?man=thuc-hien-sx:14");
  const o = page.getByRole("button", { name: /Lỗi KCS chờ xem/ });
  await o.first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  await khoanh([{ loc: o, so: 1 }]);
  await chup("vtt-74-to-loi-cho-xem", { x: 255, y: 0, width: 1185, height: 420 });
  await page.evaluate(() => document.querySelectorAll(".__khoanh").forEach((e) => e.remove()));
  await o.first().click();
  await page.waitForTimeout(1500);
  await page.getByText("LSX26-0007", { exact: true }).first().click();
  const ngan = page.locator("aside.thsx-panel--open");
  await ngan.waitFor();
  await page.waitForTimeout(2000);
  const tab = ngan.getByRole("tab", { name: /^KCS/ });
  if ((await tab.getAttribute("aria-selected")) !== "true") { await tab.click(); await page.waitForTimeout(1500); }
  console.log((await ngan.innerText()).slice(0, 1500));
  await khoanh([{ loc: tab, so: 1 }, { loc: ngan.getByText("Lỗi KCS", { exact: true }).locator(".."), so: 2 }]);
  const b = await ngan.boundingBox();
  await chup("vtt-75-to-tab-kcs", { x: b.x, y: 0, width: b.width, height: 700 });
};

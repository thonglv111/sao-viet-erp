// Chương 7: Theo dõi sản xuất (đơn DH003) và Hồ sơ lệnh sản xuất (LSX26-0007).
const BUOC = process.env.BUOC || "1";
export default async ({ page, chup, khoanh, mo }) => {
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  const b = { x: 244, y: 56, width: 1440 - 244, height: 950 - 56 };
  const ngan = async (chu) => page.locator("main").getByText(chu, { exact: true }).last().evaluate((e) => {
    let p = e; while (p && p.getBoundingClientRect().height < innerHeight * 0.9) p = p.parentElement;
    const r = p.getBoundingClientRect(); return { x: r.x, y: 0, width: Math.min(r.width, innerWidth - r.x), height: innerHeight };
  });
  if (BUOC === "1") {
    await mo("theo-doi-san-xuat");
    await page.getByText("DH003", { exact: true }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    const dong = page.locator("tr").filter({ hasText: "DH003" }).first();
    await khoanh([
      { loc: page.getByText(/^Tất cả/).first().locator("xpath=..") },
      { loc: page.locator("th").filter({ hasText: /Lệnh\s*SX\s*Kho\s*Giao/ }).first() },
      { loc: dong.locator("td").nth(4) },
      { loc: dong.locator("td").nth(6) },
      { loc: dong.locator("td").nth(7) },
    ]);
    await chup("khsx-60-theo-doi", { x: b.x, y: b.y, width: b.width, height: 380 });
    await dong.click();
    await page.waitForTimeout(3000);
    await chup("khsx-61-ngan-don", await ngan("Tổng quan"));
  } else {
    await mo("lenh-san-xuat");
    await page.getByText("LSX26-0007", { exact: true }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    const d7 = page.locator("tr").filter({ hasText: "LSX26-0007" }).first();
    await khoanh([
      { loc: page.getByText(/^Tất cả/).first().locator("xpath=..") },
      { loc: d7.locator("td").nth(5) },
      { loc: d7.locator("td").nth(6) },
      { loc: page.locator("tr").filter({ hasText: "LSX26-0008" }).first().locator("td").nth(5) },
    ]);
    await chup("khsx-62-ho-so-lenh", { x: b.x, y: b.y, width: b.width, height: 420 });
    await page.locator("tr").filter({ hasText: "LSX26-0007" }).first().click();
    await page.waitForTimeout(3000);
    await khoanh([
      { loc: page.getByText("Kho và giao", { exact: true }).last().locator("xpath=..") },
      { loc: page.locator("button:visible").filter({ hasText: /In phiếu công nghệ/ }).first() },
      { loc: page.getByText("Hàng đang tới đâu").last() },
      { loc: page.getByText(/Mới giữ được một phần/).last() },
    ]);
    await chup("khsx-63-ngan-ho-so", await ngan("Sản lượng"));
    await page.getByText("Sản lượng", { exact: true }).first().click();
    await page.waitForTimeout(2000);
    await chup("khsx-64-san-luong", await ngan("Sản lượng"));
  }
};

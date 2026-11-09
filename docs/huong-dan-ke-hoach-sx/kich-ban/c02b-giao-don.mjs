// Chương 2: Hàng chờ tiếp nhận, hộp Giao, tab Tạo lệnh (đơn DH006 của DT Box, 08/11/2026).
// Chụp bằng tài khoản thật của Phòng kỹ thuật, không dùng admin:
//   BUOC=giao  tổ trưởng (người có ô Giao đơn), DH006 còn Chưa giao, DH005 (DONB) đã giao và có lệnh cho một
//              phần đơn để ô "Đã tạo x/y lệnh" có số: khsx-10, 12, 13. Không bấm Giao cuối.
//   BUOC=tao   người phụ trách vừa được giao DH006, chưa mở đơn: khsx-14.
// Ví dụ: CHUP_USER=nguyenthiminhphuong CHUP_MK=... BUOC=giao node chup-ui.mjs c02b-giao-don.mjs ../hinh
const DON = process.env.DON || "DH006";
export default async ({ page, chup, khoanh, xoaKhoanh, mo }) => {
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  // Rộng hơn mặc định để cột Người phụ trách nằm trong khung, không phải cuộn ngang.
  await page.setViewportSize({ width: 1920, height: 950 });
  await mo("ke-hoach-sx");
  const main = page.locator("main").first();

  if (process.env.BUOC !== "tao") {
    const tab = page.getByRole("tab", { name: /Hàng chờ tiếp nhận/ });
    await tab.click();
    await page.getByText(DON).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const dong = page.getByRole("row").filter({ hasText: DON }).first();

    // khsx-10: tab, dòng đơn, cột Trạng thái, ô "Đã tạo x/y lệnh" của đơn đã có lệnh một phần (DONB).
    const dongB = page.getByRole("row").filter({ hasText: process.env.DONB || "DH005" }).first();
    await khoanh([
      { loc: tab },
      { loc: dong },
      { loc: page.getByRole("columnheader", { name: "Trạng thái" }) },
      { loc: dongB.getByText(/Đã tạo \d+\/\d+ lệnh/) },
    ]);
    let b = await main.boundingBox();
    await chup("khsx-10-hang-cho", { x: b.x, y: b.y, width: b.width, height: 340 });
    await xoaKhoanh();

    // khsx-12: chip trạng thái, tick đơn, cột Người phụ trách, cụm Đã chọn.
    await page.getByRole("checkbox", { name: `Chọn đơn ${DON}` }).check();
    await page.waitForTimeout(500);
    await khoanh([
      { loc: page.getByRole("group", { name: "Lọc theo trạng thái" }) },
      { loc: page.getByRole("checkbox", { name: `Chọn đơn ${DON}` }) },
      { loc: page.getByRole("columnheader", { name: "Người phụ trách" }) },
      { loc: page.getByRole("region", { name: "Đơn đã chọn" }) },
    ]);
    b = await main.boundingBox();
    await chup("khsx-12-giao-don", { x: b.x, y: b.y, width: b.width, height: 340 });
    await xoaKhoanh();

    // khsx-13: hộp Giao liệt kê người trong phòng, gõ tên để lọc, chọn một người (không bấm Giao).
    await page.getByRole("region", { name: "Đơn đã chọn" }).getByRole("button", { name: "Giao" }).click();
    const hop = page.getByRole("dialog").last();
    await hop.getByRole("radio").first().waitFor({ timeout: 10000 });
    const tim = hop.getByRole("searchbox", { name: "Tìm người phụ trách" });
    await hop.getByRole("radio", { name: new RegExp(process.env.NGUOI || "Hoàng Phi Hùng") }).check();
    await page.waitForTimeout(400);
    await khoanh([
      { loc: tim },
      { loc: hop.getByRole("radiogroup", { name: "Người phụ trách" }) },
      { loc: hop.getByRole("button", { name: /^Giao$/ }) },
    ]);
    const h = await hop.boundingBox();
    await chup("khsx-13-hop-giao", { x: h.x - 24, y: h.y - 24, width: h.width + 48, height: h.height + 48 });
    await xoaKhoanh();
    await page.keyboard.press("Escape");
    return;
  }

  // khsx-14: tab Tạo lệnh của người phụ trách, đơn mới giao còn chấm, cột Người phụ trách.
  const tabTao = page.getByRole("tab", { name: /Tạo lệnh/ });
  await tabTao.click();
  const dongTao = page.getByRole("row", { name: new RegExp(`Tạo lệnh cho đơn ${DON}`) });
  await dongTao.waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await khoanh([
    { loc: tabTao },
    { loc: dongTao.locator("td").first() },
    { loc: page.getByRole("columnheader", { name: "Người phụ trách" }) },
  ]);
  const b = await main.boundingBox();
  await chup("khsx-14-tao-lenh", { x: b.x, y: b.y, width: b.width, height: 340 });
};

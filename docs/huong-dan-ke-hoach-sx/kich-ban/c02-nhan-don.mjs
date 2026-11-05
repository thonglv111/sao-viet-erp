// Chương 2: Hàng chờ tiếp nhận + ngăn Lệnh dự kiến (DH003), rồi bấm Xác nhận tạo lệnh.
export default async ({ page, chup, khoanh, mo }) => {
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  await mo("ke-hoach-sx");
  await page.getByText("DH003").first().waitFor({ timeout: 20000 });
  const tab = page.getByRole("tab", { name: /Hàng chờ tiếp nhận/ });
  const dong = page.getByRole("row").filter({ hasText: "DH003" }).first();
  const tien = dong.getByText(/0\/3 dòng/);
  await khoanh([{ loc: tab }, { loc: dong }, { loc: tien }]);
  const b = await page.locator("main").first().boundingBox();
  await chup("khsx-10-hang-cho", { x: b.x, y: b.y, width: b.width, height: 320 });
  await page.setViewportSize({ width: 1440, height: 700 });
  await dong.click();
  await page.getByRole("button",{name:/Xác nhận tạo/}).waitFor({ timeout: 15000 });
  await page.waitForTimeout(2500);
  const hop = page.locator("aside.khsx-drawer").last();
  await khoanh([
    { loc: hop.getByText(/Số dưới đây máy/) },
    { loc: hop.getByRole("checkbox").nth(1) },
    { loc: hop.locator("th", { hasText: /^Vào máy$/ }) },
    { loc: hop.locator("tbody tr").first().locator("td").last() },
    { loc: hop.getByRole("button", { name: /Xác nhận tạo/ }) },
  ]);
  const h = await hop.boundingBox();
  await chup("khsx-11-lenh-du-kien", { x: h.x, y: 0, width: h.width, height: 700 });
  if (process.env.TAO === "1") {
    await hop.getByRole("button", { name: /Xác nhận tạo/ }).click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: process.argv[3] + "/_sau-tao.png" });
  }
};

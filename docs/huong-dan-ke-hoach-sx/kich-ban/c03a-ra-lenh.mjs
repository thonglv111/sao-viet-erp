// Chương 3 (trước khi sửa): tổng quan lệnh còn thiếu, tab Thông tin chung, ngăn bước Khuôn hộp.
export const moLenh = async (page, mo, ma) => {
  await mo("ke-hoach-sx");
  await page.getByRole("tab", { name: "Lệnh sản xuất" }).click();
  await page.getByText(ma, { exact: true }).first().click();
  await page.getByText(/Còn thiếu|Sẵn sàng lập kế hoạch|Đủ dữ liệu|Đã phát hành/).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
};
export default async ({ page, chup, khoanh, mo }) => {
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  await moLenh(page, mo, "LSX26-0007");
  const main = page.locator("main").first();
  const nut = (re) => page.locator("button:visible").filter({ hasText: re });
  await khoanh([
    { loc: page.getByText(/Còn thiếu \d+ mục/).first() },
    { loc: page.getByRole("button", { name: "Khuôn hộp →" }) },
    { loc: nut(/^Sẵn sàng lập kế hoạch$/) },
    { loc: page.getByText(/^Vào máy$/i).first().locator("xpath=..") },
    { loc: nut(/Gia công trọn gói/) },
    { loc: nut(/Xoá lệnh/) },
  ]);
  const b = await main.boundingBox();
  const t = await page.getByRole("tab", { name: "Thông tin chung" }).first().boundingBox();
  await chup("khsx-20-tong-quan", { x: b.x, y: b.y, width: b.width, height: t.y + t.height + 12 - b.y });
  // Thông tin chung
  await khoanh([
    { loc: page.getByText(/^Hàng thường$/).first().locator("xpath=..") },
    { nhan: "HẠN HOÀN THÀNH SẢN XUẤT" },
    { nhan: "GHI CHÚ KẾ HOẠCH" },
  ]);
  const t2 = await page.getByRole("tab", { name: "Thông tin chung" }).first().boundingBox();
  await chup("khsx-21-thong-tin", { x: b.x, y: t2.y - 10, width: b.width, height: 430 });
  // Ngăn bước
  await page.getByRole("button", { name: "Khuôn hộp →" }).click();
  await page.getByText("KHUÔN CỦA BƯỚC", { exact: false }).first().waitFor();
  await page.waitForTimeout(1500);
  await khoanh([
    { loc: page.getByText("Phân công & Thiết bị", { exact: true }).first().locator("xpath=..") },
    { nhan: "TỔ PHỤ TRÁCH" },
    { nhan: "MÁY SẢN XUẤT" },
    { loc: page.getByText(/^Sale báo:/).first() },
    { loc: nut(/Làm khuôn mới/) },
    { loc: page.getByText(/Sửa ở đây chưa ghi vào DB/).first() },
  ]);
  const n = await page.getByText(/Sửa ở đây chưa ghi vào DB/).first().evaluate((e) => {
    let p = e; while (p && p.getBoundingClientRect().height < innerHeight * 0.9) p = p.parentElement;
    const r = p.getBoundingClientRect(); return { x: r.x, y: 0, width: r.width, height: innerHeight };
  });
  await chup("khsx-23-ngan-buoc", n);
};

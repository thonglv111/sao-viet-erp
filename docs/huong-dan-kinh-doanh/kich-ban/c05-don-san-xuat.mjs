// Chương Đơn hàng: ảnh kd-33 (đơn đang ở chặng Sản xuất).
// Chụp lại 10/11/2026 khi bỏ nút Mở Lệnh sản xuất ở dòng việc và ở chân khung Sản xuất.
// Chạy: node ../../huong-dan-ke-hoach-sx/kich-ban/chup-ui.mjs c05-don-san-xuat.mjs ../hinh
// Chỉ MỞ và XEM. Biến môi trường DON đổi mã đơn khi chạy trên dữ liệu khác.
const DON = process.env.DON || "DH006";

export default async ({ page, chup, khoanh, mo }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mo("don-hang-ban");
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  await page.getByPlaceholder("Tìm mã đơn, khách, PO, hàng").fill(DON);
  await page.waitForTimeout(1500);
  await page.locator("tr").filter({ hasText: DON }).locator("td").nth(2).click();
  const tieuDe = page.getByText(DON, { exact: true }).last();
  await page.locator(".dhb__viec").waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);

  await khoanh([
    { loc: page.locator(".dhb__the-bang tbody tr").first().locator("td").nth(1).locator("button, a").first() },
    { loc: page.locator(".dhb__viec-cau") },
  ]);
  // Cắt từ mép trái ngăn đơn tới hết màn, bỏ danh sách phía sau.
  const trai = await tieuDe.evaluate((el) => {
    let p = el;
    while (p.parentElement && p.parentElement.getBoundingClientRect().width < window.innerWidth - 150) p = p.parentElement;
    return Math.max(0, Math.floor(p.getBoundingClientRect().left));
  });
  await chup("kd-33-dh-sx", { x: trai, y: 0, width: 1440 - trai, height: 760 });
};

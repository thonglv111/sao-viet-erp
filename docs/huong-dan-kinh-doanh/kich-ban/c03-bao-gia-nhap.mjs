// Chương Báo giá: ảnh kd-20 (báo giá nháp, bảng nhiều dòng).
// Chụp lại 08/11/2026 khi thêm cột Đơn giá (giá bán ÷ SL, gõ được) đứng trước Giá bán.
// Chạy: node ../../huong-dan-ke-hoach-sx/kich-ban/chup-ui.mjs c03-bao-gia-nhap.mjs ../hinh
// Chỉ MỞ và XEM, không gõ ô nào: rời ô có số mới là báo giá tự lưu.
// Biến môi trường BAO_GIA đổi mã báo giá nháp khi chạy trên dữ liệu khác.
const BAO_GIA = process.env.BAO_GIA || "BG26-0007";

export default async ({ page, chup, khoanh, mo }) => {
  // 1600 cho bảng 9 cột trải đủ, không phải cuộn ngang.
  await page.setViewportSize({ width: 1600, height: 1000 });
  await mo("bao-gia");
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  await page.getByText(BAO_GIA).first().click();
  await page.locator("table.bg-dong").waitFor({ timeout: 20000 });
  await page.waitForTimeout(2000);

  const cot = (ten) => page.locator("table.bg-dong thead th").filter({ hasText: new RegExp(`^${ten}$`) });
  await khoanh([
    { loc: page.getByText("Lấy từ phiếu tính giá", { exact: true }) },
    { loc: cot("Chiết khấu") },
    { loc: cot("Lợi nhuận") },
    { loc: cot("Đơn giá") },
    { loc: cot("Giá bán") },
    { loc: cot("Kê") },
    { loc: page.getByRole("button", { name: "Xem bản in" }) },
    { loc: page.getByRole("button", { name: "Gửi khách" }) },
  ]);
  // Cắt bỏ thanh bên: từ mép trái vùng nội dung tới hết màn.
  const trai = await page.evaluate(() => {
    const t = [...document.querySelectorAll("table.bg-dong")][0];
    let p = t;
    while (p.parentElement && p.parentElement.getBoundingClientRect().left > 120) p = p.parentElement;
    return Math.max(0, Math.floor(p.getBoundingClientRect().left));
  });
  await chup("kd-20-bg-nhap", { x: trai, y: 0, width: 1600 - trai, height: 1000 });
};

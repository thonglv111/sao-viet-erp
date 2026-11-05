// Chương 3: giao người và bắt đầu, trên việc In của LSX26-0007 (tổ Nhóm thợ in máy 6 màu, id 14).
// BUOC=1: chụp ngăn trước khi bắt đầu và hộp Giao người (không ghi gì).
// BUOC=2: bấm Bắt đầu (GHI dữ liệu) rồi chụp ngăn đang chạy.
import { moViec, clipNgan } from "./chung.mjs";

export default async ({ page, chup, khoanh }) => {
  const BUOC = process.env.BUOC ?? "1";
  const ngan = await moViec(page, "thuc-hien-sx:14", "LSX26-0007");
  if (BUOC === "1") {
    await ngan.getByRole("button", { name: /Giao người/ }).click();
    await page.waitForTimeout(1200);
    const tho = ngan.getByText("Huỳnh Văn Tính", { exact: true }).locator("..");
    await khoanh([
      { loc: ngan.getByRole("button", { name: /^Bắt đầu/ }), so: 1 },
      { loc: tho, so: 2 },
      { loc: ngan.getByPlaceholder("Tìm tên hoặc mã").locator("../.."), so: 3 },
    ]);
    await chup("vtt-21-giao-nguoi", await clipNgan(page));
    await page.keyboard.press("Escape");
  }
  if (BUOC === "2") {
    await ngan.getByRole("button", { name: /^Bắt đầu/ }).click();
    await page.waitForTimeout(2500);
  }
  // BUOC=2 hoặc 3 (3 = chỉ chụp lại): việc đang chạy.
  if (BUOC === "2" || BUOC === "3") {
    await khoanh([
      { loc: ngan.getByText(/^Đang chạy từ/).first(), so: 1 },
      { loc: ngan.getByRole("button", { name: /Tạm dừng/ }), so: 2 },
      { loc: ngan.getByRole("button", { name: /Kết thúc/ }), so: 3 },
    ]);
    await chup("vtt-23-dang-chay", { x: 255, y: 0, width: 1185, height: 330 });
  }
};

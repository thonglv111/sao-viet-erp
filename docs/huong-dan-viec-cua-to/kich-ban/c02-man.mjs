// Chương 2: màn Việc của tổ (Bế TD - Kiệt, tổ id 21), chỉ chụp, không ghi gì.
// vtt-10-man-viec-cua-to: cả màn, khoanh tổ ở thanh bên, ba kiểu xem, ô tìm, chip trạng thái, cột.
// vtt-11-kieu-lich, vtt-12-kieu-san-luong: hai kiểu xem còn lại.
// vtt-13-ngan-viec: ngăn một việc (Khuôn hộp của LSX26-0007), khoanh tab và cột phải.
import { moViec } from "./chung.mjs";

export default async ({ page, chup, khoanh, mo }) => {
  await page.goto("http://localhost:5173/?man=thuc-hien-sx:21");
  await page.getByText("LSX26-0007", { exact: true }).first().waitFor({ timeout: 30000 });
  await page.mouse.move(5, 900);
  await page.waitForTimeout(1200);
  const xem = page.getByRole("button", { name: /^Bảng$/ }).locator("..");
  await khoanh([
    { loc: page.locator("nav, aside").getByText("Bế TD - Kiệt", { exact: true }).first(), so: 1 },
    { loc: xem, so: 2 },
    { loc: page.getByPlaceholder(/Tìm mã/), so: 3 },
    { loc: page.getByRole("button", { name: /^Tất cả/ }).first().locator(".."), so: 4 },
    { loc: page.getByRole("columnheader", { name: "Vật tư" }), so: 5 },
    { loc: page.getByRole("columnheader", { name: /Tốt \/ cần/ }), so: 6 },
    { loc: page.getByRole("columnheader", { name: /Hàng đang tới/ }), so: 7 },
  ]);
  await chup("vtt-10-man-viec-cua-to");
  await page.evaluate(() => document.querySelectorAll(".__khoanh").forEach((e) => e.remove()));
  for (const [nut, ten] of [["Lịch", "vtt-11-kieu-lich"], ["Sản lượng", "vtt-12-kieu-san-luong"]]) {
    await page.getByRole("button", { name: new RegExp(`^${nut}$`) }).click();
    await page.waitForTimeout(2500);
    await page.mouse.move(5, 900);
    await chup(ten, { x: 255, y: 0, width: 1185, height: 700 });
  }
  await page.getByRole("button", { name: /^Bảng$/ }).click();
  await page.waitForTimeout(1500);
  const ngan = await moViec(page, "thuc-hien-sx:21", "LSX26-0007", 1);
  await khoanh([
    { loc: ngan.getByRole("tablist").first(), so: 1 },
    { loc: ngan.getByText("Hàng đang tới đâu", { exact: true }), so: 2 },
    { loc: ngan.getByText("Tiến độ", { exact: true }), so: 3 },
    { loc: ngan.getByText("Việc", { exact: true }), so: 4 },
  ]);
  const b = await ngan.boundingBox();
  await chup("vtt-13-ngan-viec", { x: b.x, y: 0, width: b.width, height: 950 });
};

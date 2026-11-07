// Chương 3, tab Công đoạn (07/11/2026, lệnh chỉ chọn bộ phận nhận): bảng danh sách và ngăn bước
// Khuôn hộp của LSX26-0005 (lệnh Nháp). Chỉ xem, không lưu gì.
import { moLenh } from "./c03a-ra-lenh.mjs";
export default async ({ page, chup, khoanh, mo }) => {
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  await moLenh(page, mo, "LSX26-0005");
  const main = page.locator("main").first();
  const nut = (re) => page.locator("button:visible").filter({ hasText: re });
  await page.getByRole("tab", { name: /^Công đoạn/ }).first().click();
  await page.waitForTimeout(1200);
  await nut(/Bảng danh sách/).first().click();
  await page.waitForTimeout(1500);
  // Đưa dòng "Chuỗi công đoạn" lên đầu màn để thấy được các dòng của bảng.
  const dau = page.getByText(/^Chuỗi công đoạn/).first();
  await dau.evaluate((e) => e.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(600);
  await khoanh([
    { loc: page.getByRole("columnheader", { name: "Loại" }).first() },
    { loc: page.getByRole("columnheader", { name: "Bộ phận nhận" }).first() },
  ]);
  const b = await main.boundingBox();
  const d = await dau.boundingBox();
  const y = Math.max(d.y - 12, 0);
  await chup("khsx-22-cong-doan", { x: b.x, y, width: b.width, height: 950 - y });
  // Ngăn bước Khuôn hộp: BỘ PHẬN NHẬN + khuôn nằm chung tab Cấu hình & Số lượng.
  await page.getByRole("button", { name: /^Khuôn hộp/ }).first().click();
  await page.getByText("BỘ PHẬN NHẬN", { exact: true }).first().waitFor();
  await page.waitForTimeout(1500);
  await khoanh([
    { loc: page.getByText("Cấu hình & Số lượng", { exact: true }).first().locator("xpath=..") },
    { loc: page.getByText("LOẠI BƯỚC THỰC HIỆN", { exact: true }).first().locator("xpath=..") },
    { loc: page.getByText("BỘ PHẬN NHẬN", { exact: true }).first().locator("xpath=..") },
    { loc: page.getByText(/^khuôn của bước/i).first().locator("xpath=../..") },
    { loc: page.getByText(/Sửa ở đây chưa ghi vào DB/).first() },
  ]);
  const n = await page.getByText("BỘ PHẬN NHẬN", { exact: true }).first().evaluate((e) => {
    let p = e; while (p && p.getBoundingClientRect().height < innerHeight * 0.9) p = p.parentElement;
    const r = p.getBoundingClientRect(); return { x: r.x, y: 0, width: Math.min(r.width, innerWidth - r.x), height: innerHeight };
  });
  await chup("khsx-23-ngan-buoc", n);
};

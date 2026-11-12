// Chương 3, tab Công đoạn (12/11/2026, khối Vật liệu đầu vào + bảng Các bước): ảnh khsx-22 chụp lệnh
// LSX26-0006 (Nháp, có giấy in và sóng, chuỗi có Tề sóng nên thấy đủ nhánh Giấy / Sóng / Gộp); ngăn bước
// Khuôn hộp chụp ở LSX26-0005. Chỉ xem, không lưu gì (đọc phương án vật liệu không ghi DB).
import { moLenh } from "./c03a-ra-lenh.mjs";
export default async ({ page, chup, khoanh, mo }) => {
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  const main = page.locator("main").first();
  const nut = (re) => page.locator("button:visible").filter({ hasText: re });
  const moCongDoan = async (ma) => {
    await moLenh(page, mo, ma);
    await page.getByRole("tab", { name: /^Công đoạn/ }).first().click();
    await page.waitForTimeout(1200);
    await nut(/Bảng danh sách/).first().click();
    await page.getByRole("button", { name: "Khổ giấy in lấy ở kho" }).first().waitFor({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
  };
  await moCongDoan(process.env.LENH || "LSX26-0006");
  // Đưa dòng "Chuỗi công đoạn" lên đầu màn để thấy khối vật liệu và các dòng đầu của bảng.
  const dau = page.getByText(/^Chuỗi công đoạn/).first();
  await dau.evaluate((e) => e.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(600);
  await khoanh([
    { loc: page.getByRole("button", { name: "Khổ giấy in lấy ở kho" }).first() },
    { loc: page.getByRole("textbox", { name: "Lề trừ mỗi chiều (mm)" }).first().locator("xpath=..") },
    { loc: page.getByRole("columnheader", { name: "Tồn / cần" }).first() },
    { loc: page.getByRole("columnheader", { name: "Bộ phận làm" }).first() },
    { loc: page.getByRole("columnheader", { name: "Làm sau" }).first() },
  ]);
  const b = await main.boundingBox();
  const d = await dau.boundingBox();
  const y = Math.max(d.y - 12, 0);
  await chup("khsx-22-cong-doan", { x: b.x, y, width: b.width, height: 950 - y });
  // Ngăn bước Khuôn hộp: BỘ PHẬN NHẬN + khuôn nằm chung tab Cấu hình & Số lượng.
  await moCongDoan("LSX26-0005");
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

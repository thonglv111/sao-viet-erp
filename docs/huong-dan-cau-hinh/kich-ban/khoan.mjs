// Ảnh tab Khoán của Danh mục công đoạn (mục "Tiền khoán của công đoạn"), chỉ chụp, không lưu gì.
// Chạy trong thư mục này, dùng khung chụp của cuốn Việc của tổ:
//   node ../../huong-dan-viec-cua-to/kich-ban/chup-ui.mjs khoan.mjs ../hinh
// 64-khoan-in: công đoạn In (IN-12), Đơn giá và Bậc giá theo số màu.
// 65-khoan-to, 66-khoan-cong-thuc: công đoạn Khuôn đứt + cấn (KDCC).
// Chụp lại 16/11/2026 sau khi bỏ phần giá khỏi tên tuỳ chọn khi ghi.

async function moKhoan(page, ma) {
  await page.goto(`http://localhost:5173/?man=cong-doan`);
  const tim = page.getByPlaceholder(/Tìm mã/);
  await page.locator("tbody tr td").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
  const o = page.locator("td").filter({ hasText: new RegExp(`^${ma}$`) }).first();
  // Gõ trước khi bảng tải xong thì danh sách không lọc — gõ lại tới khi thấy dòng.
  for (let lan = 0; lan < 5 && !(await o.isVisible()); lan++) {
    await tim.fill("");
    await tim.pressSequentially(ma, { delay: 80 });
    await o.waitFor({ timeout: 15000 }).catch(() => {});
  }
  await page.waitForTimeout(800);
  await o.click();
  const dr = page.locator(".rc-drawer");
  await dr.waitFor();
  await dr.getByRole("button", { name: "Khoán", exact: true }).click();
  await page.waitForTimeout(1500);
  return dr;
}

// Khối section của tab Khoán theo tên đầu khối.
const khoi = (dr, ten) => dr.locator("section.rc-khoan__section")
  .filter({ has: dr.page().locator(".rc-khoan__ten", { hasText: new RegExp(`^${ten}$`) }) }).first();

// Cuộn khối `dau` lên đầu ngăn, cắt từ trên khối đó (chừa `tren` px) tới đáy khối `cuoi`.
async function khung(page, dr, dau, cuoi, tren = 40) {
  await dau.evaluate((e) => e.scrollIntoView({ block: "start" }));
  await page.evaluate(() => { document.querySelector(".rc-drawer__body").scrollTop -= 40; });
  await page.waitForTimeout(500);
  const d = await dr.boundingBox();
  const a = await dau.boundingBox();
  const b = await cuoi.boundingBox();
  const y = Math.max(0, a.y - tren);
  return { x: d.x, y, width: d.width, height: Math.min(b.y + b.height + 12, 950) - y };
}

export default async ({ page, chup, khoanh }) => {
  let dr = await moKhoan(page, "IN-12");
  const donGia = khoi(dr, "Đơn giá");
  const bac = khoi(dr, "Bậc giá theo số màu");
  let k = await khung(page, dr, donGia, bac);
  const oDonVi = donGia.locator("table.rc-bands__table").first();  // ô Đơn vị tính khoán là một bảng một dòng
  await khoanh([{ loc: oDonVi, so: 1 }, { loc: bac, so: 2 }]);
  await chup("64-khoan-in", k);

  dr = await moKhoan(page, "KDCC");
  const giaTo = khoi(dr, "Giá theo tổ");
  const tuyChon = khoi(dr, "Tuỳ chọn khi ghi");
  const phatSinh = khoi(dr, "Việc phát sinh");
  k = await khung(page, dr, giaTo, phatSinh);
  await khoanh([{ loc: giaTo, so: 1 }, { loc: tuyChon, so: 2 }, { loc: phatSinh, so: 3 }]);
  await chup("65-khoan-to", k);

  const ct = dr.locator(".rc-card-section").filter({ has: page.locator(".rc-card-section__title", { hasText: /^Công thức khoán$/i }) }).first();
  await ct.evaluate((e) => e.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(500);
  const d = await dr.boundingBox();
  const c = await ct.boundingBox();
  const oCt = ct.locator(".rc-formula, [class*=formula]").first();
  await khoanh([{ loc: (await oCt.count()) ? oCt : ct, so: 1 }]);
  await chup("66-khoan-cong-thuc", { x: d.x, y: Math.max(0, c.y - 10), width: d.width, height: Math.min(587, 950 - c.y) });
};

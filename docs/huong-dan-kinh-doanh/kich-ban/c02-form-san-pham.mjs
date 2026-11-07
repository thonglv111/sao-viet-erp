// Chương Tính giá: bốn ảnh form sản phẩm (kd-12, kd-13, kd-15, kd-18).
// Chụp lại 07/11/2026 sau khi gỡ hai ô Bleed (tràn lề) và Khe cắt giữa con.
// Chạy: node ../../huong-dan-ke-hoach-sx/kich-ban/chup-ui.mjs c02-form-san-pham.mjs ../hinh
// Chỉ MỞ và XEM, không bấm Xong / Dùng: đóng thẻ có thay đổi là phiếu tự lưu.
// Biến môi trường PHIEU_HOP / PHIEU_TO đổi mã phiếu khi chạy trên dữ liệu khác (vd In Hà Phương).
const PHIEU_HOP = process.env.PHIEU_HOP || "PTG-2026-0011";
const SP_HOP = process.env.SP_HOP || "Hộp mỹ phẩm ghép metalize UV";
const PHIEU_TO = process.env.PHIEU_TO || "PTG-2026-0007";
const SP_TO = process.env.SP_TO || "Tờ phiếu đặt hàng kẹp giữa";

export default async ({ page, chup, khoanh, mo }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Hộp khoanh bao trọn nhiều phần tử: đưa vào `khoanh` như một locator giả.
  const gop = async (...locs) => {
    const bs = [];
    for (const l of locs) bs.push(await l.first().boundingBox());
    const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
    const r = Math.max(...bs.map((b) => b.x + b.width)), d = Math.max(...bs.map((b) => b.y + b.height));
    const box = { x, y, width: r - x, height: d - y };
    return { first: () => ({ boundingBox: async () => box }) };
  };

  const moThe = async (phieu, sp) => {
    await mo("tinh-gia");
    await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
    await page.getByText(phieu, { exact: true }).first().click();
    await page.getByText(sp, { exact: true }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.getByText(sp, { exact: true }).first().click();
    await page.getByRole("button", { name: "Xong", exact: true }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(3000);
  };
  // Cuộn thân thẻ để tiêu đề khối nằm sát mép trên vùng cuộn.
  const cuonToi = async (chu, du = 24) => {
    await page.evaluate(({ chu, du }) => {
      const t = [...document.querySelectorAll(".rc-sec__title")].find((e) => e.textContent.includes(chu));
      const sec = t.closest("section");
      let p = sec.parentElement;
      while (p && !(p.scrollHeight > p.clientHeight + 4 && getComputedStyle(p).overflowY !== "visible")) p = p.parentElement;
      p.scrollTop += sec.getBoundingClientRect().top - p.getBoundingClientRect().top - du;
    }, { chu, du });
    await page.waitForTimeout(600);
  };

  // ---- kd-12: khối 1 + giấy + số tờ ----
  await moThe(PHIEU_HOP, SP_HOP);
  await cuonToi("Sản phẩm", 30);
  await khoanh([
    { nhan: "Tên sản phẩm" },
    { nhan: "Số lượng" },
    { nhan: "Dài chi tiết phẳng" },
    { nhan: "Rộng chi tiết phẳng" },
    { loc: await gop(page.getByText("Số bài in", { exact: true }), page.getByText("tính từ số trang")) },
    { loc: await (async () => {
      const giay = page.locator("section").filter({ has: page.locator(".rc-sec__title", { hasText: "Giấy nguyên" }) }).last();
      return gop(giay.getByText("Giấy", { exact: true }), giay.locator("select, button, input").first(), giay.getByText(/đ \/ kg/));
    })() },
    { loc: page.getByText(/Số tờ máy tự tính/i).last() },
  ]);
  await chup("kd-12-sp-1");

  // ---- kd-13: khối 3 kỹ thuật in ----
  await cuonToi("Kỹ thuật in");
  const chuoi = page.locator(".rc-sec__title").filter({ hasText: "Chuỗi công đoạn" }).first();
  await khoanh([
    { nhan: "Máy in" },
    { nhan: "Quy cách in" },
    { loc: page.getByText("Mực in", { exact: true }).last() },
    { loc: await gop(chuoi, page.getByText(/\d+ công đoạn, \d+ vật tư/).first()) },
    { loc: page.getByText(/Thêm vật tư — gõ tên/).first() },
  ]);
  await chup("kd-13-sp-2");

  // ---- kd-15: phí khuôn, giao hàng, chi phí khác ----
  await cuonToi("Giao hàng", 380);
  await khoanh([
    { loc: page.getByText("Có sẵn", { exact: true }).last() },
    { loc: page.getByText("Làm mới", { exact: true }).last() },
    { loc: await gop(page.getByText("Tổng phí chở hàng").last(), page.getByText("Tổng phí chở hàng").last().locator("xpath=../..").locator("input").first()) },
    { loc: page.getByRole("button", { name: /Thêm khoản chi/ }).last() },
    { loc: page.getByRole("button", { name: "Xong", exact: true }) },
  ]);
  await chup("kd-15-sp-3");

  // ---- kd-18: hộp tính từ số trang (chỉ gõ trong hộp, không bấm Dùng) ----
  await moThe(PHIEU_TO, SP_TO);
  await cuonToi("Sản phẩm", 30);
  await page.getByText("tính từ số trang").first().click();
  await page.waitForTimeout(600);
  const hop = page.locator("div").filter({ has: page.getByText("Trang mỗi tay", { exact: true }) })
    .filter({ has: page.getByRole("button", { name: /^Dùng/ }) }).last();
  const oTrang = hop.locator("input").nth(0);
  await oTrang.fill("64");
  await hop.getByRole("button", { name: /^16 trang$/ }).click();
  await page.waitForTimeout(500);
  await khoanh([
    { loc: page.getByText("tính từ số trang").first() },
    { loc: await gop(hop.getByText("Số trang", { exact: true }), oTrang) },
    { loc: await gop(hop.getByText("Trang mỗi tay", { exact: true }), hop.locator("input").nth(1)) },
    { loc: await gop(hop.getByRole("button", { name: /^8 trang$/ }), hop.getByRole("button", { name: /^32 trang$/ }), hop.getByRole("button", { name: /^16 trang$/ })) },
    { loc: await gop(hop.getByText(/bài in/).first(), hop.getByText(/tay/).last()) },
    { loc: hop.getByRole("button", { name: /^Dùng/ }) },
  ]);
  const vung = await page.evaluate(() => {
    const dai = [...document.querySelectorAll("label,span,div")].find((e) => e.offsetParent && e.textContent.trim() === "Dài chi tiết phẳng");
    const sec = dai.closest("section");
    const s = sec.getBoundingClientRect(), d = dai.getBoundingClientRect();
    return { x: s.x, y: d.y - 66, width: s.width + 30, height: 480 };
  });
  await chup("kd-18-so-trang", vung);
  await page.getByRole("button", { name: "Đóng", exact: true }).click().catch(() => {});
};

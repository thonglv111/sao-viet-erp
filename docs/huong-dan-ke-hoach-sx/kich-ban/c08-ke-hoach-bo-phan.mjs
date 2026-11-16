// Chương Kế hoạch của bộ phận (08/11/2026): mục Tổ in > Kế hoạch, việc In của LSX26-0011 (lệnh đã
// phát, việc đang Chưa giao, máy đang chọn là máy theo báo giá).
// Có GHI dữ liệu: mở khay Giao đổi sang máy khác và gõ lý do (bấm Hủy), rồi ở Kanban bấm "Giao vào
// đây" ở cột máy theo báo giá (giao thật), mở ngăn của việc, cuối cùng Rút lại để trả việc về Chưa giao.
// Ảnh 48d, 48e (12/11/2026, giao nhiều việc một lượt) chụp ở Tổ Cán màng, cần ít nhất hai việc Chưa giao
// cùng công đoạn: tích hai việc, mở khay Giao N việc, chọn máy rồi bấm Hủy — không ghi dữ liệu.
// `BUOC=bang`: chỉ chụp 48, 48d, 48e (không giao thật, không đụng Kanban).
// Lệnh của việc Chưa giao dùng làm mẫu ở Tổ in; bỏ trống thì lấy việc Chưa giao đầu bảng.
let LENH = process.env.LENH || "";
const BO_PHAN = 10; // Tổ in
const BO_PHAN_NHIEU = 16; // Tổ Cán màng
export default async ({ page, chup, khoanh, xoaKhoanh, mo }) => {
  /** Ô của dòng `d` ở cột có tiêu đề `ten` — cột đổi chỗ được nên tìm theo tiêu đề, không theo vị trí. */
  const oCot = async (d, ten) => {
    const tieuDe = await page.locator("table.khbp-g2 thead th").allTextContents();
    return d.locator("td").nth(tieuDe.findIndex((t) => t.trim() === ten));
  };
  const giaoNhieu = async () => {
    await xoaKhoanh();
    // Đoạn Kanban phía trên để màn nhớ cách xem Kanban — trả về Bảng việc trước khi mở.
    await page.evaluate(() => { try { localStorage.setItem("khbp.xem", "bang"); } catch { /* */ } });
    await mo(`ke-hoach-bo-phan%3A${BO_PHAN_NHIEU}`);
    await page.getByRole("button", { name: /^Chưa giao/ }).first().click();
    await page.waitForTimeout(900);
    // Hai việc cùng công đoạn với việc đầu tiên còn ô tích.
    const cd = (await (await oCot(page.locator("tr.khbp-dong").first(), "Công đoạn")).textContent())?.trim() ?? "";
    const cung = page.locator("tr.khbp-dong").filter({ hasText: cd }).filter({ has: page.locator("input.lds-cb") });
    for (let i = 0; i < 2; i++) await cung.nth(i).locator("input.lds-cb").check();
    await page.waitForTimeout(400);
    await khoanh([
      { loc: page.locator("table.khbp-g2 thead th").first(), so: 1 },
      { loc: page.locator(".khbp-chon-noi") , so: 2 },
    ]);
    const bar = await page.locator(".khbp-chon-noi").boundingBox();
    await chup("khsx-48d-chon-nhieu", { x: 0, y: 0, width: 1440, height: Math.round(bar.y + bar.height + 16) });
    await xoaKhoanh();
    await page.locator(".khbp-chon-noi button").last().click();
    await page.locator(".hg--giao").waitFor();
    await page.locator(".hg--giao .hg__may").filter({ hasNotText: "Làm tay" }).last().click();
    await page.waitForTimeout(500);
    await khoanh([
      { loc: page.locator(".hg--giao .hg__tags"), pad: 2 },
      { loc: page.locator(".hg--giao .hg__ds"), pad: 2 },
      { loc: page.locator(".hg--giao .hg__muc").nth(1), pad: 2 },
      { loc: page.locator(".hg--giao .hg__muc").filter({ has: page.locator(".hg__ghichu") }), pad: 2 },
      { loc: page.locator(".hg__chan button").last() },
    ]);
    const hg = await page.locator(".hg").boundingBox();
    await chup("khsx-48e-giao-nhieu", { x: hg.x - 16, y: hg.y - 16, width: hg.width + 32, height: hg.height + 32 });
    await page.locator(".hg__chan button").first().click();
    await page.waitForTimeout(400);
  };

  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  await page.evaluate(() => { try { localStorage.setItem("khbp.xem", "bang"); } catch { /* */ } });
  await mo(`ke-hoach-bo-phan%3A${BO_PHAN}`);
  await page.getByRole("button", { name: /^Chưa giao/ }).first().click();
  await page.waitForTimeout(800);
  await page.locator("tr.khbp-dong").first().waitFor();
  if (!LENH) LENH = (await page.locator("tr.khbp-dong").first().locator(".khbp-g2__1").first().textContent())?.trim() ?? "";
  const dong = () => page.locator("tr.khbp-dong").filter({ hasText: LENH }).first();
  await dong().waitFor();

  // Ảnh 48a: mục Kế hoạch của Tổ in trên thanh bên, và Tổ Cán màng (bộ phận tự làm) thành nhóm.
  const mucKh = page.locator(".sidebar__label").filter({ hasText: /^Kế hoạch$/ }).first().locator("xpath=ancestor::button[1]");
  await mucKh.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const toIn = page.locator(".sidebar__label").filter({ hasText: /^Tổ in$/ }).first().locator("xpath=ancestor::button[1]");
  const vcCanMang = page.locator(".sidebar__label").filter({ hasText: /^Việc của tổ$/ }).first().locator("xpath=ancestor::button[1]");
  await khoanh([{ loc: mucKh }, { loc: vcCanMang }]);
  const t = await toIn.boundingBox();
  const c = await vcCanMang.boundingBox();
  await chup("khsx-48a-thanh-ben", { x: 0, y: t.y - 60, width: 366, height: c.y + c.height - t.y + 80 });

  // Ảnh 48: Bảng việc, chip, cột Giấy + SL kế hoạch, cột Máy, nút Giao.
  await khoanh([
    { loc: page.locator(".khbp-xem"), so: 1 },
    { loc: page.locator(".khbp-dem"), so: 2 },
    { loc: await oCot(dong(), "Giấy"), so: 3 },
    { loc: await oCot(dong(), "SL kế hoạch"), so: 3 },
    { loc: await oCot(dong(), "Máy"), so: 4 },
    { loc: dong().getByRole("button", { name: "Giao", exact: true }), so: 5 },
  ]);
  await chup("khsx-48-bo-phan", { x: 0, y: 0, width: 1440, height: 380 });
  if (process.env.BUOC === "bang") { await giaoNhieu(); return; }

  // Ảnh 48b: hộp Giao giữa màn, đổi sang máy khác máy theo báo giá thì phải ghi lý do; gõ thử ô Ghi chú
  // kế hoạch rồi bấm Hủy (không lưu).
  await dong().getByRole("button", { name: "Giao", exact: true }).click();
  await page.locator(".hg--giao").waitFor();
  await page.locator(".hg__may").filter({ hasText: "Máy in 5 màu" }).first().click();
  await page.locator(".hg__lydo").pressSequentially("Máy 4 màu đang chờ sửa", { delay: 25 });
  await page.locator(".hg__ghichu").fill("");
  await page.locator(".hg__ghichu").pressSequentially("Chạy trước 10 giờ, khách lấy chiều nay", { delay: 20 });
  await page.waitForTimeout(400);
  await khoanh([
    { loc: page.locator(".hg--giao .hg__ds"), pad: 2 },
    { loc: page.locator(".hg--giao .hg__ly"), pad: 2 },
    { loc: page.locator(".hg--giao .hg__muc").nth(1), pad: 2 },
    { loc: page.locator(".hg--giao .hg__muc").filter({ has: page.locator(".hg__ghichu") }), pad: 2 },
    { loc: page.locator(".hg__chan button").last() },
  ]);
  const hg = await page.locator(".hg").boundingBox();
  await chup("khsx-48b-ly-do", { x: hg.x - 16, y: hg.y - 16, width: hg.width + 32, height: hg.height + 32 });
  await page.locator(".hg__chan button").first().click();
  await page.waitForTimeout(600);

  // Ảnh 48c: Kanban, chọn việc ở cột Chờ giao, máy nhận được sáng nút Giao vào đây. Máy chưa có việc
  // gom thành dải chip (công tắc Máy trống thành cột đang tắt).
  await page.evaluate(() => { try { localStorage.setItem("khbp.trongcot", "0"); } catch { /* */ } });
  await page.getByRole("tab", { name: "Kanban" }).click();
  await page.waitForTimeout(1200);
  await page.locator(".kb-cho .cg-dong").filter({ hasText: LENH }).first().click();
  await page.waitForTimeout(600);
  const nutGia = page.locator(".kb-giao, .kb-trong__giao").filter({ hasText: "theo báo giá" }).first();
  await khoanh([
    { loc: page.locator(".kb-cho") },
    { loc: page.locator(".kb-trong") },
    { loc: page.locator(".khbp-gat") },
    { loc: page.locator(".kb-cot .kb-dau").first() },
    { loc: nutGia },
  ]);
  const kb = await page.locator(".khbp").first().boundingBox();
  await chup("khsx-48c-kanban", { x: kb.x, y: kb.y, width: Math.min(kb.width, 1440 - kb.x), height: 560 });

  // Giao thật vào máy theo báo giá rồi mở ngăn của việc.
  await nutGia.click();
  await page.waitForTimeout(1800);
  // Thẻ đã sang cột máy (thẻ ở Chờ giao có lớp cg-dong, bấm vào chỉ là chọn việc).
  const theMay = page.locator(".kb-the:not(.cg-dong)").filter({ hasText: LENH }).first();
  await theMay.waitFor();
  await theMay.click();
  const ngan = page.locator(".thsx-panel--open");
  await ngan.getByRole("button", { name: "Rút lại", exact: true }).first().waitFor();
  await page.waitForTimeout(1200);
  await khoanh([
    { loc: ngan.getByRole("button", { name: "Rút lại", exact: true }).first() },
    { loc: ngan.locator("[role=tablist]").first(), pad: 0 },
  ]);
  const n = await ngan.boundingBox();
  await chup("khsx-49-ngan-quy-cach", { x: n.x - 20, y: 0, width: Math.min(n.width + 20, 1440 - n.x + 20), height: 440 });
  // Trả việc về Chưa giao để chạy lại được.
  await ngan.getByRole("button", { name: "Rút lại", exact: true }).first().click();
  await page.waitForTimeout(1500);
  await giaoNhieu();
};

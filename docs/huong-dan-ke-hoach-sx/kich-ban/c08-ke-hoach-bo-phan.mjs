// Chương Kế hoạch của bộ phận (08/11/2026): mục Tổ in > Kế hoạch, việc In của LSX26-0011 (lệnh đã
// phát, việc đang Chưa giao, máy đang chọn là máy theo báo giá).
// Có GHI dữ liệu: mở khay Giao đổi sang máy khác và gõ lý do (bấm Hủy), rồi ở Kanban bấm "Giao vào
// đây" ở cột máy theo báo giá (giao thật), mở ngăn của việc, cuối cùng Rút lại để trả việc về Chưa giao.
const LENH = "LSX26-0011";
const BO_PHAN = 10; // Tổ in
export default async ({ page, chup, khoanh, mo }) => {
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  await page.evaluate(() => { try { localStorage.setItem("khbp.xem", "bang"); } catch { /* */ } });
  await mo(`ke-hoach-bo-phan%3A${BO_PHAN}`);
  await page.getByRole("button", { name: /^Chưa giao/ }).first().click();
  await page.waitForTimeout(800);
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

  // Ảnh 48: Bảng việc, chip, dòng việc, nút Giao.
  await khoanh([
    { loc: page.locator(".khbp-xem") },
    { loc: page.locator(".khbp-dem") },
    { loc: dong().locator("td").nth(4) },
    { loc: dong().getByRole("button", { name: "Giao", exact: true }) },
  ]);
  await chup("khsx-48-bo-phan", { x: 0, y: 0, width: 1440, height: 380 });

  // Ảnh 48b: hộp Giao giữa màn, đổi sang máy khác máy theo báo giá thì phải ghi lý do.
  await dong().getByRole("button", { name: "Giao", exact: true }).click();
  await page.locator(".hg--giao").waitFor();
  await page.locator(".hg__may").filter({ hasText: "Máy in 5 màu" }).first().click();
  await page.locator(".hg__lydo").pressSequentially("Máy 4 màu đang chờ sửa", { delay: 25 });
  await page.waitForTimeout(400);
  await khoanh([
    { loc: page.locator(".hg--giao .hg__ds"), pad: 2 },
    { loc: page.locator(".hg--giao .hg__ly"), pad: 2 },
    { loc: page.locator(".hg--giao .hg__muc").nth(1), pad: 2 },
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
};

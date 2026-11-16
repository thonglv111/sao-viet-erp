// Chương 6: Thuê gia công (spec 2026-11-13). Màn lệnh chỉ gắn cờ; đặt, giao, nhận làm ở màn Thuê gia công.
// BUOC=1: khối "Thuê gia công" chỉ đọc trên LSX26-0009 (một phần, đơn GC26-0006) và LSX26-0019 (trọn gói).
// BUOC=2: hộp "Thuê gia công trọn gói" trên lệnh Nháp `LENH` (mặc định LSX26-0010). DAT=1 thì bấm xác nhận
//         (GHI DB: lệnh sang Đã phát hành, việc vào Hàng chờ), không đặt thì bấm Hủy.
// BUOC=3: màn Thuê gia công: Hàng chờ, hộp Lập đơn (không lưu), ngăn đơn GC26-0006, hộp Phiếu giao và
//         hộp Nhận hàng của GC26-0007 (không lưu), tab Phiếu nhận. Chỉ đọc.
// BUOC=3n: như 3 nhưng bỏ Hàng chờ, hộp Lập đơn, hộp Phiếu giao (không cần việc trong Hàng chờ): chụp lại
//          ngăn đơn GC26-0006 và hộp Nhận hàng của GC26-0007. Chỉ đọc.
// BUOC=4: tab Chờ trả tiền, tick phiếu nhận đầu bảng. Chỉ đọc, không lập phiếu chi.
import { moLenh } from "./c03a-ra-lenh.mjs";
const BUOC = process.env.BUOC || "1";
export default async ({ page, chup, khoanh, mo }) => {
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  const nut = (re) => page.locator("button:visible").filter({ hasText: re });
  const hop = async (loc, pad = 12) => {
    const r = await loc.boundingBox();
    return { x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad };
  };
  const hopThoai = () => page.locator("[role=dialog]:visible").last();

  if (BUOC === "1") {
    await moLenh(page, mo, "LSX26-0009");
    const k = page.locator("section.tgc-khoi").first();
    await k.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await khoanh([
      { loc: k.locator(".lds-chip, [class*=chip]").first() },
      { loc: k.locator(".tgc-khoi__nha").first() },
      { loc: k.getByRole("button", { name: /^Đơn GC/ }).first() },
    ]);
    await chup("khsx-50-gia-cong-mot-phan", await hop(k));
    await moLenh(page, mo, "LSX26-0019");
    const k2 = page.locator("section.tgc-khoi").first();
    await k2.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await khoanh([
      { loc: page.getByText(/^Đã phát hành$/).first() },
      { loc: k2.locator(".tgc-khoi__dong").first() },
    ]);
    const m = await page.locator("main").first().boundingBox();
    const g = await k2.boundingBox();
    await chup("khsx-52-tron-goi-sau-dat", { x: m.x, y: m.y, width: m.width, height: g.y + g.height + 12 - m.y });
    return;
  }

  if (BUOC === "2") {
    await moLenh(page, mo, process.env.LENH || "LSX26-0010");
    await nut(/Thuê gia công trọn gói/).first().click();
    const d = hopThoai();
    await d.waitFor();
    await page.waitForTimeout(600);
    await khoanh([{ loc: d.getByRole("button", { name: "Thuê gia công trọn gói" }) }]);
    await chup("khsx-51-dat-tron-goi", await hop(d, 20));
    if (process.env.DAT === "1") {
      await d.getByRole("button", { name: "Thuê gia công trọn gói" }).click();
      await page.waitForTimeout(3000);
    } else {
      await d.getByRole("button", { name: /^Hủy$/ }).click();
    }
    return;
  }

  if (BUOC === "4") {
    await mo("thue-gia-cong");
    const m4 = page.locator("main").first();
    await page.getByRole("tab", { name: "Chờ trả tiền" }).click();
    await page.waitForTimeout(1200);
    await m4.locator("input[aria-label^='Chọn phiếu nhận']").first().check();
    await page.waitForTimeout(600);
    await khoanh([
      { loc: page.getByRole("tab", { name: "Chờ trả tiền" }) },
      { loc: m4.locator("input[aria-label^='Chọn phiếu nhận']").first() },
      { loc: m4.locator("th").filter({ hasText: "Tạm tính" }).first() },
      { loc: nut(/^Lập một phiếu chi$/) },
    ]);
    const b = await m4.boundingBox();
    const c = await page.locator(".kt-gop-chan").boundingBox();
    await chup("khsx-58-cho-tra-tien", { x: b.x, y: b.y, width: b.width, height: c.y + c.height + 16 - b.y });
    return;
  }

  // BUOC=3: màn Thuê gia công.
  await mo("thue-gia-cong");
  const main = page.locator("main").first();
  const vungMan = async () => {
    const b = await main.boundingBox();
    return { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 520) };
  };
  await page.waitForTimeout(1000);
  if (BUOC === "3") {
  await main.locator("input[type=checkbox]").first().check();
  await page.waitForTimeout(600);
  await khoanh([
    { loc: page.getByRole("tab", { name: "Hàng chờ" }) },
    { loc: main.locator("[aria-label='Lọc hàng chờ theo tình trạng']").first() },
    { loc: main.locator("input[type=checkbox]").first() },
    { loc: nut(/Tạo đơn gia công/) },
  ]);
  await chup("khsx-53-hang-cho", await vungMan());

  await nut(/Tạo đơn gia công/).first().click();
  const lap = hopThoai();
  await lap.waitFor();
  // Ô Nhà gia công là danh sách riêng (16/11/2026): bấm ô rồi chọn một dòng; danh sách treo ở body.
  const oNha = lap.getByRole("button", { name: "Nhà gia công", exact: true });
  await oNha.click();
  await page.getByRole("option", { name: "Xưởng Gia công Bế hộp Minh Phát" }).click();
  await page.waitForTimeout(800);
  await khoanh([
    { loc: oNha },
    { loc: lap.locator("input[aria-label='Ngày hẹn về']") },
    { loc: lap.locator("input[aria-label^='Số đặt']").first() },
    { loc: lap.locator("input[aria-label^='Đơn giá']").first() },
    { loc: lap.getByRole("button", { name: "Đặt hàng" }) },
  ]);
  await chup("khsx-54-lap-don", await hop(lap, 20));
  await lap.getByRole("button", { name: "Đóng" }).last().click();

  }
  await page.getByRole("tab", { name: "Đơn gia công" }).click();
  await page.waitForTimeout(1500);
  await main.getByText("GC26-0006", { exact: true }).first().click();
  await page.waitForTimeout(1500);
  const ngan = page.locator("aside").filter({ hasText: "GC26-0006" }).last();
  // Dòng đơn là khối (16/11/2026): số nằm trong lưới có nhãn, hụt ghi "Hụt …" dưới Đã nhận.
  await khoanh([
    { loc: ngan.getByText(/^Hoàn tất$/).first() },
    { loc: ngan.getByRole("tab", { name: /Phiếu nhận/ }) },
    { loc: ngan.locator(".tgc-dd__so") },
    { loc: ngan.getByRole("button", { name: /Mở lại/ }) },
  ]);
  await chup("khsx-55-ngan-don", { ...(await hop(ngan, 0)), height: 640 });

  await page.keyboard.press("Escape");
  await main.getByText("GC26-0007", { exact: true }).first().click();
  await page.waitForTimeout(1500);
  const ngan7 = page.locator("aside").filter({ hasText: "GC26-0007" }).last();
  if (BUOC === "3") {
  await ngan7.getByRole("button", { name: "Giao hàng" }).click();
  const giao = hopThoai();
  await giao.waitFor();
  await page.waitForTimeout(1200);
  await khoanh([
    { loc: giao.locator("section").first() },
    { loc: giao.getByRole("button", { name: /Lưu phiếu giao/ }) },
  ]);
  await chup("khsx-56-phieu-giao", await hop(giao, 20));
  await giao.getByRole("button", { name: "Đóng" }).last().click();
  }

  await ngan7.getByRole("button", { name: "Nhận hàng" }).click();
  const nhan = hopThoai();
  await nhan.waitFor();
  const dat = nhan.locator("input[aria-label^='Số đạt']").first();
  await dat.waitFor();
  await page.waitForTimeout(1000);
  await dat.click();
  await dat.pressSequentially("500", { delay: 60 });
  await page.waitForTimeout(600);
  await khoanh([
    { loc: dat },
    { loc: nhan.locator("input[aria-label^='Số hỏng']").first() },
    { loc: nhan.getByText("Tạm tính", { exact: true }).locator("xpath=..") },
    { loc: nhan.getByText("Nơi về", { exact: true }).locator("xpath=..") },
    { loc: nhan.getByRole("button", { name: "Lưu phiếu nhận" }) },
  ]);
  await chup("khsx-57-phieu-nhan", await hop(nhan, 20));
  await nhan.getByRole("button", { name: "Đóng" }).last().click();
};

// Chương 6: Gia công ngoài.
// BUOC=1: khối Gia công ngoài của LSX26-0007 (một phần, Chờ mang đi).
// BUOC=2: LSX26-0008 đặt gia công trọn gói (Minh Phát, xưởng cấp giấy), chụp hộp + khối sau đặt.
// BUOC=3: LSX26-0008 Chọn giấy, chụp phần chọn, gửi đề nghị xuất giấy, chụp sau.
// BUOC=4: LSX26-0008 Đã mang đi (gõ số), chụp ô gõ và sau ghi.
import { moLenh } from "./c03a-ra-lenh.mjs";
const BUOC = process.env.BUOC || "1";
export default async ({ page, chup, khoanh, mo }) => {
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  const nut = (re) => page.locator("button:visible").filter({ hasText: re });
  const gcn = page.locator("section.gcn").first();
  const hopGcn = async (them = 0) => {
    const r = await gcn.boundingBox();
    return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 + them };
  };
  if (BUOC === "1") {
    await moLenh(page, mo, "LSX26-0007");
    await gcn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await khoanh([
      { loc: gcn.getByText("Chờ mang đi").first() },
      { loc: gcn.getByText("Nhà gia công", { exact: true }).first().locator("xpath=..") },
      { loc: gcn.getByText(/Chờ bước trước bàn giao/).first() },
      { loc: gcn.getByText(/^Lịch sử/).first() },
    ]);
    await chup("khsx-50-gia-cong-mot-phan", await hopGcn());
    return;
  }
  await moLenh(page, mo, "LSX26-0008");
  if (BUOC === "2") {
    if (process.env.CHI_CHUP !== "1") {
    await nut(/Gia công trọn gói/).first().click();
    await page.getByText("Chọn nhà gia công").waitFor();
    await page.getByText("Chọn nhà gia công").click();
    await page.getByText("Xưởng Gia công Bế hộp Minh Phát").click();
    await page.waitForTimeout(800);
    const dlg = page.locator("[role=dialog]").last();
    await khoanh([
      { loc: dlg.getByText("Nhà gia công", { exact: true }).locator("xpath=..") },
      { loc: dlg.getByText("Số đặt", { exact: true }).locator("xpath=..") },
      { loc: dlg.getByText("Xưởng cấp giấy", { exact: true }).locator("xpath=../..") },
      { loc: nut(/Đặt gia công trọn gói/) },
    ]);
    const d = await dlg.boundingBox();
    await chup("khsx-51-dat-tron-goi", { x: d.x - 20, y: d.y - 20, width: d.width + 40, height: d.height + 40 });
    await nut(/Đặt gia công trọn gói/).click();
    await page.waitForTimeout(3500);
    }
    await gcn.waitFor();
    await gcn.scrollIntoViewIfNeeded();
    await khoanh([
      { loc: page.getByText(/^Đã phát hành$/).first() },
      { loc: gcn.getByText("Đang ở nhà gia công").first() },
      { loc: gcn.getByText(/Chưa cấp giấy cho nhà gia công/).first().locator("xpath=../..") },
      { loc: nut(/Huỷ gia công/) },
    ]);
    const m = await page.locator("main").first().boundingBox();
    const g = await gcn.boundingBox();
    await chup("khsx-52-tron-goi-sau-dat", { x: m.x, y: m.y, width: m.width, height: g.y + g.height + 12 - m.y });
  } else if (BUOC === "3") {
    await gcn.scrollIntoViewIfNeeded();
    await nut(/^Chọn giấy$/).click();
    await page.waitForTimeout(1500);
    await khoanh([
      { loc: gcn.locator("[role=radiogroup][aria-label='Khổ trong kho']") },
      { loc: gcn.locator("input[aria-label$='xin xuất']") },
      { loc: gcn.getByText(/Vẫn gửi được/).first() },
      { loc: nut(/Gửi đề nghị xuất giấy/) },
    ]);
    await chup("khsx-53-chon-giay", await hopGcn());
    await nut(/Gửi đề nghị xuất giấy/).click();
    await page.waitForTimeout(3500);
    await khoanh([
      { loc: gcn.getByText(/Chờ kho soạn|Kho đã nhận|Kho đang soạn/).first() },
      { loc: nut(/Nhận hàng về/) },
    ]);
    await chup("khsx-54-da-gui-de-nghi-giay", await hopGcn());
  } else if (BUOC === "4") {
    await gcn.scrollIntoViewIfNeeded();
    const o = gcn.locator("input[aria-label^='Số mang đi']").first();
    await o.click();
    await o.press("Control+a");
    await o.pressSequentially("5000", { delay: 40 });
    await page.waitForTimeout(500);
    await khoanh([{ loc: o }, { loc: nut(/^Đã mang đi$/) }]);
    await chup("khsx-55-mang-di", await hopGcn());
    await nut(/^Đã mang đi$/).click();
    await page.waitForTimeout(3500);
    await khoanh([
      { loc: gcn.getByText("Đang ở nhà gia công").first() },
      { loc: nut(/Nhận hàng về/) },
    ]);
    await chup("khsx-56-dang-o-nha-gia-cong", await hopGcn());
  }
};

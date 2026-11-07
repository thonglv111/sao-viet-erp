// Chương 5: Xếp lịch. BUOC=1: khay + kéo LSX26-0007 thả vào T6 6/11 (chụp lúc đang thả và sau thả).
// BUOC=2: mở ngăn lệnh trên lưới (chưa phát hành). BUOC=3: Phát hành, chụp toast + ngăn đã phát hành + Lịch sử phát hành.
const BUOC = process.env.BUOC || "1";
export default async ({ page, chup, khoanh, mo }) => {
  if (BUOC !== "3") await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  await mo("xep-lich");
  await page.getByText("Chờ xếp lịch").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  const b = { x: 244, y: 56, width: 1440 - 244, height: 950 - 56 };
  const ngan = async () => page.getByText("Lịch sử phát hành").first().evaluate((e) => {
    let p = e; while (p && p.getBoundingClientRect().height < innerHeight * 0.9) p = p.parentElement;
    const r = p.getBoundingClientRect(); return { x: r.x, y: 0, width: Math.min(r.width, innerWidth - r.x), height: innerHeight };
  });
  const moNgan = async () => {
    await page.locator("main").getByText("LSX26-0007").first().click();
    await page.getByText("Lịch sử phát hành").first().waitFor();
    await page.waitForTimeout(2500);
  };
  const the = page.locator("[draggable=true]").filter({ hasText: "LSX26-0007" }).first();
  if (BUOC === "1") {
    await khoanh([
      { loc: page.getByRole("button", { name: /Chờ xếp lịch/ }).first() },
      { loc: page.getByText(/Tuần/).first().locator("xpath=..") },
      { loc: the },
      { loc: the.getByText(/giữ|thiếu/i).first() },
      { loc: page.getByText(/Kéo một lệnh thả vào/).first() },
      { loc: page.getByRole("button", { name: /Khoá máy/ }).first() },
    ]);
    await chup("khsx-40-khay", { x: b.x, y: b.y, width: b.width, height: b.height });
    const tb = await the.boundingBox();
    const cot = await page.getByText(/^T6 6\/11$/).first().boundingBox()
      .catch(() => null) || await page.getByText("6/11").first().boundingBox();
    const tx = cot.x + 8, ty = cot.y + 120;
    await page.mouse.move(tb.x + 40, tb.y + 20);
    await page.mouse.down();
    for (let i = 1; i <= 15; i++) {
      await page.mouse.move(tb.x + 40 + ((tx - tb.x - 40) * i) / 15, tb.y + 20 + ((ty - tb.y - 20) * i) / 15);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(1500);
    await chup("khsx-41-dang-tha", { x: b.x, y: b.y, width: b.width, height: 480 });
    await page.mouse.up();
    await page.waitForTimeout(3000);
    await khoanh([
      { loc: page.locator("main").getByText("LSX26-0007").first().locator("xpath=../..") },
      { loc: page.getByText(/^14:00$/).first() },
      { loc: page.locator("button:visible").filter({ hasText: /Có thể xong muộn hơn/ }).first() },
      { loc: page.locator("button:visible").filter({ hasText: /^Chưa phát hành/ }).first() },
    ]);
    await chup("khsx-42-sau-tha", { x: b.x, y: b.y, width: b.width, height: 480 });
  } else if (BUOC === "2") {
    await moNgan();
    const nut = (re) => page.locator("button:visible").filter({ hasText: re });
    await khoanh([
      { loc: page.getByText("Bắt đầu", { exact: true }).first().locator("xpath=..") },
      { loc: page.getByText(/Chưa tính được giờ ở/).first() },
      { loc: page.getByText("Hạn xong sản xuất").first().locator("xpath=..") },
      { loc: page.getByText("Gia công ngoài").first() },
      { loc: page.getByText(/còn thiếu \d+ mặt hàng/).last() },
      { loc: nut(/Bỏ lịch/) },
      { loc: nut(/^Phát hành$/) },
    ]);
    await chup("khsx-43-ngan-lenh", await ngan());
    if (process.env.BOLICH === "1") {
      await nut(/Bỏ lịch/).click();
      await page.waitForTimeout(2500);
    }
  } else if (BUOC === "4") {
    // Chỉ chụp lại ngăn đã phát hành, không bấm gì.
    await moNgan();
    const nut = (re) => page.locator("button:visible").filter({ hasText: re });
    await khoanh([
      { loc: nut(/Thu hồi phát hành/) },
      { loc: nut(/Phát hành cập nhật/) },
    ]);
    await chup("khsx-45-ngan-da-phat-hanh", await ngan());
  } else if (BUOC === "3") {
    await moNgan();
    const nut = (re) => page.locator("button:visible").filter({ hasText: re });
    if (await nut(/Thu hồi phát hành/).count()) {
      await khoanh([
        { loc: page.getByText("Folder A4 cán mờ ép kim").first().locator("xpath=..") },
        { loc: nut(/Thu hồi phát hành/) },
      ]);
      await chup("khsx-45-ngan-da-phat-hanh", await ngan());
      await nut(/Thu hồi phát hành/).click();
      await page.locator("#xa-ly-do").waitFor();
      await page.locator("#xa-ly-do").pressSequentially("Khách đổi ngày giao, xếp lại", { delay: 30 });
      await page.waitForTimeout(600);
      await chup("khsx-47-thu-hoi");
      await page.locator("button:visible").filter({ hasText: /^Thu hồi$/ }).last().click();
      await page.waitForTimeout(3500);
    }
    await nut(/^Phát hành$/).click();
    await page.getByText(/Đã phát hành xuống xưởng/).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await khoanh([{ loc: page.getByText(/Đã phát hành xuống xưởng/).first() }]);
    await chup("khsx-44-toast-phat-hanh");
    await page.getByText("Lịch sử phát hành").first().click();
    await page.waitForTimeout(2000);
    await chup("khsx-46-lich-su-phat-hanh", await ngan());
  }
};

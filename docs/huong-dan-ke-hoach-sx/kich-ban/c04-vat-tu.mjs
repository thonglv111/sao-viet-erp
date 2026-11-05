// Chương 4: Kế hoạch vật tư. BUOC=1: trước/sau Giữ hàng của LSX26-0007. BUOC=2: tick dòng Cần mua, Đề nghị mua, chụp form.
const BUOC = process.env.BUOC || "1";
export default async ({ page, chup, khoanh, mo }) => {
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  await mo("ke-hoach-vat-tu");
  await page.getByText("LSX26-0007").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  const main = page.locator("main").first();
  const b = await main.boundingBox();
  const nhom = page.locator("tr").filter({ hasText: "LSX26-0007" }).first();
  const dong = (re) => page.locator("tr").filter({ hasText: re }).first();
  if (BUOC === "1") {
    await khoanh([
      { loc: page.getByText(/^Tất cả/).first().locator("xpath=..") },
      { loc: page.getByText("Xem theo").first().locator("xpath=..") },
      { loc: nhom.getByRole("button", { name: "Giữ hàng" }) },
      { loc: dong(/Giấy Couche/).getByText("Cần mua") },
      { loc: dong(/Kẽm CTP/).getByText("Chưa giữ") },
    ]);
    await chup("khsx-30-vat-tu-truoc", { x: b.x, y: b.y, width: b.width, height: 540 });
    await nhom.getByRole("button", { name: "Giữ hàng" }).click();
    await page.waitForTimeout(3000);
    await khoanh([{ loc: dong(/Kẽm CTP/).locator("td").last().locator("xpath=preceding-sibling::td[1]") }]);
    await chup("khsx-31-vat-tu-sau-giu", { x: b.x, y: b.y, width: b.width, height: 540 });
  } else {
    await dong(/Giấy Couche/).locator("input[type=checkbox]").check();
    await page.waitForTimeout(800);
    await khoanh([
      { loc: dong(/Giấy Couche/).locator("input[type=checkbox]") },
      { loc: page.getByText(/Đã chọn \d+ dòng/).first().locator("xpath=..") },
      { loc: page.getByRole("button", { name: /Đề nghị mua/ }).first() },
    ]);
    await chup("khsx-32-chon-de-nghi", { x: b.x, y: b.y, width: b.width, height: 600 });
    await page.getByRole("button", { name: /Đề nghị mua/ }).first().click();
    await page.getByText("Tạo yêu cầu mua hàng").first().waitFor();
    await page.waitForTimeout(2500);
    const nganBox = await page.getByText("Tạo yêu cầu mua hàng").first().evaluate((e) => {
      let p = e; while (p && p.getBoundingClientRect().height < innerHeight * 0.9) p = p.parentElement;
      const r = p.getBoundingClientRect(); return { x: r.x, y: 0, width: Math.min(r.width, innerWidth - r.x), height: 560 };
    });
    await khoanh([
      { loc: page.getByText("Ngày cần hàng").first().locator("xpath=..") },
      { loc: page.getByRole("button", { name: "+7 ngày" }) },
      { loc: page.getByText("Nội dung, mục đích").first().locator("xpath=..") },
      { loc: page.getByText("Cho lệnh SX").first().locator("xpath=..") },
      { loc: page.getByText("Số lượng mua").first() },
    ]);
    await chup("khsx-33-form-ycmh", nganBox);
    if (process.env.GUI === "1") {
      await page.getByRole("button", { name: "+7 ngày" }).click();
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: /Gửi yêu cầu/ }).click();
      await page.waitForTimeout(3500);
      await mo("ke-hoach-vat-tu");
      await page.getByText("LSX26-0007").first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(2000);
      await khoanh([
        { loc: dong(/Giấy Couche/).locator("td").nth(5) },
        { loc: dong(/Giấy Couche/).locator("td").nth(6) },
        { loc: dong(/Giấy Couche/).getByText("Đang mua") },
      ]);
      await chup("khsx-34-vat-tu-dang-mua", { x: b.x, y: b.y, width: b.width, height: 540 });
    }
  }
};

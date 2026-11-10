// Chương 2: ngăn Lệnh dự kiến, rồi bấm Xác nhận tạo lệnh (TAO=1). Đơn đọc ở biến DON (mặc định DH003),
// chụp bằng tài khoản người phụ trách đơn đó: CHUP_USER/CHUP_MK.
const DON = process.env.DON || "DH003";
export default async ({ page, chup, khoanh, mo }) => {
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  await mo("ke-hoach-sx");
  // Từ 08/11/2026 lệnh tạo ở tab Tạo lệnh (đơn phải đã giao cho người phụ trách).
  await page.getByRole("tab", { name: /Tạo lệnh/ }).click();
  await page.getByText(DON).first().waitFor({ timeout: 20000 });
  // Ảnh hàng chờ khsx-10 chuyển sang c02b-giao-don.mjs (08/11/2026, có cột tick và chip Giao đơn).
  const dong = page.getByRole("row").filter({ hasText: DON }).first();
  await page.setViewportSize({ width: 1440, height: 700 });
  await dong.click();
  await page.getByRole("button",{name:/Xác nhận tạo/}).waitFor({ timeout: 15000 });
  await page.waitForTimeout(2500);
  // Chuột còn đứng ở chỗ vừa bấm sẽ bật tooltip ô bảng trong ngăn; đưa ra góc trái trên.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1500);
  const hop = page.locator("aside.khsx-drawer").last();
  await khoanh([
    { loc: hop.getByText(/Số dưới đây máy/) },
    { loc: hop.getByRole("checkbox").nth(1) },
    { loc: hop.locator("th", { hasText: /^Vào máy$/ }) },
    { loc: hop.locator("tbody tr").first().locator("td").last() },
    { loc: hop.getByRole("button", { name: /Xác nhận tạo/ }) },
  ]);
  const h = await hop.boundingBox();
  await chup("khsx-11-lenh-du-kien", { x: h.x, y: 0, width: h.width, height: 700 });
  if (process.env.TAO === "1") {
    await hop.getByRole("button", { name: /Xác nhận tạo/ }).click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: process.argv[3] + "/_sau-tao.png" });
  }
};

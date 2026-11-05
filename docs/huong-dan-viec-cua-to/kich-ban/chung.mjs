// Hàm dùng chung cho các kịch bản chụp cuốn Việc của tổ và KCS.

// Mở Việc của tổ (`man` = "thuc-hien-sx:<id tổ>"), bấm vào việc của lệnh `ma` (dòng thứ `thu` nếu
// lệnh có nhiều việc ở tổ đó), trả về locator ngăn chi tiết đang mở.
export async function moViec(page, man, ma, thu = 0) {
  await page.goto(`http://localhost:5173/?man=${man}`);
  await page.getByText(ma, { exact: true }).nth(thu).waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await page.getByText(ma, { exact: true }).nth(thu).click();
  const ngan = page.locator("aside.thsx-panel--open");
  await ngan.waitFor();
  await page.waitForTimeout(1500);
  return ngan;
}

// Mở một tab của ngăn việc.
export async function moTab(page, ten) {
  await page.locator("aside.thsx-panel--open").getByRole("tab", { name: new RegExp(`^${ten}`) }).click();
  await page.waitForTimeout(1200);
}

// Khung cắt đúng ngăn chi tiết (bỏ thanh bên tối và bảng mờ phía sau).
export async function clipNgan(page) {
  const b = await page.locator("aside.thsx-panel--open").boundingBox();
  return { x: b.x, y: 0, width: b.width, height: Math.min(b.height + b.y, 950) };
}

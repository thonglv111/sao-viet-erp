// Chương 2: Việc của tổ trên điện thoại (chạy với DT=1), tổ Bế TD - Kiệt (id 21), chỉ chụp.
// → vtt-14-dt-danh-sach (danh sách việc), vtt-15-dt-ngan-viec (mở một việc).
export default async ({ page, chup }) => {
  await page.goto("http://localhost:5173/?man=thuc-hien-sx:21");
  await page.getByText("LSX26-0007", { exact: true }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await chup("vtt-14-dt-danh-sach");
  await page.getByText("LSX26-0007", { exact: true }).nth(1).click();
  await page.waitForTimeout(2500);
  await chup("vtt-15-dt-ngan-viec");
};

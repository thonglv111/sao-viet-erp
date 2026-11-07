// Chương 3 (sau khi bấm Sẵn sàng): đầu lệnh LSX26-0007.
import { moLenh } from "./c03a-ra-lenh.mjs";
export default async ({ page, chup, khoanh, mo }) => {
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  await moLenh(page, mo, "LSX26-0007");
  const main = page.locator("main").first();
  const nut = (re) => page.locator("button:visible").filter({ hasText: re });
  await khoanh([
    { loc: page.getByText(/^Sẵn sàng$/).first().locator("xpath=..") },
    { loc: page.getByText(/Chưa giữ chỗ vật tư/).first() },
    { loc: nut(/Mở lại để sửa/) },
  ]);
  const b = await main.boundingBox();
  const t = await page.getByRole("tab", { name: "Thông tin chung" }).first().boundingBox();
  await chup("khsx-24-san-sang", { x: b.x, y: b.y, width: b.width, height: t.y + t.height + 12 - b.y });
};

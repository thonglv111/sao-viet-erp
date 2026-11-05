// Chương 3: trả khuôn về kệ ở việc Khuôn hộp của LSX26-0007 (Bế TD - Kiệt, tổ 21, việc thứ 2).
// Nút Trả khuôn về kệ chỉ hiện khi việc đã xong: bấm Kết thúc, chụp nút, bấm nó (GHI dữ liệu).
import { moViec, clipNgan } from "./chung.mjs";

export default async ({ page, chup, khoanh }) => {
  const ngan = await moViec(page, "thuc-hien-sx:21", "LSX26-0007", 1);
  const ket = ngan.getByRole("button", { name: /Kết thúc/ });
  if (await ket.count()) { await ket.click(); await page.waitForTimeout(2500); }
  const tra = ngan.getByRole("button", { name: /Trả khuôn/ });
  await tra.first().scrollIntoViewIfNeeded();
  await khoanh([{ loc: tra, so: 1 }]);
  await chup("vtt-26-tra-khuon", await clipNgan(page));
  await tra.first().click();
  await page.waitForTimeout(2000);
  console.log((await ngan.locator(".thsx-b-phai").innerText()).replace(/\s+/g, " ").slice(-400));
};

// Chương 6: tab Vật tư của việc In, LSX26-0007 (tổ id 14), chỉ chụp, không lưu gì.
// → vtt-50-tab-vat-tu, hộp Yêu cầu bổ sung → vtt-51-bo-sung, hộp Yêu cầu nhập kho → vtt-52-nhap-lai.
import { moViec, moTab, clipNgan } from "./chung.mjs";

export default async ({ page, chup, khoanh }) => {
  const ngan = await moViec(page, "thuc-hien-sx:14", "LSX26-0007");
  await moTab(page, "Vật tư");
  console.log((await ngan.innerText()).slice(0, 2500));
  const nut = ngan.getByRole("button", { name: /Yêu cầu|Sửa đề nghị|bổ sung|phần dư/ });
  console.log("NUT:", await nut.allInnerTexts());
  const ds = [];
  for (let i = 0; i < Math.min(await nut.count(), 4); i++) ds.push({ loc: nut.nth(i), so: i + 1 });
  await khoanh(ds);
  await chup("vtt-50-tab-vat-tu", await clipNgan(page));
  await page.evaluate(() => document.querySelectorAll(".__khoanh").forEach((e) => e.remove()));
  for (const [nut, ten] of [["Yêu cầu bổ sung", "vtt-51-bo-sung"], ["Yêu cầu nhập kho", "vtt-52-nhap-lai"]]) {
    await ngan.getByRole("button", { name: nut }).click();
    await page.waitForTimeout(1500);
    const hop = page.locator("[role=dialog]").last();
    console.log(ten, ":", (await hop.innerText()).slice(0, 1500));
    const b = await hop.boundingBox();
    await chup(ten, { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 950 - b.y) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }
};

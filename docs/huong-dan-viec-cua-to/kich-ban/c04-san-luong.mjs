// Chương 4: ghi sản lượng việc In của LSX26-0007 (tổ id 14).
// BUOC=1: mở hộp Ghi sản lượng, gõ 150, chụp, KHÔNG lưu.
// BUOC=2: ghi lần 1 = 150 tờ in, lần 2 = 100 tờ in (GHI dữ liệu), chụp tab Sản lượng.
// BUOC=3: mở Sửa số của lần 2, chụp, KHÔNG lưu.
import { moViec, moTab, clipNgan } from "./chung.mjs";

async function moHop(page, ngan) {
  await moTab(page, "Sản lượng");
  await ngan.getByRole("button", { name: /Ghi sản lượng/ }).first().click();
  await page.waitForTimeout(1200);
  return page.locator("[role=dialog]").last();
}

async function ghi(page, ngan, so) {
  const hop = await moHop(page, ngan);
  await hop.getByLabel(/Số lượng làm được/).fill(String(so));
  await page.waitForTimeout(400);
  await hop.getByRole("button", { name: /^(Ghi|Lưu)/ }).last().click();
  await page.waitForTimeout(2500);
}

export default async ({ page, chup, khoanh }) => {
  const BUOC = process.env.BUOC ?? "1";
  const ngan = await moViec(page, "thuc-hien-sx:14", "LSX26-0007");
  if (BUOC === "1") {
    const hop = await moHop(page, ngan);
    await hop.getByLabel(/Số lượng làm được/).fill("150");
    await page.waitForTimeout(600);
    const khung = async () => { const b = await hop.boundingBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    await khoanh([
      { loc: hop.getByLabel(/Số lượng làm được/).locator(".."), so: 1 },
      { loc: hop.getByRole("button", { name: "+10", exact: true }).locator(".."), so: 2 },
      { loc: hop.getByText("Huỳnh Văn Tính").locator("../../.."), so: 3 },
      { loc: hop.getByText("Thêm người tổ khác"), so: 4 },
      { loc: hop.getByRole("button", { name: "Ghi sản lượng" }), so: 5 },
    ]);
    await chup("vtt-30-ghi-san-luong", await khung());
    await hop.getByText("Ghi chú", { exact: true }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await khoanh([
      { loc: hop.getByText("Khoán", { exact: true }).locator(".."), so: 6 },
      { loc: hop.getByText("Tuỳ chọn lần này", { exact: true }).locator(".."), so: 7 },
      { loc: hop.getByText("Việc phát sinh", { exact: true }).locator("../.."), so: 8 },
      { loc: hop.getByText(/^Ghi xong tự đề xuất giao/), so: 9 },
    ]);
    await chup("vtt-30b-ghi-san-luong-duoi", await khung());
    await page.keyboard.press("Escape");
  }
  if (BUOC === "2") {
    await ghi(page, ngan, 150);
    await ghi(page, ngan, 100);
    console.log(await ngan.innerText());
    await chup("vtt-31-tab-san-luong", await clipNgan(page));
  }
  if (BUOC === "3") {
    await moTab(page, "Sản lượng");
    await ngan.getByText("Lần 2", { exact: true }).click();
    await page.waitForTimeout(1000);
    console.log(await ngan.innerText());
    await chup("vtt-31b-mo-lan", await clipNgan(page));
    await ngan.getByRole("button", { name: /Sửa số/ }).first().click();
    await page.waitForTimeout(1200);
    console.log(await page.locator("[role=dialog]").last().innerText());
    await chup("vtt-32-sua-so");
    await page.keyboard.press("Escape");
  }
};

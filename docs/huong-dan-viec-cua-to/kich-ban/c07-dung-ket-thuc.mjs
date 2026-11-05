// Chương 7: tạm dừng, kết thúc, đổi máy, báo dừng máy, trên việc In của LSX26-0007 (tổ id 14).
// BUOC=1: mở hộp Tạm dừng, menu ⋯, hộp Báo dừng máy; chụp, KHÔNG lưu gì.
// BUOC=2: bấm Kết thúc (GHI dữ liệu), chụp.
import { moViec, clipNgan } from "./chung.mjs";

export default async ({ page, chup, khoanh }) => {
  const BUOC = process.env.BUOC ?? "1";
  const ngan = await moViec(page, "thuc-hien-sx:14", "LSX26-0007");
  const hop = () => page.locator("[role=dialog]").last();
  const khung = async () => { const b = await hop().boundingBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
  if (BUOC === "1") {
    await ngan.getByRole("button", { name: /Tạm dừng/ }).click();
    await page.waitForTimeout(1000);
    console.log("TAM DUNG:", await hop().innerText());
    await chup("vtt-60-tam-dung", await khung());
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await ngan.getByRole("button", { name: "⋯" }).or(ngan.locator("button[aria-label*='Thêm']")).first().click();
    await page.waitForTimeout(800);
    console.log("MENU:", await page.locator("[role=menu]").last().innerText().catch(() => "?"));
    await chup("vtt-62-menu-doi-may", { x: 255, y: 0, width: 1185, height: 250 });
    await page.getByText("Đổi máy", { exact: true }).last().click();
    await page.waitForTimeout(1200);
    console.log("DOI MAY:", await hop().innerText());
    await chup("vtt-62b-doi-may", await khung());
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await ngan.getByRole("button", { name: /Đóng|×/ }).last().click().catch(() => page.keyboard.press("Escape"));
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: /Báo dừng máy/ }).first().click();
    await page.waitForTimeout(1200);
    console.log("BAO DUNG:", await hop().innerText());
    await chup("vtt-63-bao-dung-may", await khung());
    await page.keyboard.press("Escape");
  }
  if (BUOC === "2") {
    await ngan.getByRole("button", { name: /Kết thúc/ }).click();
    await page.waitForTimeout(1500);
    const d = page.locator("[role=dialog]");
    if (await d.count()) { console.log("HOP KET THUC:", await d.last().innerText()); await chup("vtt-61-ket-thuc", await khung()); await d.last().getByRole("button", { name: /Kết thúc/ }).last().click(); await page.waitForTimeout(2500); }
    console.log((await ngan.innerText()).slice(0, 300));
    await chup("vtt-61b-hoan-thanh", { x: 255, y: 0, width: 1185, height: 330 });
  }
};

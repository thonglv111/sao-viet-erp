// Chạy trọn một việc của LSX26-0007 ở một tổ (GHI dữ liệu): xác nhận nhận hàng, nhận khuôn nếu bước
// cần khuôn, Bắt đầu, ghi sản lượng từng lần, Kết thúc.
// TO=<id tổ> THU=<thứ tự việc của lệnh ở tổ đó, mặc định 0> SL="150,100" KET=0 (bỏ Kết thúc)
// KHUON=<tên ảnh>: chụp ngăn lúc thấy nút "Đã nhận khuôn" trước khi bấm.
import { moViec, moTab, clipNgan } from "./chung.mjs";

export default async ({ page, chup, khoanh }) => {
  const TO = process.env.TO, THU = Number(process.env.THU ?? 0);
  const ds = (process.env.SL ?? "").split(",").filter(Boolean).map(Number);
  const ngan = await moViec(page, `thuc-hien-sx:${TO}`, "LSX26-0007", THU);
  console.log("VIEC:", (await ngan.locator("header").first().innerText()).replace(/\s+/g, " "));

  await moTab(page, "Giao và nhận");
  while (await ngan.getByRole("button", { name: /^Xác nhận/ }).count()) {
    await ngan.getByRole("button", { name: /^Xác nhận/ }).first().click();
    await page.waitForTimeout(2000);
  }
  const khuon = ngan.getByRole("button", { name: /Đã nhận khuôn/ });
  if (await khuon.count()) {
    if (process.env.KHUON) {
      await khuon.first().scrollIntoViewIfNeeded();
      await khoanh([{ loc: khuon, so: 1 }]);
      await chup(process.env.KHUON, await clipNgan(page));
    }
    await khuon.first().click();
    await page.waitForTimeout(2000);
  }
  const batDau = ngan.getByRole("button", { name: /^(Bắt đầu|Tiếp tục)/ });
  if (await batDau.count()) {
    if (await batDau.first().isDisabled()) {
      console.log("KHÔNG BẮT ĐẦU ĐƯỢC:", await ngan.locator(".thsx-b-phai").innerText());
      return;
    }
    await batDau.first().click();
    await page.waitForTimeout(2500);
  }
  for (const so of ds) {
    await moTab(page, "Sản lượng");
    await ngan.getByRole("button", { name: /Ghi sản lượng/ }).first().click();
    await page.waitForTimeout(1200);
    const hop = page.locator("[role=dialog]").last();
    await hop.getByLabel(/Số lượng làm được/).fill(String(so));
    await page.waitForTimeout(400);
    await hop.getByRole("button", { name: "Ghi sản lượng" }).click();
    await page.waitForTimeout(2500);
  }
  if (process.env.KET !== "0") {
    await ngan.getByRole("button", { name: /Kết thúc/ }).click();
    await page.waitForTimeout(2500);
  }
  console.log("SAU:", (await ngan.innerText()).replace(/\s+/g, " ").slice(0, 900));
};

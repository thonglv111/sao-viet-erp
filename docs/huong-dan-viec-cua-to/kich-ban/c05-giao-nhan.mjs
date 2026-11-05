// Chương 5: giao và nhận giữa các tổ, LSX26-0007.
// BUOC=1: tab Giao và nhận của bước In (tổ 14), chỉ chụp.
// BUOC=2: ngăn Ép kim (Bế TD - Kiệt, tổ 21) lúc hàng chưa về: hộp "Chưa bắt đầu được vì", chỉ chụp.
// BUOC=4: tab Giao và nhận của Ép kim khi hàng gia công đã về, chưa xác nhận, chỉ chụp.
// BUOC=3: bấm Xác nhận nhận hàng ở Ép kim (GHI dữ liệu), chụp.
import { moViec, moTab, clipNgan } from "./chung.mjs";

export default async ({ page, chup, khoanh }) => {
  const BUOC = process.env.BUOC ?? "1";
  if (BUOC === "1") {
    const ngan = await moViec(page, "thuc-hien-sx:14", "LSX26-0007");
    await moTab(page, "Giao và nhận");
    await khoanh([
      { loc: ngan.getByText("Giao đi", { exact: true }).locator(".."), so: 1 },
      { loc: ngan.getByRole("button", { name: /Đề xuất giao/ }), so: 2 },
      { loc: ngan.getByRole("button", { name: /Chọn lại/ }).first(), so: 3 },
    ]);
    await chup("vtt-40-giao-di", await clipNgan(page));
    return;
  }
  const ngan = await moViec(page, "thuc-hien-sx:21", "LSX26-0007");
  if (BUOC === "2") {
    await khoanh([{ loc: ngan.getByText("Chưa bắt đầu được vì").locator(".."), so: 1 }]);
    await chup("vtt-24-chua-bat-dau-duoc", await clipNgan(page));
    return;
  }
  await moTab(page, "Giao và nhận");
  if (BUOC === "4") {
    console.log(await ngan.innerText());
    await khoanh([{ loc: ngan.getByRole("button", { name: /Xác nhận/ }).first(), so: 1 }]);
    await chup("vtt-41-nhan-vao", await clipNgan(page));
  }
  if (BUOC === "3") {
    await ngan.getByRole("button", { name: /Xác nhận/ }).first().click();
    await page.waitForTimeout(1500);
    const d = page.locator("[role=dialog]");
    if (await d.count()) {
      console.log("HOP:", await d.last().innerText());
      await chup("vtt-42-xac-nhan");
      await d.last().getByRole("button", { name: /Xác nhận/ }).last().click();
      await page.waitForTimeout(2500);
    }
    console.log(await ngan.innerText());
    await chup("vtt-43-da-nhan", await clipNgan(page));
  }
};

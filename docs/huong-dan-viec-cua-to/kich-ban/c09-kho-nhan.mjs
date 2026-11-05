// Chương 9: kho nhận hàng thành phẩm KCS gửi (yêu cầu DNN của LSX26-0007), GHI dữ liệu.
// Yêu cầu nhập xuất → tab Phiếu từ yêu cầu → Lập phiếu ở dòng có LSX26-0007 → Tạo và ghi sổ → Ghi sổ.
// MA=<mã yêu cầu>, mặc định DNN01045.
export default async ({ page }) => {
  const MA = process.env.MA ?? "DNN01045";
  await page.goto("http://localhost:5173/?man=kho-main");
  await page.getByRole("tab", { name: /Phiếu từ yêu cầu/ }).or(page.getByRole("button", { name: /Phiếu từ yêu cầu/ })).first().click();
  await page.waitForTimeout(2000);
  const dong = page.locator("tr").filter({ hasText: MA }).first();
  await dong.waitFor({ timeout: 20000 });
  console.log("DONG:", (await dong.innerText()).replace(/\s+/g, " "));
  await dong.getByRole("button", { name: /Lập phiếu/ }).click();
  await page.waitForTimeout(2000);
  const hop = page.locator("[role=dialog]").last();
  console.log("HOP:", (await hop.innerText()).slice(0, 1500));
  await page.screenshot({ path: "_xem.png" });
  if (process.env.GHI !== "1") return;
  await hop.getByRole("button", { name: /Tạo và ghi sổ/ }).click();
  await page.waitForTimeout(1500);
  const xn = page.locator("[role=dialog], [role=alertdialog]").last();
  await xn.getByRole("button", { name: /^Ghi sổ/ }).last().click();
  await page.waitForTimeout(3000);
  console.log("SAU:", (await page.locator("main").first().innerText()).slice(0, 800));
};

// Dò: mở một màn rồi in chữ ra stdout, chụp _xem.png. MAN=<man> (vd thuc-hien-sx:14).
export default async ({ page, mo }) => {
  await mo(process.env.MAN ?? "");
  await page.screenshot({ path: "_xem.png" });
  console.log((await page.locator("main").first().innerText().catch(() => page.locator("body").innerText())).slice(0, 4000));
};

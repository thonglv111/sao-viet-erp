// Xem nhanh: mở một lệnh ở màn Kế hoạch SX, chụp từng tab ở khung cao.
export default async ({ page, mo }) => {
  const ma = process.env.MA || "LSX26-0007";
  await page.setViewportSize({ width: 1440, height: 2600 });
  await mo("ke-hoach-sx");
  await page.getByRole("tab", { name: "Lệnh sản xuất" }).click();
  await page.getByText(ma, { exact: true }).first().click();
  await page.waitForTimeout(3000);
  for (const t of (process.env.TABS || "Thông tin chung,Quy cách,Công đoạn,Vật tư,Tệp đính kèm,Nhật ký").split(",")) {
    await page.getByRole("tab", { name: t, exact: true }).first().click().catch(() => page.getByText(t, { exact: true }).last().click());
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${process.argv[3]}/_xem-${ma}-${t}.png` });
  }
};

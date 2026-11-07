// Chương Kế hoạch bộ phận (07/11/2026): bộ phận Tổ in, việc In của LSX26-0011 (lệnh đã phát).
// Có GHI dữ liệu: trả việc về khay, mở hộp lý do khi chọn máy khác máy tính giá (bấm Huỷ), rồi
// xếp lại vào máy tính giá và chọn nhóm. Không bấm Giao.
const LENH = "LSX26-0011";
export default async ({ page, chup, khoanh, mo }) => {
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" }).catch(() => {});
  await mo("ke-hoach-bo-phan");
  const chon = async (nhan, go, tuyChon) => {
    await page.getByRole("button", { name: nhan, exact: true }).first().click();
    await page.waitForTimeout(300);
    await page.keyboard.type(go, { delay: 40 });
    await page.waitForTimeout(400);
    await page.getByRole("option", { name: tuyChon }).first().click();
    await page.waitForTimeout(1800);
  };
  await chon("Bộ phận", "Tổ in", /^Tổ in/);
  const the = () => page.locator(".khbp-the").filter({ hasText: LENH }).first();
  if (await the().getByText("Trả về khay", { exact: true }).count()) {
    await the().getByText("Trả về khay", { exact: true }).click();
    await page.waitForTimeout(1800);
  }
  // Chọn máy khác máy tính giá: hộp đòi lý do.
  await chon(`Xếp ${LENH} In vào máy`, "6 màu", /IN-06/);
  await page.locator(".khbp-hop textarea").pressSequentially("IN-02 đang bảo trì, chuyển sang IN-06", { delay: 25 });
  await page.waitForTimeout(500);
  await khoanh([
    { loc: page.locator(".khbp-hop__o").last() },
    { loc: page.getByRole("button", { name: "Xếp việc" }).last() },
  ]);
  const hop = await page.locator(".khbp-hop").first().evaluate((e) => {
    let p = e; while (p && !/dialog/.test(p.getAttribute("role") ?? "") && p.parentElement) p = p.parentElement;
    const r = p.getBoundingClientRect(); return { x: r.x - 16, y: r.y - 16, width: r.width + 32, height: r.height + 32 };
  });
  await chup("khsx-48b-ly-do", hop);
  await page.getByRole("button", { name: "Huỷ" }).last().click();
  await page.waitForTimeout(800);
  // Xếp vào đúng máy tính giá: không hỏi gì.
  await chon(`Xếp ${LENH} In vào máy`, "IN-02", /IN-02/);
  await chon(`Nhóm làm ${LENH} In`, "4 màu", /4 màu/);
  const cotKhay = page.locator(".khbp-cot--khay").first();
  await khoanh([
    { loc: page.getByRole("button", { name: "Bộ phận", exact: true }).first() },
    { loc: cotKhay.locator(".khbp-cot__dau") },
    { loc: the() },
    { loc: the().getByText(/^Khâu trước/) },
    { loc: the().getByRole("button", { name: `Nhóm làm ${LENH} In` }) },
    { loc: page.locator("button:visible").filter({ hasText: /^Giao xuống tổ/ }).first() },
  ]);
  const b = await page.locator(".khbp").first().boundingBox();
  await chup("khsx-48-bo-phan", { x: b.x, y: b.y, width: b.width, height: 470 });
  // Ngăn của việc: Quy cách in.
  await the().getByRole("button", { name: LENH, exact: true }).click();
  await page.getByText("Tệp của lệnh", { exact: true }).first().waitFor();
  await page.getByText("Quy cách in", { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await khoanh([{ loc: page.getByText("Quy cách in", { exact: true }).first().locator("xpath=..") }]);
  const n = await page.getByText("Tệp của lệnh", { exact: true }).first().evaluate((e) => {
    let p = e; while (p && p.getBoundingClientRect().height < innerHeight * 0.9) p = p.parentElement;
    const r = p.getBoundingClientRect(); return { x: r.x, y: 0, width: Math.min(r.width, innerWidth - r.x), height: 440 };
  });
  await chup("khsx-49-ngan-quy-cach", n);
};

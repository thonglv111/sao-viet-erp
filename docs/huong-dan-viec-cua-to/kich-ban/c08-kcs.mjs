// Chương 8: màn KCS, LSX26-0007.
// BUOC=0: dò, mở lệnh, in chữ, chụp _xem.png.
// BUOC=1: danh sách lệnh có khoanh (lọc trạng thái, ô tìm, chú giải màu) → vtt-70-kcs-danh-sach.
// BUOC=2: mở lệnh, sơ đồ nhóm → vtt-71-kcs-so-do; bấm công đoạn In → vtt-72-kcs-cong-doan-giua.
// BUOC=3: Ghi lỗi ở In: tick tiêu chí, số lỗi, ghi chú → vtt-73-kcs-ghi-loi, bấm Lưu (GHI dữ liệu).
const MA = "LSX26-0007";

async function moLenh(page) {
  await page.goto("http://localhost:5173/?man=kcs");
  await page.getByText(MA, { exact: true }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await page.getByText(MA, { exact: true }).first().click();
  await page.waitForTimeout(2500);
}

export default async ({ page, chup, khoanh }) => {
  const BUOC = process.env.BUOC ?? "0";
  if (BUOC === "0") {
    await moLenh(page);
    await page.screenshot({ path: "_xem.png" });
    console.log((await page.locator("body").innerText()).slice(0, 5000));
    return;
  }
  if (BUOC === "1") {
    await page.goto("http://localhost:5173/?man=kcs");
    await page.getByText(MA, { exact: true }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await khoanh([
      { loc: page.getByRole("button", { name: /Chờ kiểm/ }).first().locator(".."), so: 1 },
      { loc: page.getByPlaceholder(/Tìm mã lệnh/), so: 2 },
      { loc: page.getByText(MA, { exact: true }).first().locator("xpath=ancestor::tr"), so: 3 },
    ]);
    await chup("vtt-70-kcs-danh-sach", { x: 255, y: 0, width: 1185, height: 520 });
    return;
  }
  if (BUOC === "8") {
    // Tab Báo cáo lỗi: kiểu Bảng rồi Biểu đồ, chỉ chụp.
    await page.goto("http://localhost:5173/?man=kcs");
    await page.getByRole("tab", { name: "Báo cáo lỗi" }).or(page.getByRole("button", { name: "Báo cáo lỗi" })).first().click();
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: /Bảng/ }).or(page.getByRole("tab", { name: /Bảng/ })).first().click();
    await page.waitForTimeout(2000);
    console.log((await page.locator("main").first().innerText()).slice(0, 2500));
    await chup("vtt-83-kcs-bao-cao-loi", { x: 255, y: 0, width: 1185, height: 720 });
    const bd = page.getByRole("button", { name: /Biểu đồ/ }).or(page.getByRole("tab", { name: /Biểu đồ/ })).first();
    if (await bd.count()) {
      await bd.click();
      await page.waitForTimeout(2500);
      await chup("vtt-84-kcs-bieu-do", { x: 255, y: 0, width: 1185, height: 720 });
    }
    return;
  }
  await moLenh(page);
  if (BUOC === "2") {
    await chup("vtt-71-kcs-so-do", { x: 255, y: 0, width: 1185, height: 950 });
    await page.locator(".kcsb-nut").filter({ has: page.locator(".kcsb-nut__ten", { hasText: /^In$/ }) }).first().click();
    await page.waitForTimeout(1500);
    console.log((await page.locator("body").innerText()).slice(0, 5000));
    await chup("vtt-72-kcs-cong-doan-giua", { x: 255, y: 0, width: 1185, height: 950 });
  }
  if (BUOC === "4") {
    await page.getByRole("button", { name: /Kiểm hàng/ }).first().click();
    await page.waitForTimeout(1500);
    console.log("HOP:", await page.locator("[role=dialog]").last().innerText());
    await page.screenshot({ path: "_xem.png" });
  }
  if (BUOC === "5") {
    // Kiểm hàng bước cuối: 3 cái lem mực (tiêu chí của In), 2 cái bung keo (Lỗi khác, do Dán bìa folder).
    await page.getByRole("button", { name: /Kiểm hàng/ }).first().click();
    await page.waitForTimeout(1500);
    const hop = page.locator("[role=dialog]").last();
    const tc = "Không lem, không dây bẩn mực";
    const khac = "Lỗi khác";
    const anh = await taoAnh(page);
    for (const [ten, so, ghi] of [[tc, "3", "Dây mực mặt sau"], [khac, "2", "Bung keo gáy"]]) {
      await hop.getByLabel(ten, { exact: true }).check();
      await page.waitForTimeout(600);
      await hop.getByLabel(`Số lỗi ${ten}`).fill(so);
      await hop.getByLabel(`Ghi chú ${ten}`).fill(ghi);
      if (ten === khac) await hop.getByLabel("Lỗi do công đoạn nào").selectOption({ label: /Dán bìa folder/ }).catch(async () => {
        const o = await hop.getByLabel("Lỗi do công đoạn nào").locator("option").allInnerTexts();
        console.log("OPTION:", o);
        await hop.getByLabel("Lỗi do công đoạn nào").selectOption({ index: o.findIndex((x) => x.includes("Dán bìa")) });
      });
      const [fc] = await Promise.all([page.waitForEvent("filechooser"),
        hop.locator(".kgl-dong__than").getByRole("button", { name: /Chọn ảnh/ }).first().click()]);
      await fc.setFiles(anh);
      await page.waitForTimeout(2500);
    }
    await hop.getByLabel("Ghi chú cho lần kiểm").fill("Kiểm toàn bộ 1.000 cái");
    await khoanh([
      { loc: hop.getByLabel(khac, { exact: true }).locator("../.."), so: 1 },
      { loc: hop.getByLabel("Lỗi do công đoạn nào").locator(".."), so: 2 },
      { loc: hop.locator(".kgl-day").first(), so: 3 },
      { loc: hop.getByRole("button", { name: "Lưu kết quả kiểm" }), so: 4 },
    ]);
    await chup("vtt-76-kcs-kiem-hang", { x: 255, y: 0, width: 1185, height: 950 });
    await page.evaluate(() => document.querySelectorAll(".__khoanh").forEach((e) => e.remove()));
    await hop.getByRole("button", { name: "Lưu kết quả kiểm" }).click();
    await page.waitForTimeout(3000);
    console.log("SAU:", (await page.locator("main").first().innerText()).slice(0, 3000));
    await chup("vtt-77-kcs-sau-kiem", { x: 255, y: 0, width: 1185, height: 950 });
  }
  if (BUOC === "6") {
    // Chụp lại bước cuối sau kiểm (không còn toast), hai tab còn lại, rồi Gửi nhập kho (GHI dữ liệu).
    await chup("vtt-77-kcs-sau-kiem", { x: 255, y: 0, width: 1185, height: 720 });
    await page.getByRole("tab", { name: /Lỗi theo công đoạn/ }).or(page.getByRole("button", { name: /^Lỗi theo công đoạn/ })).first().click();
    await page.waitForTimeout(1200);
    await chup("vtt-78-kcs-loi-theo-cong-doan", { x: 255, y: 0, width: 1185, height: 720 });
    const nut = page.getByRole("button", { name: /Gửi nhập kho/ }).first();
    await khoanh([{ loc: nut, so: 1 }]);
    await nut.click();
    await page.waitForTimeout(1200);
    const hop = page.locator("[role=dialog], [role=alertdialog]").last();
    console.log("HOP:", await hop.innerText());
    await page.evaluate(() => document.querySelectorAll(".__khoanh").forEach((e) => e.remove()));
    const b = await hop.boundingBox();
    await chup("vtt-79-kcs-gui-nhap-kho", { x: b.x - 10, y: b.y - 10, width: b.width + 20, height: b.height + 20 });
    await hop.getByRole("button", { name: "Gửi yêu cầu" }).click();
    await page.waitForTimeout(3000);
    await page.getByRole("tab", { name: /Nhập kho/ }).or(page.getByRole("button", { name: /^Nhập kho$/ })).last().click();
    await page.waitForTimeout(1200);
    console.log("SAU:", (await page.locator("main").first().innerText()).slice(-1500));
    await chup("vtt-80-kcs-nhap-kho", { x: 255, y: 0, width: 1185, height: 720 });
  }
  if (BUOC === "7") {
    // Sau khi kho ghi sổ: tab Nhập kho (kho đã nhận), rồi Đóng lệnh nhóm (GHI dữ liệu).
    await page.getByRole("tab", { name: /Nhập kho/ }).or(page.getByRole("button", { name: /^Nhập kho$/ })).last().click();
    await page.waitForTimeout(1200);
    await chup("vtt-80-kcs-nhap-kho", { x: 255, y: 0, width: 1185, height: 720 });
    await page.getByRole("button", { name: /Đóng lệnh nhóm/ }).click();
    await page.waitForTimeout(1000);
    const hop = page.getByRole("dialog", { name: "Đóng lệnh nhóm" });
    console.log("HOP:", await hop.innerText());
    await khoanh([{ loc: hop, so: 1 }]);
    await chup("vtt-81-kcs-dong-lenh", { x: 255, y: 80, width: 1185, height: 380 });
    await page.evaluate(() => document.querySelectorAll(".__khoanh").forEach((e) => e.remove()));
    await hop.getByRole("button", { name: "Xác nhận đóng" }).click();
    await page.waitForTimeout(3000);
    console.log("SAU:", (await page.locator("main").first().innerText()).slice(0, 600));
    await chup("vtt-82-kcs-da-dong", { x: 255, y: 80, width: 1185, height: 380 });
  }
  if (BUOC === "3") {
    await page.locator(".kcsb-nut").filter({ has: page.locator(".kcsb-nut__ten", { hasText: /^In$/ }) }).first().click();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /Ghi lỗi/ }).first().click();
    await page.waitForTimeout(1500);
    const hop = page.locator("[role=dialog]").last();
    const tc = "Chồng màu đúng ốc, không lệch bát";
    await hop.getByLabel(tc, { exact: true }).check();
    await page.waitForTimeout(600);
    await hop.getByLabel(`Số lỗi ${tc}`).fill("6");
    await hop.getByLabel(`Ghi chú ${tc}`).fill("Lệch màu M ở góc phải tờ");
    const [fc] = await Promise.all([page.waitForEvent("filechooser"),
      hop.getByRole("button", { name: /Chọn ảnh/ }).first().click()]);
    await fc.setFiles(await taoAnh(page));
    await page.waitForTimeout(2500);
    await khoanh([
      { loc: hop.getByLabel(tc, { exact: true }).locator("../.."), so: 1 },
      { loc: hop.getByLabel(`Số lỗi ${tc}`).locator("../.."), so: 2 },
      { loc: hop.getByLabel(`Ghi chú ${tc}`).locator(".."), so: 3 },
      { loc: hop.locator(".kgl-dong__anh").first(), so: 4 },
      { loc: hop.getByRole("button", { name: "Lưu lỗi" }), so: 5 },
    ]);
    await chup("vtt-73-kcs-ghi-loi", { x: 255, y: 0, width: 1185, height: 950 });
    await page.evaluate(() => document.querySelectorAll(".__khoanh").forEach((e) => e.remove()));
    await hop.getByRole("button", { name: "Lưu lỗi" }).click();
    await page.waitForTimeout(2500);
    console.log("SAU:", (await page.locator("body").innerText()).slice(-2500));
  }
};

// Ảnh lỗi mẫu (vẽ bằng trình duyệt, khỏi cần ảnh chụp thật): bốn vòng màu lệch nhau.
async function taoAnh(page) {
  const tep = new URL("./anh-loi-mau.png", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
  const p = await page.context().newPage();
  await p.setViewportSize({ width: 800, height: 600 });
  await p.setContent(`<body style="margin:0;background:#f6f4ee"><svg width="800" height="600">
    <rect x="60" y="60" width="680" height="480" fill="#fff" stroke="#ccc" stroke-width="3"/>
    ${[["#00aeef", 0], ["#ec008c", 12], ["#ffdd00", -8], ["#222", 4]].map(([c, d]) =>
      `<circle cx="${400 + d}" cy="${300 + d / 2}" r="150" fill="none" stroke="${c}" stroke-width="12"/>`).join("")}
  </svg></body>`);
  await p.screenshot({ path: tep });
  await p.close();
  return tep;
}

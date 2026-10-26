// Màn Tồn kho: giấy tờ hiện "Định lượng" và "Quy kg" (spec 2026-10-24-chuan-bi-giay §6). Hai số do
// máy chủ trả trên dòng (`TonNhomMuc`); màn chỉ trình bày, ô trống khi máy chủ trả null.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COT_TON, MaterialRow } from "./KhoTonKhoPage";
import type { TonNhomMuc } from "../api/client";

const COT = COT_TON.filter((c) => ["vattu", "dl", "co", "quykg"].includes(c.key));

function dong(ten: string, total: number, muc: Partial<TonNhomMuc>) {
  const g = {
    hang_loai: "giay", hang_id: 1, key: ten, goc: "to", khoRong: 650, khoDai: 860, code: ten, name: ten,
    dvt: "tờ", dvtCode: "to", anh: null, total, value: 0, lots: [], viTris: [], hsdSoonest: null,
    hsdOthers: 0, muc: { tinh_trang: null, can_lenh: 0, dang_ve: 0, du_kien: null, ...muc },
  } as unknown as Parameters<typeof MaterialRow>[0]["g"];
  return (
    <MaterialRow g={g} cot={COT} checked={false} dangMo={false} onToggleSel={() => {}} onOpen={() => {}}
      threshold={undefined} canSetThreshold={false} onSetThreshold={() => {}} />
  );
}

describe("Tồn kho — cột Định lượng và Quy kg", () => {
  it("bày đúng thứ tự: Định lượng sau Khổ, Quy kg ngay sau Đang có", () => {
    const keys = COT_TON.map((c) => c.key);
    expect(keys.indexOf("dl")).toBe(keys.indexOf("kho") + 1);
    expect(keys.indexOf("quykg")).toBe(keys.indexOf("co") + 1);
  });

  it("giấy tờ hiện Quy kg và Định lượng, cuộn để trống Quy kg", () => {
    render(
      <table><tbody>
        {dong("Duplex tờ", 1530, { dinh_luong: 350, quy_kg: 299.34 })}
        {dong("Duplex cuộn", 300, { dinh_luong: 250, quy_kg: null })}
      </tbody></table>,
    );
    const [to, cuon] = screen.getAllByRole("row");
    expect(to.textContent).toContain("350");
    expect(to.textContent).toContain("299,34");
    expect(cuon.textContent).toContain("250");
    expect(cuon.querySelectorAll("td")[3].textContent).toBe("–");
  });
});

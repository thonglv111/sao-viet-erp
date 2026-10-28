// Màn Tồn kho: ô ĐVT đổi cách xem số (spec 2026-10-28 §7b). Máy chủ trả hệ số từng dòng; màn chỉ chia.
// Đang có, Sắp xuất, Sắp về, Dự kiến còn đổi theo; Giá trị không đổi. Cột Quy kg đã bỏ.
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { COT_TON, MaterialRow } from "./KhoTonKhoPage";
import { dinhDangSo } from "./ton-kho/HopThemHang";

const COT = COT_TON.filter((c) => ["vattu", "dvt", "co", "sapxuat", "dukien"].includes(c.key));

const DV = [
  { ma: "to", ten: "tờ", he_so: 1 },
  { ma: "ram", ten: "ram", he_so: 500 },
  { ma: "kg", ten: "kg", he_so: 1 / 0.129165 },
];

function Dong({ donViXem = DV }: { donViXem?: typeof DV }) {
  const [dv, setDv] = useState<string | null>(null);
  const g = {
    hang_loai: "giay", hang_id: 1, key: "giay:1:790:1090:to", goc: "to", khoRong: 790, khoDai: 1090,
    code: "C150", name: "Couche 150", dvt: "tờ", dvtCode: "to", anh: null, total: 1200, value: 3_600_000,
    lots: [], viTris: [], hsdSoonest: null, hsdOthers: 0, chuaGiaGoc: 0, donViXem,
    muc: { tinh_trang: null, can_lenh: 500, dang_ve: 0, du_kien: 700 },
  } as unknown as Parameters<typeof MaterialRow>[0]["g"];
  return (
    <table><tbody>
      <MaterialRow g={g} cot={COT} checked={false} dangMo={false} onToggleSel={() => {}} onOpen={() => {}}
        threshold={undefined} canSetThreshold={false} onSetThreshold={() => {}} dvXem={dv} onDoiDv={setDv} />
    </tbody></table>
  );
}

const o = () => [...screen.getByRole("row").querySelectorAll("td")].map((td) => td.textContent);

describe("Tồn kho — xem theo ĐVT khác", () => {
  it("bỏ cột Quy kg", () => {
    expect(COT_TON.some((c) => c.key === "quykg")).toBe(false);
  });

  it("đổi tờ → ram chia số theo hệ số, 1.200 tờ = 2,4 ram", () => {
    render(<Dong />);
    expect(o().slice(2)).toEqual(["1.200", "500", "700"]);
    fireEvent.change(screen.getByRole("combobox", { name: /theo đơn vị/ }), { target: { value: "ram" } });
    expect(o().slice(2)).toEqual(["2,4", "1", "1,4"]);
  });

  it("đổi sang kg theo khổ và định lượng", () => {
    render(<Dong />);
    fireEvent.change(screen.getByRole("combobox", { name: /theo đơn vị/ }), { target: { value: "kg" } });
    expect(o()[2]).toBe("154,998");
  });

  it("không có đơn vị nào khác thì ô ĐVT là chữ, không phải ô chọn", () => {
    render(<Dong donViXem={[DV[0]]} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(o()[1]).toBe("tờ");
  });
});

describe("Ô số form Thêm hàng", () => {
  it("chấm nghìn, giữ một dấu phẩy thập phân", () => {
    expect(dinhDangSo("1234567")).toBe("1.234.567");
    expect(dinhDangSo("1.200,5")).toBe("1.200,5");
    expect(dinhDangSo("12,3,4")).toBe("12,34");
    expect(dinhDangSo("abc")).toBe("");
  });
});

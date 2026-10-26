/** Ba lưới Thu mua (Yêu cầu, Từng món, Đơn mua) trên khuôn lưới `lds` — dùng chung giữa hai màn mỗi lưới.
 *
 *  Khoá chặt: lưới dựng bằng `lds-g` trong `lds-sheet`; cột mã ghim (`coDinh`); ô tick chỉ có khi có việc
 *  tick; cột ẩn đi thì tiêu đề + ô biến mất; MỖI MÀN nhớ cột riêng (khoá khác nhau cho cùng một lưới);
 *  dòng khoá không bấm được còn dòng thường bấm được; cảnh báo quá ngày cần hàng còn màu đỏ; ba ca
 *  không có dòng nào (đang tải, lỗi có nút Thử lại, rỗng có nút Xoá bộ lọc).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DepartmentPurchaseRequestRow, PurchaseRequestRow, YeuCauMonRow } from "../../api/client";
import { BangDonMua, COT_DON } from "./don-mua-chung/BangDonMua";
import { ChonCotBang, useCotBang } from "./luoi-mua-hang";
import { BangMonYeuCau, COT_MON } from "./yeu-cau-chung/BangMonYeuCau";
import { BangYeuCau, COT_YEU_CAU } from "./yeu-cau-chung/BangYeuCau";

vi.mock("../tenDonVi", () => ({ useNapTenDonVi: () => 0, tenDonVi: (u: string) => (u === "to" ? "tờ" : u) }));

const ngay = (them: number) => {
  const d = new Date();
  d.setDate(d.getDate() + them);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const yc = (id: number, status: string, can: string): DepartmentPurchaseRequestRow =>
  ({
    id,
    code: `YC-${id}`,
    status,
    workflow_status: status,
    content: `Giấy cho lệnh ${id}`,
    purpose: null,
    note: null,
    requesting_department_name: "Kho",
    requested_by_name: "An",
    source_type: "kho",
    created_at: "2026-10-01T08:00:00",
    needed_date: can,
    loai_mua: "cho_lsx",
    mua_cho: [],
    lines: [{ id: id * 10, item_name: "Giấy couche", cancelled_at: null, fulfilment: null, mua_cho: [] }],
  }) as unknown as DepartmentPurchaseRequestRow;

const mon = (id: number, chon: boolean): YeuCauMonRow =>
  ({
    line_id: id,
    request_id: 1,
    request_code: "YC-1",
    request_status: "open",
    content: "x",
    requesting_department_name: "Kho",
    requested_by_name: "An",
    created_at: "2026-10-01T08:00:00",
    needed_date: ngay(5),
    hang_loai: "giay",
    hang_id: 1,
    kho_rong: 65,
    kho_dai: 86,
    item_name: `Giấy ${id}`,
    unit: "to",
    quantity: 1500,
    note: null,
    purchase_code: null,
    supplier_name: null,
    ordered_quantity: null,
    received_quantity: null,
    tinh_trang: "cho_lap",
    tien_do: 0,
    chon_duoc: chon,
    cancel_reason: null,
    loai_mua: "cho_lsx",
    mua_cho: [],
  }) as unknown as YeuCauMonRow;

const don = (id: number): PurchaseRequestRow =>
  ({
    id,
    code: `PMH-${id}`,
    status: "purchased",
    supplier_name: "Giấy Hoà Bình",
    content: "Mua giấy",
    purpose: null,
    created_at: "2026-10-02T08:00:00",
    needed_date: "2026-10-12",
    expected_receipt_date: "2026-10-10",
    sources: [{ code: "YC-1" }, { code: "YC-2" }],
    loai_mua_cac: ["cho_lsx"],
    mua_cho: [],
    total_estimate: 12500000,
    outstanding_amount: 4000000,
    gia_tri_da_giao: 0,
    nhom_tien: "chua_tra",
    coc_da_chi: 0,
    deliveries: [{ con_no: 4000000, due_date: "2026-10-20" }],
  }) as unknown as PurchaseRequestRow;

const chung = {
  loading: false,
  loi: null,
  onThuLai: () => {},
  coLoc: false,
  onXoaLoc: () => {},
  goiYTrong: "Gợi ý.",
  total: 0,
  page: 1,
  size: 20,
  onPage: () => {},
  onSize: () => {},
};

/** Màn giả: nút "Cột" + lưới, đúng cách màn cha thật nối hai thứ qua `useCotBang`. */
function ManYeuCau({ khoa, rows, chonMon, khoaDong, onChon }: {
  khoa: string;
  rows: DepartmentPurchaseRequestRow[];
  chonMon?: Parameters<typeof BangYeuCau>[0]["chonMon"];
  khoaDong?: (r: DepartmentPurchaseRequestRow) => boolean;
  onChon?: (r: DepartmentPurchaseRequestRow) => void;
}) {
  const cot = useCotBang(khoa, COT_YEU_CAU);
  return (
    <div className="lds">
      <ChonCotBang b={cot} />
      <BangYeuCau {...chung} cot={cot} rows={rows} chonId={null} onChon={onChon ?? (() => {})} chonMon={chonMon} khoaDong={khoaDong} />
    </div>
  );
}

function ManDon({ khoa, rows, onChon }: { khoa: string; rows: PurchaseRequestRow[]; onChon?: (id: number) => void }) {
  const cot = useCotBang(khoa, COT_DON);
  return (
    <div className="lds">
      <ChonCotBang b={cot} />
      <BangDonMua {...chung} cot={cot} rows={rows} chonId={null} onChon={onChon ?? (() => {})} openYcmh={() => {}} />
    </div>
  );
}

function ManMon({ khoa, rows }: { khoa: string; rows: YeuCauMonRow[] }) {
  const cot = useCotBang(khoa, COT_MON);
  return (
    <div className="lds">
      <BangMonYeuCau {...chung} cot={cot} rows={rows} chon={new Set()} onDoi={() => {}} onChonTrang={() => {}} />
    </div>
  );
}

const tieuDe = () => Array.from(document.querySelectorAll("thead th")).map((t) => t.textContent?.trim() ?? "");

beforeEach(() => localStorage.clear());

describe("lưới Yêu cầu", () => {
  it("dựng trong lds-sheet / lds-g, mã đứng đầu, ngày cần quá hạn có màu đỏ", () => {
    render(<ManYeuCau khoa="t-yc" rows={[yc(1, "open", ngay(-2)), yc(2, "open", ngay(10))]} />);
    expect(document.querySelector(".lds-sheet table.lds-g")).not.toBeNull();
    expect(tieuDe()[0]).toBe("Mã yêu cầu");
    expect(tieuDe()).not.toContain("Chọn");
    const qua = screen.getByText("quá 2 ngày");
    expect(qua.className).toContain("lds-do");
    expect(screen.getByText("còn 10 ngày").className).not.toContain("lds-do");
    expect(screen.getAllByText("Chờ lập đơn").length).toBeGreaterThan(0);
  });

  it("ẩn một cột thì tiêu đề và ô biến mất, và chỉ MÀN ĐÓ nhớ (khoá riêng từng màn)", () => {
    const { unmount } = render(<ManYeuCau khoa="t-yc-a" rows={[yc(1, "open", ngay(3))]} />);
    fireEvent.click(screen.getByRole("button", { name: /Cột/ }));
    fireEvent.click(screen.getByLabelText("Bộ phận"));
    expect(tieuDe()).not.toContain("Bộ phận");
    expect(screen.queryByText("Kho")).toBeNull();
    unmount();
    // Cùng lưới ở màn khác: vẫn đủ cột.
    const b = render(<ManYeuCau khoa="t-yc-b" rows={[yc(1, "open", ngay(3))]} />);
    expect(tieuDe()).toContain("Bộ phận");
    b.unmount();
    // Quay lại màn A: vẫn nhớ đã ẩn.
    render(<ManYeuCau khoa="t-yc-a" rows={[yc(1, "open", ngay(3))]} />);
    expect(tieuDe()).not.toContain("Bộ phận");
  });

  it("có cột ô tick khi Mua hàng có yêu cầu tick được; dòng khoá không bấm, dòng thường bấm", () => {
    const bam = vi.fn();
    const doi = vi.fn();
    render(
      <ManYeuCau
        khoa="t-yc-chon"
        rows={[yc(1, "open", ngay(3)), yc(2, "done", ngay(3))]}
        khoaDong={(r) => r.status !== "open"}
        onChon={bam}
        chonMon={{ trangThai: (r) => (r.status === "open" ? "khong" : null), doi }}
      />,
    );
    expect(tieuDe()[0]).toBe("");
    expect(tieuDe()[1]).toBe("Mã yêu cầu");
    fireEvent.click(screen.getByText("YC-1"));
    expect(bam).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("YC-2"));
    expect(bam).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Chọn món của YC-1"));
    expect(doi).toHaveBeenCalledTimes(1);
    expect(bam).toHaveBeenCalledTimes(1);
  });

  it("ba ca không có dòng: đang tải, lỗi có Thử lại, rỗng có Xoá bộ lọc khi đang lọc", () => {
    const thuLai = vi.fn();
    const xoa = vi.fn();
    const cot = { cot: COT_YEU_CAU, an: new Set<string>(), setAn: () => {}, thuTu: [], setThuTu: () => {}, hien: COT_YEU_CAU };
    const { rerender } = render(<BangYeuCau {...chung} cot={cot} rows={[]} chonId={null} onChon={() => {}} loi="Không tải được." onThuLai={thuLai} />);
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(thuLai).toHaveBeenCalled();
    rerender(<BangYeuCau {...chung} cot={cot} rows={[]} chonId={null} onChon={() => {}} coLoc onXoaLoc={xoa} />);
    expect(screen.getByText(/khớp điều kiện đang lọc/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Xoá bộ lọc" }));
    expect(xoa).toHaveBeenCalled();
    rerender(<BangYeuCau {...chung} cot={cot} rows={[]} chonId={null} onChon={() => {}} />);
    expect(screen.getByText(/Chưa có yêu cầu mua hàng nào/)).toBeTruthy();
  });
});

describe("lưới Từng món", () => {
  it("có ô tick + Vật tư đứng đầu khi có món tick được; bỏ ô tick khi không có", () => {
    const { unmount } = render(<ManMon khoa="t-mon" rows={[mon(1, true), mon(2, false)]} />);
    expect(tieuDe().slice(0, 2)).toEqual(["", "Vật tư"]);
    expect(screen.getByLabelText("Chọn Giấy 1")).toBeTruthy();
    expect(screen.queryByLabelText("Chọn Giấy 2")).toBeNull();
    expect(screen.getAllByText("65 × 86 mm")).toHaveLength(2);
    unmount();
    render(<ManMon khoa="t-mon2" rows={[mon(2, false)]} />);
    expect(tieuDe()[0]).toBe("Vật tư");
  });

  it("giấy có cột Định lượng ngay sau Khổ, số đọc từ dòng; thiếu thì gạch", () => {
    render(<ManMon khoa="t-mon3" rows={[{ ...mon(1, false), dinh_luong: 350 }, mon(2, false)]} />);
    const cot = tieuDe();
    expect(cot.indexOf("Định lượng")).toBe(cot.indexOf("Khổ") + 1);
    const [d1, d2] = screen.getAllByRole("row").slice(1);
    const o = (d: HTMLElement) => d.querySelectorAll("td")[cot.indexOf("Định lượng")].textContent;
    expect(o(d1)).toBe("350");
    expect(o(d2)).toBe("–");
  });
});

describe("lưới Đơn mua", () => {
  it("Mã đứng đầu, +N yêu cầu còn, hàng và tiền hiện; bấm dòng mở đơn; nút mã yêu cầu không mở đơn", () => {
    const mo = vi.fn();
    render(<ManDon khoa="t-don" rows={[don(7)]} onChon={mo} />);
    expect(tieuDe()[0]).toBe("Mã đơn");
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("Chờ hàng về")).toBeTruthy();
    expect(screen.getByText("Chưa trả")).toBeTruthy();
    expect(screen.getByText(/hạn 20\/10/)).toBeTruthy();
    fireEvent.click(screen.getByText("YC-1"));
    expect(mo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("PMH-7"));
    expect(mo).toHaveBeenCalledWith(7);
  });

  it("Mua hàng và Kế toán nhớ cột riêng cho cùng một lưới", () => {
    const { unmount } = render(<ManDon khoa="mh-don-test" rows={[don(7)]} />);
    fireEvent.click(screen.getByRole("button", { name: /Cột/ }));
    fireEvent.click(screen.getByLabelText("Nhà cung cấp"));
    expect(tieuDe()).not.toContain("Nhà cung cấp");
    unmount();
    render(<ManDon khoa="kt-don-mua-test" rows={[don(7)]} />);
    expect(tieuDe()).toContain("Nhà cung cấp");
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SxLenhNhom, SxRoutingBuoc, SxWorkItem } from "../api/client";
import { ThsxDanhSach, dongPhuTrangThai } from "./ThsxDanhSach";

function mockViec(p: Partial<SxWorkItem>): SxWorkItem {
  return {
    id: 1,
    nguon_loai: "lsx",
    nguon_ma: "LSX26-0003",
    nguon_ten: "Hộp bánh mang đi 4 ngăn",
    ten_cong_doan: "Ghi kẽm CTP",
    loai_buoc: "may",
    may: "CTP Screen 8600",
    trang_thai: "released",
    so_luong_vao: 4,
    so_luong_ra: 4,
    don_vi_vao: "kem",
    don_vi_ra: "kem",
    ngoai_dong: true,
    chay_phut: 13,
    dinh_muc_vat_tu: [{ vat_tu_id: 1, ma: "KM01", ten: "Bản kẽm CTP 1030x790", don_vi: "cai", so_luong: 4 }],
    kcs_so_lan: 0,
    kcs_dat: 0,
    kcs_loi: 0,
    quy_cach: { giay: "Couche", dinh_luong: 300, kho_in: "640 x 450", so_mau: 4, so_kem: 4 },
    ...p,
  } as SxWorkItem;
}

/** Bọc MỘT bước vào một lệnh — bàn tổ từ 11/09/2026 nhận `lenh`, thẻ/bảng việc nằm bên trong. */
function mockLenh(items: SxWorkItem[]) {
  return [{
    nguon_loai: "lsx", nguon_ma: items[0]?.nguon_ma ?? "LSX26-0003",
    nguon_ten: items[0]?.nguon_ten ?? "", lsx_id: 3, bai_ghep_id: null,
    som_nhat: null, muon_nhat: null, so_viec: items.length,
    digest: { released: items.length, running: 0, paused: 0, completed: 0 },
    cong_viec: items,
  }];
}

describe("ThsxDanhSach — Workstation Studio Modern Table View", () => {
  it("hiển thị đúng thông tin mã nguồn, công đoạn, máy, quy cách và vật tư", () => {
    const item = mockViec({ id: 201, ten_cong_doan: "Ghi kẽm CTP" });
    const onPick = vi.fn();

    render(
      <ThsxDanhSach
        lenh={mockLenh([item])}
        selectedId={null}
        onPick={onPick}
      />
    );

    // Mockup: mã lệnh đầy đủ, không rút còn số đuôi.
    expect(screen.getByText("LSX26-0003")).toBeInTheDocument();
    expect(screen.getByText("Ghi kẽm CTP")).toBeInTheDocument();
    expect(screen.getByText("CTP Screen 8600")).toBeInTheDocument();
    expect(screen.getByText("Bản kẽm CTP 1030x790")).toBeInTheDocument();
    expect(screen.getByText(/Couche 300gsm/i)).toBeInTheDocument();
  });

  // 28/09/2026: cột cuối CHỈ còn nhãn trạng thái — nút chạy nhanh đứng cạnh nhãn đọc ra thành nhiều
  // trạng thái. Kể cả người giữ quyền Thực hiện lệnh cũng không thấy nút ở dòng; thao tác ở drawer.
  it("cột trạng thái chỉ có nhãn, không còn nút Bắt đầu / Tạm dừng / Kết thúc", () => {
    const onPick = vi.fn();
    const item = mockViec({ id: 204, trang_thai: "running", chay_duoc: true });
    render(
      <ThsxDanhSach
        lenh={mockLenh([mockViec({ id: 203, trang_thai: "released", chay_duoc: true }), item])}
        selectedId={null}
        onPick={onPick}
      />
    );

    expect(screen.getByText("Trạng thái")).toBeInTheDocument();
    expect(screen.getByText("Đang chạy")).toBeInTheDocument();
    expect(screen.getByText("Chờ làm")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bắt đầu|Tạm dừng|Kết thúc/ })).toBeNull();

    // Bấm dòng vẫn mở drawer — đường duy nhất tới các thao tác.
    fireEvent.click(screen.getByText("Đang chạy"));
    expect(onPick).toHaveBeenCalledWith(item);
  });

  it("lưới theo khuôn: dòng đang mở viền đủ cạnh, cột ẩn biến mất cả tiêu đề lẫn ô", () => {
    const { container } = render(
      <ThsxDanhSach
        lenh={mockLenh([mockViec({ id: 301 })])}
        selectedId={301}
        onPick={vi.fn()}
        cotAn={new Set(["may", "vt"])}
      />
    );
    expect(container.querySelector("table.lds-g")).not.toBeNull();
    expect(container.querySelector("tbody tr.lds-dong.is-chon")).not.toBeNull();
    expect(screen.queryByText("Máy và thời gian")).toBeNull();
    expect(screen.queryByText("CTP Screen 8600")).toBeNull();
    expect(screen.queryByText("Định mức vật tư")).toBeNull();
    expect(screen.getByText("Công đoạn")).toBeInTheDocument();
  });

  it("lưới phẳng: mỗi việc một dòng, đủ 10 cột, lệnh thành cột Lệnh + Sản phẩm", () => {
    const a = mockViec({ id: 1, nguon_ma: "LSX26-0004", nguon_ten: "Bìa sách A5", khach_hang: "Bibica" });
    const b = mockViec({ id: 2, nguon_ma: "LSX26-0005", nguon_ten: "Ruột sách", ten_cong_doan: "Xén 3 mặt" });
    const c = mockViec({ id: 3, nguon_ma: "LSX26-0005", nguon_ten: "Ruột sách", ten_cong_doan: "Cắt tờ" });
    const lenh = [...mockLenh([a]), ...mockLenh([b, c])] as SxLenhNhom[];
    const { container } = render(<ThsxDanhSach lenh={lenh} selectedId={null} onPick={vi.fn()} />);
    expect(container.querySelectorAll("tbody tr.lds-dong")).toHaveLength(3);
    expect([...container.querySelectorAll("thead th")].map((t) => t.textContent)).toEqual([
      // Vật tư ngay sau Trạng thái: nó chặn nút Bắt đầu, để cuối là khuất ở màn 1440px.
      "Lệnh", "Sản phẩm", "Công đoạn", "Trạng thái", "Vật tư", "Tốt / cần", "Hàng đang tới đâu",
      "Máy và thời gian", "Quy cách", "Định mức vật tư",
    ]);
    expect(screen.getByText("Bìa sách A5")).toBeInTheDocument();
    expect(screen.getByText("Bibica")).toBeInTheDocument();
    // Lệnh một bước: máy chủ không dựng dải nhưng hàng chỉ có thể ở tổ mình.
    expect(screen.getAllByText("Hàng ở tổ mình")).toHaveLength(3);
  });

  it("cột Hàng đang tới đâu vẽ dải theo routing, rê chuột lên chấm đọc tên bước và số", () => {
    const buoc = (n: number, ten: string, tt: string, cv: number | null, extra: Partial<SxRoutingBuoc> = {}): SxRoutingBuoc => ({
      thu_tu: n, step_key: `s${n}`, ten_cong_doan: ten, to_id: null, to_ten: `Tổ ${n}`, la_cua_toi: cv != null,
      la_kcs_cuoi: false, trang_thai: tt, phan_doan_tong: 1, chay_chung: false, ke_hoach: null, thuc_te: 0,
      don_vi: null, da_giao_sang_toi: null, da_nhan: null, cong_viec_id: cv, ...extra,
    });
    const w = mockViec({ id: 9, ten_cong_doan: "Bế" });
    const lenh = mockLenh([w]).map((l) => ({
      ...l,
      routing: [
        buoc(1, "Cắt tờ", "completed", null),
        buoc(2, "In offset", "running", null, { ke_hoach: 350, thuc_te: 200, da_giao_sang_toi: 150 }),
        buoc(3, "Cán màng", "released", null, { thue_ngoai: true }),
        buoc(4, "Bế", "released", 9),
      ],
    })) as SxLenhNhom[];
    const { container } = render(<ThsxDanhSach lenh={lenh} selectedId={null} onPick={vi.fn()} />);
    expect(screen.getByText("Còn 2 bước tới mình")).toBeInTheDocument();
    const cham = container.querySelectorAll(".thsx-tk__dt:not(.thsx-tk-cg .thsx-tk__dt)");
    expect(cham).toHaveLength(4);
    expect(cham[1].getAttribute("title")).toContain("2. In offset, Tổ 2, đang làm");
    expect(cham[1].getAttribute("title")).toContain("Đã giao sang tổ mình 150");
    expect(cham[2].className).toContain("is-ngoai");
    expect(cham[3].className).toContain("is-me");
    expect(screen.getByLabelText("Còn 2 bước nữa mới tới tổ mình")).toBeInTheDocument();
  });

  it("lệnh gấp có thẻ GẤP cạnh mã ở mọi dòng của lệnh, lệnh thường thì không", () => {
    const a = mockViec({ id: 1, nguon_ma: "LSX26-0004" });
    const b = mockViec({ id: 2, nguon_ma: "LSX26-0005", ten_cong_doan: "Xén 3 mặt" });
    const c = mockViec({ id: 3, nguon_ma: "LSX26-0005", ten_cong_doan: "Cắt tờ" });
    const lenh = [
      ...mockLenh([a]),
      ...mockLenh([b, c]).map((l) => ({ ...l, is_rush: true })),
    ] as SxLenhNhom[];
    const { container } = render(<ThsxDanhSach lenh={lenh} selectedId={null} onPick={vi.fn()} />);
    const dong = [...container.querySelectorAll("tbody tr.lds-dong")];
    expect(dong.map((d) => d.querySelector(".lsc-gap")?.textContent ?? null)).toEqual([null, "GẤP", "GẤP"]);
  });

  it("bài ghép chưa có dải thì ô tuyến là gạch", () => {
    const w = mockViec({ id: 7, nguon_loai: "bai_ghep" });
    const lenh = mockLenh([w]).map((l) => ({ ...l, nguon_loai: "bai_ghep", routing: [] })) as SxLenhNhom[];
    render(<ThsxDanhSach lenh={lenh} selectedId={null} onPick={vi.fn()} />);
    expect(screen.queryByText("Hàng ở tổ mình")).toBeNull();
  });

  it("dòng phụ trạng thái: chưa giao, đã giao, đang chạy, xong", () => {
    expect(dongPhuTrangThai(mockViec({ trang_thai: "released", nguoi_lam: [] }))).toBe("chưa giao thợ");
    expect(dongPhuTrangThai(mockViec({ trang_thai: "released", nguoi_lam: ["Đào Văn Hoan"] }))).toBe("đã giao Đào Văn Hoan");
    const bay = new Date();
    bay.setHours(11, 41, 0, 0);
    expect(dongPhuTrangThai(mockViec({
      trang_thai: "running", nguoi_lam: ["Đào Văn Hoan"], thuc_te: [{ bat_dau: bay.toISOString(), ket_thuc: null }],
    }))).toBe("từ 11:41 Đào Văn Hoan");
    expect(dongPhuTrangThai(mockViec({
      trang_thai: "completed", thuc_te: [{ bat_dau: "2026-10-05T08:00:00", ket_thuc: "2026-10-05T16:20:00" }],
    }))).toMatch(/^xong 5\/10(\/2026)? 16:20$/);
  });
});

describe("ThsxDanhSach — cột Vật tư (tự lập yêu cầu xuất khi phát hành)", () => {
  const mon = [
    { ten: "Couche 300", dvt: "tờ", sl_xin: 2700, sl_da_xuat: 0, chot_thieu: false, lan_so: 1, muc: "kho_dang_soan" },
    { ten: "Mực đen", dvt: "kg", sl_xin: 2, sl_da_xuat: 1.5, chot_thieu: true, lan_so: 1, muc: "kho_dang_soan" },
  ] as const;

  function ve(p: Partial<SxWorkItem>) {
    render(<ThsxDanhSach lenh={mockLenh([mockViec({ id: 301, ...p })])} selectedId={null} onPick={vi.fn()} />);
  }

  it("cột Vật tư hiện chip Kho đang soạn", () => {
    ve({ trang_thai_vat_tu: { muc: "kho_dang_soan", mon: [...mon] } });
    expect(screen.getByRole("columnheader", { name: /^Vật tư/ })).toBeInTheDocument();
    expect(screen.getByText("Kho đang soạn")).toBeInTheDocument();
  });

  it("bước không cần vật tư thì ô Vật tư trống", () => {
    ve({ trang_thai_vat_tu: null });
    for (const nhan of ["Chưa yêu cầu", "Chờ kho", "Kho đang soạn", "Cấp thiếu", "Sẵn sàng"]) {
      expect(screen.queryByText(nhan)).toBeNull();
    }
  });

  it("rê chuột chip thấy từng món và số đã xuất", () => {
    ve({ trang_thai_vat_tu: { muc: "kho_dang_soan", mon: [...mon] } });
    const title = screen.getByText("Kho đang soạn").getAttribute("title") ?? "";
    expect(title).toContain("Couche 300 xin 2.700 tờ và đã xuất 0");
    expect(title).toContain("Mực đen xin 2 kg và đã xuất 1,5 (kho chốt thiếu)");
  });
});

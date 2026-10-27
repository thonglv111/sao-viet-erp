import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SxVatTuCap, SxVatTuCapLan, SxWorkItem, SxWorkItemChiTiet } from "../api/client";
import { VatTuSection, dungTuCongViec, type ThsxExec } from "./ThsxExecPanels";

// Bàn tổ mở thẳng form Yêu cầu nhập xuất của Kho (mockup ban-to-hop-thoai-B #vat-tu).
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test", user: { id: 1 } }) }));
const tonKhoa = vi.fn();
const donVi = vi.fn();
const tim = vi.fn();
vi.mock("../api/client", async (goc) => ({
  ...(await goc<typeof import("../api/client")>()),
  api: {
    kho: { phieu: { tonKhoa: (...a: unknown[]) => tonKhoa(...a) }, deNghi: { create: vi.fn() } },
    matHang: { donVi: (...a: unknown[]) => donVi(...a), tim: (...a: unknown[]) => tim(...a) },
  },
}));

const CANH = "Chưa có đơn vị tính. Để ở 0 thì vẫn gửi được, muốn xin thì nhờ kỹ thuật kiểm lại đơn vị.";

const cv = {
  id: 11, nguon_ma: "LSX26-0004", nguon_ten: "Bìa sách A5", ten_cong_doan: "Cắt tờ",
  du_kien_bat_dau: "2026-10-09T13:30:00",
} as SxWorkItem;

const keHoach: SxVatTuCap["ke_hoach"] = [
  { hang_loai: "giay", hang_id: 1, ten: "Ivory 210", don_vi_goc: "to", kho_rong: 790, kho_dai: 1090,
    dvt: "to", sl: 175, dvt_goc: "to", sl_goc: 175 },
  // Kế hoạch không có đơn vị tính (keo chưa khai đơn vị).
  { hang_loai: "vat_tu", hang_id: 9, ten: "Keo dán gáy EVA", don_vi_goc: "", kho_rong: 0, kho_dai: 0,
    dvt: "", sl: 0, dvt_goc: "", sl_goc: 0 },
];

function doiChieu(kw: Partial<SxVatTuCap["doi_chieu"][number]>): SxVatTuCap["doi_chieu"][number] {
  return {
    hang_loai: "giay", hang_id: 1, ten: "Ivory 210", don_vi_goc: "to", kho_rong: 790, kho_dai: 1090,
    dvt: "to", dvt_goc: "to", sl_ke_hoach: 175, sl_ke_hoach_goc: 175, sl_yeu_cau: 175, sl_yeu_cau_goc: 175,
    sl_thuc_xuat: 0, sl_nhap_lai: 0, sl_thuc_dung: 0, lech_ke_hoach: 0, lech_thuc_te: 0, nhan_tu: null,
    ...kw,
  };
}

const lan1: SxVatTuCapLan = {
  id: 31, lan_so: 1, loai: "lan_dau", can_luc: "2026-10-09T10:00:00",
  stock_request_id: 77, stock_request_ma: "YC26-0031", stock_request_trang_thai: "approved",
  created_by_id: 5, updated_by_id: null, created_by_ten: "Đào Văn Hoan", updated_by_ten: null, created_at: "2026-10-09T10:05:00", updated_at: "2026-10-09T10:05:00",
  dongs: [
    { hang_loai: "giay", hang_id: 1, ten: "Ivory 210", don_vi_goc: "to", kho_rong: 790, kho_dai: 1090,
      dvt: "to", dvt_goc: "to", sl_ke_hoach: 175, sl_ke_hoach_goc: 175, sl_yeu_cau: 180, sl_yeu_cau_goc: 180 },
    { hang_loai: "giay", hang_id: 2, ten: "Couche 150", don_vi_goc: "to", kho_rong: 650, kho_dai: 860,
      dvt: "to", dvt_goc: "to", sl_ke_hoach: 0, sl_ke_hoach_goc: 0, sl_yeu_cau: 20, sl_yeu_cau_goc: 20 },
  ],
};

/** Lần bổ sung chỉ có món NGOÀI kế hoạch, xin bằng kg. */
const lan2: SxVatTuCapLan = {
  ...lan1, id: 32, lan_so: 2, loai: "bo_sung", stock_request_id: 78, stock_request_ma: "YC26-0040",
  dongs: [
    { hang_loai: "vat_tu", hang_id: 12, ten: "Mực đen", don_vi_goc: "", kho_rong: 0, kho_dai: 0,
      dvt: "kg", dvt_goc: "cai", sl_ke_hoach: 0, sl_ke_hoach_goc: 0, sl_yeu_cau: 3, sl_yeu_cau_goc: 6 },
  ],
};

const capMoi: SxVatTuCap = {
  ke_hoach: keHoach, cac_de_nghi: [], doi_chieu: [doiChieu({ sl_yeu_cau: 0, sl_yeu_cau_goc: 0 })],
  de_nghi_co_the_sua_id: null, co_the_tao_bo_sung: false, du_lieu_cu: false,
};
const capSua: SxVatTuCap = {
  ...capMoi, cac_de_nghi: [lan1], doi_chieu: [doiChieu({ sl_yeu_cau: 180, sl_yeu_cau_goc: 180 })],
  de_nghi_co_the_sua_id: 31,
};
const capSuaBoSung: SxVatTuCap = {
  ...capMoi, cac_de_nghi: [lan1, lan2], de_nghi_co_the_sua_id: 32,
  doi_chieu: [doiChieu({ sl_yeu_cau: 180, sl_yeu_cau_goc: 180 })],
};
const capBoSung: SxVatTuCap = {
  ...capMoi, cac_de_nghi: [lan1], de_nghi_co_the_sua_id: null, co_the_tao_bo_sung: true,
  doi_chieu: [
    doiChieu({}),
    // Giấy nhận từ bước trước không phải thứ xin cấp — không vào form bổ sung.
    doiChieu({ hang_id: 3, ten: "Tờ in từ bước In", nhan_tu: "In" }),
  ],
};

describe("dungTuCongViec — dựng form Kho từ công việc của bàn tổ", () => {
  it("giờ bắt đầu dự kiến đã qua: giờ cần = bây giờ, chip Lúc bắt đầu việc vẫn giữ mốc cũ", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 10, 0, 45));
    try {
      const f = dungTuCongViec(cv, capMoi, "moi", null, "Cắt 2");
      expect(f.canLuc).toBe("2026-10-10T00:45");
      expect(f.lucBatDauViec).toBe("2026-10-09T13:30");
    } finally {
      vi.useRealTimers();
    }
  });

  it("yêu cầu lần đầu: mọi dòng kế hoạch, số đầu = kế hoạch, dòng thiếu đơn vị có câu cam", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 9, 8, 0));
    const f = dungTuCongViec(cv, capMoi, "moi", null, "Cắt 2");
    vi.useRealTimers();
    expect(f.tieuDe).toBe("Yêu cầu xuất kho");
    expect(f.duongDan).toBe("Bàn tổ Cắt 2 › Cắt tờ của LSX26-0004 › Tạo mới");
    expect(f.loai).toBe("XUAT");
    expect(f.cotNen).toBe("Kế hoạch");
    expect(f.nhanSoLuong).toBe("Số lượng xin");
    expect(f.nutGui).toBe("Gửi kho");
    expect(f.canLuc).toBe("2026-10-09T13:30");
    expect(f.lucBatDauViec).toBe("2026-10-09T13:30");
    expect(f.goiY).toBe("Dòng theo kế hoạch không xoá được. Bấm Về 0 nghĩa là tổ không cần cấp món đó.");
    expect(f.lenh).toMatchObject({ ma: "LSX26-0004", ten: "Bìa sách A5", congDoan: "Cắt tờ", to: "Cắt 2", lan: null });
    expect(f.dong).toHaveLength(2);
    expect(f.dong.every((d) => d.theo_ke_hoach)).toBe(true);
    expect(f.choPhepRong).toBe(false);
    expect(f.dong[0]).toMatchObject({ hang_ten: "Ivory 210", sl_nen: 175, sl_de_nghi: 175, dvt: "to", canh: null });
    expect(f.dong[1]).toMatchObject({ hang_ten: "Keo dán gáy EVA", sl_nen: 0, sl_de_nghi: 0, dvt: "", canh: CANH });
  });

  it("yêu cầu bổ sung: nền là số đã xin, số đầu 0, xoá được nhưng khổ chỉ đọc", () => {
    const f = dungTuCongViec(cv, capBoSung, "bo_sung", null, "Cắt 2");
    expect(f.tieuDe).toBe("Yêu cầu xuất kho");
    expect(f.duongDan).toMatch(/› Tạo mới$/);
    expect(f.cotNen).toBe("Đã xin");
    expect(f.nhanSoLuong).toBe("Số xin thêm");
    expect(f.nutGui).toBe("Gửi kho");
    expect(f.goiY).toBe("Đã xin đủ kế hoạch nên lần này là xin thêm, chỉ thêm đúng món đang thiếu.");
    expect(f.dong).toHaveLength(1);
    expect(f.dong[0]).toMatchObject({
      hang_ten: "Ivory 210", sl_nen: 175, sl_de_nghi: 0, theo_ke_hoach: false, kho_chi_doc: true,
    });
  });

  it("sửa đề nghị: số của chính lần đang sửa, bù dòng kế hoạch còn thiếu, có hàng Lần", () => {
    const f = dungTuCongViec(cv, capSua, "sua", lan1, "Cắt 2");
    expect(f.tieuDe).toBe("Sửa yêu cầu xuất kho YC26-0031");
    expect(f.duongDan).toBe("Bàn tổ Cắt 2 › Cắt tờ của LSX26-0004 › Sửa yêu cầu");
    expect(f.cotNen).toBe("Kế hoạch");
    expect(f.nutGui).toBe("Lưu thay đổi");
    expect(f.canLuc).toBe("2026-10-09T10:00");
    expect(f.lenh.lan).toEqual({ so: 1, nguoi: "Đào Văn Hoan", luc: "2026-10-09T10:05" });
    // Sửa đưa hết về 0 là đường tự huỷ yêu cầu — form phải cho gửi rỗng.
    expect(f.choPhepRong).toBe(true);
    expect(f.dong).toHaveLength(3);
    const [ivory, couche, keo] = f.dong;
    expect(ivory).toMatchObject({ hang_ten: "Ivory 210", sl_nen: 175, sl_de_nghi: 180, theo_ke_hoach: true });
    expect(couche).toMatchObject({ hang_ten: "Couche 150", sl_nen: null, sl_de_nghi: 20, theo_ke_hoach: false });
    expect(keo).toMatchObject({ hang_ten: "Keo dán gáy EVA", sl_nen: 0, sl_de_nghi: 0, theo_ke_hoach: true });
  });

  it("nhập lại vật tư thừa: chưa có gì kho xuất thì không cột nền, không dòng sẵn", () => {
    const f = dungTuCongViec(cv, capSua, "nhap_lai", null, "Cắt 2");
    expect(f.tieuDe).toBe("Yêu cầu nhập kho");
    expect(f.loai).toBe("NHAP");
    expect(f.cotNen).toBeNull();
    expect(f.nhanSoLuong).toBe("Số lượng nhập");
    expect(f.nutGui).toBe("Gửi kho");
    expect(f.lucBatDauViec).toBeNull();
    expect(f.goiY).toBeNull();
    expect(f.dong).toEqual([]);
  });

  it("nhập lại vật tư thừa: điền sẵn món kho đã xuất, nền = kho đã xuất, số trả để 0 cho tổ gõ", () => {
    const cap: SxVatTuCap = {
      ...capSua,
      doi_chieu: [
        doiChieu({ sl_thuc_xuat: 180 }),
        // Chưa xuất thì chưa có gì để trả; giấy nhận từ bước trước không phải hàng kho xuất cho tổ.
        doiChieu({ hang_id: 2, ten: "Couche 150", sl_thuc_xuat: 0 }),
        doiChieu({ hang_id: 3, ten: "Tờ in từ bước In", nhan_tu: "In", sl_thuc_xuat: 50 }),
      ],
    };
    const f = dungTuCongViec(cv, cap, "nhap_lai", null, "Cắt 2");
    expect(f.cotNen).toBe("Kho đã xuất");
    expect(f.goiY).toBe("Điền số còn thừa trả về kho. Món nào không trả thì để 0.");
    expect(f.dong).toHaveLength(1);
    expect(f.dong[0]).toMatchObject({
      hang_ten: "Ivory 210", dvt: "to", sl_nen: 180, sl_de_nghi: 0, theo_ke_hoach: false, kho_chi_doc: true,
    });
  });
});

function chiTiet(cap: SxVatTuCap): SxWorkItemChiTiet {
  return {
    cong_viec: cv, vat_tu: [], vat_tu_cap: cap, khoang_tham_gia: [],
    phan_cong: [{ employee_id: 5, ho_ten: "Đào Văn Hoan" }],
  } as unknown as SxWorkItemChiTiet;
}

function exec(kw: Partial<ThsxExec> = {}): ThsxExec {
  return {
    deNghiVatTu: vi.fn().mockResolvedValue(true),
    suaDeNghiVatTu: vi.fn().mockResolvedValue(true),
    nhapLaiVatTu: vi.fn().mockResolvedValue(true),
    ...kw,
  } as unknown as ThsxExec;
}

function ve(cap: SxVatTuCap, ex: ThsxExec) {
  return render(<VatTuSection chiTiet={chiTiet(cap)} canAssign busy={false} exec={ex}
    tenTo="Cắt 2" />);
}

describe("Tab Vật tư mở form Kho", () => {
  beforeEach(() => {
    tonKhoa.mockReset().mockResolvedValue([]);
    donVi.mockReset().mockResolvedValue({ ds: [{ ma: "to", ten: "tờ", he_so_ve_goc: 1, la_goc: true }], ly_do: null });
    tim.mockReset().mockResolvedValue([]);
  });

  it("bảng đối chiếu và lần đề nghị không còn cột Lý do", () => {
    ve(capSua, exec());
    expect(screen.queryByRole("columnheader", { name: "Lý do" })).toBeNull();
    // Đề nghị và phiếu kho: mỗi yêu cầu một dòng, phiếu kho cùng dòng; món đã xin nằm ở cột Đã xin.
    expect(screen.getByRole("columnheader", { name: "Yêu cầu" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Phiếu kho" })).toBeTruthy();
    expect(screen.getByText("Xuất kho")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Đã xin" })).toBeTruthy();
    expect(screen.getByText("Lần 1")).toBeTruthy();
    expect(screen.queryByText(/Lý do/)).toBeNull();
  });

  it("Yêu cầu cấp vật tư: mở form Kho, Gửi kho gọi đường của tổ, dòng không mang lý do", async () => {
    // Trước giờ bắt đầu dự kiến (13:30) — giờ cần mặc định là chính mốc đó.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 9, 8, 0));
    onTestFinished(() => { vi.useRealTimers(); });
    const ex = exec();
    ve(capMoi, ex);
    fireEvent.click(screen.getByRole("button", { name: /Yêu cầu cấp vật tư/ }));
    expect(await screen.findByText("Yêu cầu xuất kho")).toBeTruthy();
    expect(screen.getByText("Bàn tổ Cắt 2 › Cắt tờ của LSX26-0004 › Tạo mới")).toBeTruthy();
    expect(screen.getByText(CANH)).toBeTruthy();
    expect(screen.queryByText(/Lý do/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Gửi kho/ }));
    await waitFor(() => expect(ex.deNghiVatTu).toHaveBeenCalledTimes(1));
    const [id, body] = (ex.deNghiVatTu as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe(11);
    expect(body).toEqual({
      can_luc: "2026-10-09T13:30:00", ghi_chu: null,
      lines: [
        { hang_loai: "giay", hang_id: 1, kho_rong: 790, kho_dai: 1090, dvt: "to", sl_yeu_cau: 175 },
        { hang_loai: "vat_tu", hang_id: 9, kho_rong: 0, kho_dai: 0, dvt: "", sl_yeu_cau: 0 },
      ],
    });
    // Gửi xong thì ngăn đóng.
    await waitFor(() => expect(screen.queryByText("Yêu cầu xuất kho")).toBeNull());
  });

  it("Sửa đề nghị: Lưu thay đổi gọi sửa đúng lần đang mở", async () => {
    const ex = exec();
    ve(capSua, ex);
    fireEvent.click(screen.getByRole("button", { name: /Sửa đề nghị/ }));
    expect(await screen.findByText("Sửa yêu cầu xuất kho YC26-0031")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByText("Đào Văn Hoan lúc 09/10 10:05")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(ex.suaDeNghiVatTu).toHaveBeenCalledTimes(1));
    const [id, lanId, body] = (ex.suaDeNghiVatTu as ReturnType<typeof vi.fn>).mock.calls[0];
    expect([id, lanId]).toEqual([11, 31]);
    expect(body.can_luc).toBe("2026-10-09T10:00:00");
    expect(body.lines.map((l: { hang_id: number; sl_yeu_cau: number }) => [l.hang_id, l.sl_yeu_cau]))
      .toEqual([[1, 180], [2, 20], [9, 0]]);
    expect(body.lines.some((l: object) => "ly_do_chenh_lech" in l)).toBe(false);
  });

  it("máy chủ không nhận thì ngăn vẫn mở và báo lỗi", async () => {
    const ex = exec({ deNghiVatTu: vi.fn().mockResolvedValue(false) });
    ve(capMoi, ex);
    fireEvent.click(screen.getByRole("button", { name: /Yêu cầu cấp vật tư/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Gửi kho/ }));
    await waitFor(() => expect(ex.deNghiVatTu).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Yêu cầu xuất kho")).toBeTruthy();
  });

  it("Yêu cầu nhập kho: mở form chiều nhập", async () => {
    ve(capMoi, exec());
    fireEvent.click(screen.getByRole("button", { name: /Yêu cầu nhập kho/ }));
    const ngan = await screen.findByRole("dialog");
    expect(within(ngan).getByText("Cần nhập lúc")).toBeTruthy();
    expect(within(ngan).getByRole("columnheader", { name: "Số lượng nhập" })).toBeTruthy();
  });

  it("sửa lần bổ sung chỉ có món ngoài kế hoạch: đưa về 0 rồi Lưu thay đổi là gửi rỗng (tự huỷ)", async () => {
    const ex = exec();
    ve(capSuaBoSung, ex);
    fireEvent.click(screen.getByRole("button", { name: /Sửa đề nghị/ }));
    const ngan = await screen.findByRole("dialog");
    fireEvent.change(within(ngan).getByRole("textbox", { name: /Số lượng Mực đen/ }), { target: { value: "0" } });
    fireEvent.click(within(ngan).getByRole("button", { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(ex.suaDeNghiVatTu).toHaveBeenCalledTimes(1));
    const [id, lanId, body] = (ex.suaDeNghiVatTu as ReturnType<typeof vi.fn>).mock.calls[0];
    expect([id, lanId]).toEqual([11, 32]);
    expect(body).toEqual({ can_luc: "2026-10-09T10:00:00", ghi_chu: null, lines: [] });
  });

  it("thêm tay lại món lần trước xin bằng kg thì dòng mới cũng là kg, không về đơn vị gốc", async () => {
    // Đơn vị gốc của Mực đen là "cai": không có gợi ý thì ô đơn vị tự điền "cai".
    donVi.mockImplementation((_t: string, _hl: string, id: number) => Promise.resolve(id === 12
      ? { ds: [{ ma: "cai", ten: "cái", he_so_ve_goc: 1, la_goc: true }, { ma: "kg", ten: "kg", he_so_ve_goc: 2, la_goc: false }],
          don_vi_goc: "cai", ly_do: null }
      : { ds: [{ ma: "to", ten: "tờ", he_so_ve_goc: 1, la_goc: true }], ly_do: null }));
    tim.mockResolvedValue([{ hang_loai: "vat_tu", hang_id: 12, nhom: "Vật tư khác", ma: "MD", ten: "Mực đen", don_vi_goc: "cai" }]);
    const ex = exec();
    ve(capSuaBoSung, ex);
    fireEvent.click(screen.getByRole("button", { name: /Sửa đề nghị/ }));
    const ngan = await screen.findByRole("dialog");
    fireEvent.click(within(ngan).getByRole("button", { name: /Xoá Mực đen/ }));
    expect(within(ngan).queryByText("Mực đen")).toBeNull();
    const o = within(ngan).getByPlaceholderText("Thêm vật tư: gõ tên hoặc mã…");
    fireEvent.change(o, { target: { value: "Mực" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Mực đen/ }));
    fireEvent.change(await within(ngan).findByRole("textbox", { name: /Số lượng Mực đen/ }), { target: { value: "5" } });
    await waitFor(() => expect(donVi).toHaveBeenCalledWith(expect.anything(), "vat_tu", 12));
    fireEvent.click(within(ngan).getByRole("button", { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(ex.suaDeNghiVatTu).toHaveBeenCalledTimes(1));
    const body = (ex.suaDeNghiVatTu as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(body.lines).toEqual([{ hang_loai: "vat_tu", hang_id: 12, kho_rong: 0, kho_dai: 0, dvt: "kg", sl_yeu_cau: 5 }]);
  });

  it("mở form rồi ô đơn vị tự điền: Esc đóng ngay, không hỏi bỏ nội dung đang nhập", async () => {
    donVi.mockImplementation((_t: string, _hl: string, id: number) => Promise.resolve(id === 9
      ? { ds: [{ ma: "kg", ten: "kg", he_so_ve_goc: 1, la_goc: true }], don_vi_goc: "kg", ly_do: null }
      : { ds: [{ ma: "to", ten: "tờ", he_so_ve_goc: 1, la_goc: true }], ly_do: null }));
    ve(capMoi, exec());
    fireEvent.click(screen.getByRole("button", { name: /Yêu cầu cấp vật tư/ }));
    await screen.findByRole("dialog");
    // Dòng keo kế hoạch `dvt=""` được ô đơn vị tự điền "kg" ⇒ câu cam thiếu đơn vị tắt.
    await waitFor(() => expect(screen.queryByText(CANH)).toBeNull());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText(/Bỏ nội dung/)).toBeNull();
  });
});

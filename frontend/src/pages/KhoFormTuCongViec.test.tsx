import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TaoYeuCauP2, type DongTuCongViec, type TuCongViec } from "./KhoDeNghiPage";

vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test", user: { id: 1 } }) }));
// Quyền xem giá (kho.view_cost) — mặc định không có, test "Giá trị nhập" bật riêng.
let coQuyenGia = false;
vi.mock("../auth/permissions", async (goc) => ({
  ...(await goc<typeof import("../auth/permissions")>()),
  useCan: () => () => coQuyenGia,
}));
const tonKhoa = vi.fn();
const donVi = vi.fn();
const taoKho = vi.fn();
vi.mock("../api/client", async (goc) => ({
  ...(await goc<typeof import("../api/client")>()),
  api: {
    kho: {
      phieu: { tonKhoa: (...a: unknown[]) => tonKhoa(...a) },
      deNghi: { create: (...a: unknown[]) => taoKho(...a) },
    },
    matHang: {
      donVi: (...a: unknown[]) => donVi(...a),
      search: vi.fn().mockResolvedValue([]),
    },
  },
}));

function dong(kw: Partial<DongTuCongViec>): DongTuCongViec {
  return {
    hang_loai: "giay", hang_id: 1, hang_ma: "IV210", hang_ten: "Ivory 210",
    dvt: "to", he_so_ve_goc: 1, sl_de_nghi: 175, don_gia: null,
    lsx_id: 4, bai_ghep_id: null, lsx_ma: "LSX26-0004", bai_ghep_ma: null,
    don_vi_goc: "to", kho_rong: 790, kho_dai: 1090, ghi_chu: null,
    sl_nen: 175, theo_ke_hoach: true,
    ...kw,
  };
}

function congViec(kw: Partial<TuCongViec>): TuCongViec {
  return {
    duongDan: "Việc của tổ Cắt 2 › Cắt tờ của LSX26-0004 › Tạo mới",
    tieuDe: "Yêu cầu xuất kho",
    loai: "XUAT",
    cotNen: "Kế hoạch",
    nhanSoLuong: "Số lượng xin",
    nutGui: "Gửi kho",
    lenh: { ma: "LSX26-0004", ten: "Bìa sách A5", congDoan: "Cắt tờ", to: "Cắt 2", lan: null },
    canLuc: "2026-10-09T10:00",
    lucBatDauViec: "2026-10-09T13:30",
    goiY: "Dòng theo kế hoạch không xoá được. Bấm Về 0 nghĩa là tổ không cần cấp món đó.",
    dong: [
      dong({}),
      dong({ hang_id: 2, hang_ma: "CO150", hang_ten: "Couche 150", sl_de_nghi: 20, kho_rong: 650, kho_dai: 860,
             sl_nen: null, theo_ke_hoach: false }),
    ],
    ghiChu: "",
    onGui: vi.fn().mockResolvedValue(undefined),
    ...kw,
  };
}

function ve(cv: TuCongViec, onSaved = vi.fn()) {
  return render(<TaoYeuCauP2 token="token-test" canRequest onClose={vi.fn()} onSaved={onSaved} tuCongViec={cv} />);
}

const hangCua = (ten: string) => screen.getByText(ten).closest("tr") as HTMLElement;

describe("TaoYeuCauP2 · mở từ công việc", () => {
  beforeEach(() => {
    tonKhoa.mockReset().mockResolvedValue([]);
    donVi.mockReset().mockResolvedValue({ ds: [{ ma: "to", ten: "tờ", he_so_ve_goc: 1, la_goc: true }], ly_do: null });
    taoKho.mockReset();
  });

  it("yêu cầu lần đầu: không nút Nhập/Xuất, có cột Kế hoạch, dòng kế hoạch Về 0 không xoá, dòng ngoài xoá được, không hỏi lý do", async () => {
    ve(congViec({}));
    expect(await screen.findByText("Yêu cầu xuất kho")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nhập" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Nhập" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Kế hoạch" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Số lượng xin" })).toBeTruthy();

    const keHoach = hangCua("Ivory 210");
    expect(within(keHoach).getByRole("button", { name: /Về 0/ })).toBeTruthy();
    expect(within(keHoach).queryByRole("button", { name: /Xoá/ })).toBeNull();
    const ngoai = hangCua("Couche 150");
    expect(within(ngoai).getByRole("button", { name: /Xoá Couche 150/ })).toBeTruthy();
    expect(within(ngoai).queryByRole("button", { name: /Về 0/ })).toBeNull();
    expect(within(ngoai).getByText("—")).toBeTruthy();

    expect(screen.queryByText(/Lý do/)).toBeNull();
    // Lệnh khoá theo việc, không có thẻ lệnh từng dòng.
    expect(screen.getByText("khoá theo công việc")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Không theo lệnh|LSX26-0004/ })).toBeNull();
    expect(screen.getByText("Cần xuất lúc")).toBeTruthy(); // nhãn có thêm dấu * bắt buộc
    expect(screen.getByRole("button", { name: "Lúc bắt đầu việc" })).toBeTruthy();
    expect(screen.getByText(/Bấm Về 0 nghĩa là/)).toBeTruthy();
  });

  it("bấm Về 0 thì ô số của dòng kế hoạch thành 0", async () => {
    ve(congViec({}));
    await screen.findByText("Ivory 210");
    const keHoach = hangCua("Ivory 210");
    const o = within(keHoach).getByRole("textbox", { name: /Số lượng Ivory 210/ }) as HTMLInputElement;
    expect(o.value).toBe("175");
    fireEvent.click(within(keHoach).getByRole("button", { name: /Về 0/ }));
    expect(o.value).toBe("0");
  });

  it("nhập lại vật tư thừa: không có cột Kế hoạch hay Đã xin", async () => {
    ve(congViec({
      tieuDe: "Yêu cầu nhập kho", loai: "NHAP", cotNen: null, nhanSoLuong: "Số lượng nhập", lucBatDauViec: null,
      dong: [dong({ sl_de_nghi: 5, sl_nen: null, theo_ke_hoach: false })],
    }));
    expect(await screen.findByText("Yêu cầu nhập kho")).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Kế hoạch" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Đã xin" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Số lượng nhập" })).toBeTruthy();
    expect(screen.getByText("Cần nhập lúc")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Lúc bắt đầu việc" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Xuất" })).toBeNull();
  });

  it("Gửi kho: onGui nhận can_luc đủ giây và đủ dòng kể cả dòng kế hoạch về 0", async () => {
    const onGui = vi.fn().mockResolvedValue(undefined);
    const onSaved = vi.fn();
    ve(congViec({ onGui }), onSaved);
    await screen.findByText("Ivory 210");
    const keHoach = hangCua("Ivory 210");
    fireEvent.click(within(keHoach).getByRole("button", { name: /Về 0/ }));
    fireEvent.click(screen.getByRole("button", { name: /Gửi kho/ }));
    await waitFor(() => expect(onGui).toHaveBeenCalledTimes(1));
    const p = onGui.mock.calls[0][0];
    expect(p.can_luc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/);
    expect(p.can_luc).toBe("2026-10-09T10:00:00");
    expect(p.dong).toHaveLength(2);
    expect(p.dong.find((d: DongTuCongViec) => d.hang_id === 1).sl_de_nghi).toBe(0);
    expect(p.ghi_chu).toBeNull();
    expect(taoKho).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("chip Lúc bắt đầu việc đặt ngày giờ về mốc bắt đầu", async () => {
    const onGui = vi.fn().mockResolvedValue(undefined);
    ve(congViec({ onGui }));
    fireEvent.click(await screen.findByRole("button", { name: "Lúc bắt đầu việc" }));
    fireEvent.click(screen.getByRole("button", { name: /Gửi kho/ }));
    await waitFor(() => expect(onGui).toHaveBeenCalledTimes(1));
    expect(onGui.mock.calls[0][0].can_luc).toBe("2026-10-09T13:30:00");
  });

  it("thiếu giờ thì nút gửi khoá", async () => {
    ve(congViec({ canLuc: "2026-10-09T" }));
    const nut = await screen.findByRole("button", { name: /Gửi kho/ });
    expect((nut as HTMLButtonElement).disabled).toBe(true);
  });
});

/** Màn ≤640px: jsdom không có matchMedia ⇒ giả một cái luôn khớp. */
function giaManHep() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (q: string) => ({
      matches: true, media: q, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }),
  });
}

describe("TaoYeuCauP2 · điện thoại phương án C", () => {
  beforeEach(() => {
    tonKhoa.mockReset().mockResolvedValue([]);
    donVi.mockReset().mockResolvedValue({ ds: [{ ma: "to", ten: "tờ", he_so_ve_goc: 1, la_goc: true }], ly_do: null });
    taoKho.mockReset();
    giaManHep();
  });
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
    coQuyenGia = false;
  });

  const dongDt = (ten: string) => screen.getByRole("button", { name: new RegExp(`^${ten}`) });

  it("danh sách chỉ đọc thay bảng; chạm dòng mở khay sửa số, Xong thì dòng hiện số mới", async () => {
    ve(congViec({}));
    await screen.findByText("Ivory 210");
    expect(document.querySelector("table")).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Số lượng Ivory 210/ })).toBeNull();
    expect(dongDt("Ivory 210").textContent).toContain("175");
    expect(dongDt("Ivory 210").textContent).toContain("kế hoạch 175");
    expect(dongDt("Couche 150").textContent).toContain("ngoài kế hoạch");

    fireEvent.click(dongDt("Ivory 210"));
    const khay = screen.getByRole("dialog", { name: "Ivory 210" });
    const o = within(khay).getByRole("textbox", { name: /Số lượng Ivory 210/ });
    fireEvent.change(o, { target: { value: "10" } });
    fireEvent.click(within(khay).getByRole("button", { name: "Xong" }));
    expect(screen.queryByRole("dialog", { name: "Ivory 210" })).toBeNull();
    expect(dongDt("Ivory 210").textContent).toMatch(/^Ivory 210\s*10/);
  });

  it("dòng kế hoạch có Về 0, dòng ngoài kế hoạch có Bỏ dòng; không có thẻ Lệnh sản xuất", async () => {
    ve(congViec({}));
    await screen.findByText("Ivory 210");
    expect(screen.queryByText("Lệnh sản xuất")).toBeNull();
    expect(screen.queryByText("khoá theo công việc")).toBeNull();
    // Đầu ngăn nói tên việc thay thẻ lệnh.
    expect(screen.getByText("Cắt tờ của LSX26-0004")).toBeTruthy();

    fireEvent.click(dongDt("Ivory 210"));
    let khay = screen.getByRole("dialog", { name: "Ivory 210" });
    expect(within(khay).queryByRole("button", { name: "Bỏ dòng" })).toBeNull();
    fireEvent.click(within(khay).getByRole("button", { name: "Về 0" }));
    expect(screen.queryByRole("dialog", { name: "Ivory 210" })).toBeNull();
    expect(dongDt("Ivory 210").textContent).toMatch(/^Ivory 210\s*0/);

    fireEvent.click(dongDt("Couche 150"));
    khay = screen.getByRole("dialog", { name: "Couche 150" });
    expect(within(khay).queryByRole("button", { name: "Về 0" })).toBeNull();
    fireEvent.click(within(khay).getByRole("button", { name: "Bỏ dòng" }));
    expect(screen.queryByText("Couche 150")).toBeNull();
    expect(screen.getByText("1 mặt hàng")).toBeTruthy();
  });

  it("Cần xuất lúc và Ghi chú là một dòng, chạm mới mở; gửi dùng chung đường gửi của bản máy tính", async () => {
    const onGui = vi.fn().mockResolvedValue(undefined);
    ve(congViec({ onGui }));
    await screen.findByText("Ivory 210");
    expect(screen.queryByRole("textbox", { name: "Ghi chú" })).toBeNull();
    const dongLuc = screen.getByRole("button", { name: /^Cần xuất lúc/ });
    expect(dongLuc.textContent).toContain("09/10 10:00");

    fireEvent.click(dongLuc);
    const khayLuc = screen.getByRole("dialog", { name: "Cần xuất lúc" });
    fireEvent.click(within(khayLuc).getByRole("button", { name: "Lúc bắt đầu việc" }));
    fireEvent.click(within(khayLuc).getByRole("button", { name: "Xong" }));
    expect(screen.getByRole("button", { name: /^Cần xuất lúc/ }).textContent).toContain("09/10 13:30");

    fireEvent.click(screen.getByRole("button", { name: /^Ghi chú/ }));
    const khayGhi = screen.getByRole("dialog", { name: "Ghi chú" });
    fireEvent.change(within(khayGhi).getByRole("textbox", { name: "Ghi chú" }), { target: { value: "Anh Hoan ra nhận" } });
    fireEvent.click(within(khayGhi).getByRole("button", { name: "Xong" }));
    expect(screen.getByRole("button", { name: /^Ghi chú/ }).textContent).toContain("Anh Hoan ra nhận");

    fireEvent.click(screen.getByRole("button", { name: /Gửi kho/ }));
    await waitFor(() => expect(onGui).toHaveBeenCalledTimes(1));
    const p = onGui.mock.calls[0][0];
    expect(p.can_luc).toBe("2026-10-09T13:30:00");
    expect(p.ghi_chu).toBe("Anh Hoan ra nhận");
    expect(p.dong).toHaveLength(2);
    expect(taoKho).not.toHaveBeenCalled();
  });

  it("form mở từ trang Kho cũng đổi sang danh sách", async () => {
    render(
      <TaoYeuCauP2 token="token-test" canRequest onClose={vi.fn()} onSaved={vi.fn()}
        seed={[dong({ sl_de_nghi: 30 })]} />,
    );
    await screen.findByText("Ivory 210");
    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByRole("radio", { name: "Xuất" })).toBeTruthy();
    fireEvent.click(dongDt("Ivory 210"));
    const khay = screen.getByRole("dialog", { name: "Ivory 210" });
    expect(within(khay).getByRole("button", { name: "Bỏ dòng" })).toBeTruthy();
    expect(within(khay).getByRole("textbox", { name: /Số lượng Ivory 210/ })).toBeTruthy();
  });

  it("nhập từ đợt giao: dòng nói tồn SAU nhập như cột máy tính, có dòng Giá trị nhập", async () => {
    coQuyenGia = true;
    // Ivory khổ 790 × 1090 đang tồn 200 tờ; Couche khổ 650 × 860 chưa có trong kho.
    tonKhoa.mockImplementation((_t: string, _hl: string, id: number) => Promise.resolve(id === 1
      ? [{ kho_rong: 790, kho_dai: 1090, ton: 200, don_vi_goc: "to", don_vi_goc_ten: "tờ" }]
      : []));
    render(
      <TaoYeuCauP2 token="token-test" canRequest onClose={vi.fn()} onSaved={vi.fn()}
        seedLoai="NHAP" seedLocked seedNgayCan="2026-10-09" seedDonMuaMa="PM26-0007" seedDotSo={2}
        seed={[
          dong({ sl_de_nghi: 100, don_gia: 1500 }),
          dong({ hang_id: 2, hang_ma: "CO150", hang_ten: "Couche 150", sl_de_nghi: 40, don_gia: 2000, kho_rong: 650, kho_dai: 860 }),
        ]} />,
    );
    await screen.findAllByText("Ivory 210");
    expect(document.querySelector("table")).toBeNull();
    // Dòng khoá theo đợt giao: không chạm được, không có khay.
    expect(screen.queryByRole("button", { name: /^Ivory 210/ })).toBeNull();
    const ivory = screen.getAllByText("Ivory 210").map((x) => x.closest(".kfd-dong")).find(Boolean) as HTMLElement;
    // Như cột máy tính "t đến t+sl": tồn trước và tồn sau nhập là hai mẩu riêng.
    await waitFor(() => expect(within(ivory).getByText("sau nhập 300")).toBeTruthy());
    expect(within(ivory).getByText("Tồn 200")).toBeTruthy();
    const couche = screen.getAllByText("Couche 150").map((x) => x.closest(".kfd-dong")).find(Boolean) as HTMLElement;
    await waitFor(() => expect(within(couche).getByText("Khổ mới trong kho")).toBeTruthy());
    // 100 × 1.500 + 40 × 2.000 = 230.000 đ
    expect(screen.getByText("Giá trị nhập")).toBeTruthy();
    expect(screen.getByText("230.000 đ")).toBeTruthy();
    // Tiền từng món dưới dòng tổng: Ivory 100 × 1.500, Couche 40 × 2.000.
    const monIvory = screen.getAllByText("Ivory 210").map((x) => x.closest(".kfd-gt__mon")).find(Boolean) as HTMLElement;
    expect(within(monIvory).getByText("150.000")).toBeTruthy();
    const monCouche = screen.getAllByText("Couche 150").map((x) => x.closest(".kfd-gt__mon")).find(Boolean) as HTMLElement;
    expect(within(monCouche).getByText("80.000")).toBeTruthy();
    expect(screen.getByText("PM26-0007")).toBeTruthy();
  });

  it("dòng trống đơn vị tự nhận đơn vị gốc khi danh sách đơn vị về, và gửi đi kèm đơn vị đó", async () => {
    donVi.mockResolvedValue({ ds: [{ ma: "kg", ten: "kg", he_so_ve_goc: 1, la_goc: true }], don_vi_goc: "kg", ly_do: null });
    const onGui = vi.fn().mockResolvedValue(undefined);
    ve(congViec({
      onGui,
      dong: [dong({
        hang_loai: "vat_tu", hang_id: 12, hang_ma: "KEO", hang_ten: "Keo dán gáy EVA", dvt: "", he_so_ve_goc: null,
        don_vi_goc: null, kho_rong: 0, kho_dai: 0, sl_de_nghi: 3, sl_nen: 3, theo_ke_hoach: true,
        canh: "Chưa có đơn vị tính. Để ở 0 thì vẫn gửi được, muốn xin thì nhờ kỹ thuật kiểm lại đơn vị.",
      })],
    }));
    await screen.findByText("Keo dán gáy EVA");
    await waitFor(() => expect(screen.queryByText("Chưa có đơn vị tính")).toBeNull());
    expect(donVi).toHaveBeenCalledWith("token-test", "vat_tu", 12);
    expect(screen.getByRole("button", { name: /^Keo dán gáy EVA/ }).textContent).toMatch(/3\s*kg/);

    fireEvent.click(screen.getByRole("button", { name: /Gửi kho/ }));
    await waitFor(() => expect(onGui).toHaveBeenCalledTimes(1));
    const keo = onGui.mock.calls[0][0].dong[0];
    expect(keo.dvt).toBe("kg");
    expect(keo.sl_de_nghi).toBe(3);
  });

  it("khay giữ tiêu điểm: Tab ở nút cuối quay về ô đầu, Shift+Tab ở ô đầu sang nút cuối", async () => {
    ve(congViec({}));
    await screen.findByText("Couche 150");
    fireEvent.click(dongDt("Couche 150"));
    const khay = screen.getByRole("dialog", { name: "Couche 150" });
    const xong = within(khay).getByRole("button", { name: "Xong" });
    xong.focus();
    fireEvent.keyDown(xong, { key: "Tab" });
    const dau = document.activeElement as HTMLElement;
    expect(khay.contains(dau)).toBe(true);
    expect(dau).not.toBe(xong);
    fireEvent.keyDown(dau, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(xong);
  });
});

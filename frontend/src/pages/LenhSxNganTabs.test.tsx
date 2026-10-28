// Ngăn hồ sơ lệnh theo phương án C (27/10/2026): bốn tab như ngăn Việc của tổ, cột phải đứng yên là
// dải "Hàng đang tới đâu", tab Quy cách dùng ĐÚNG thẻ quy cách của ngăn tổ, số kế hoạch to in gọn.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { LenhSxNganOut, LenhSxRoutingNode } from "../api/client";
import { AuthContext, type AuthState } from "../auth/AuthContext";
import { LenhSxNgan, soGon } from "./LenhSxNgan";

const AUTH: AuthState = {
  status: "authenticated", user: null, token: "t",
  login: async () => {}, logout: async () => {},
  updateUser: () => {}, notice: null, setNotice: () => {},
};

function buoc(id: number, ten: string, to: string, trang_thai: string, lam_ra: number): LenhSxRoutingNode {
  return {
    id, thu_tu: id, lop: id, phu_thuoc: [], ten, nhom: null, loai_buoc: "may", bat_buoc: true,
    nha_cung_cap: null, cong_viec_id: id, la_buoc_ghep: false, bai_ghep_ma: null, la_buoc_hien_tai: false,
    trang_thai, may: null, to, nguoi: [], du_kien_bat_dau: null, du_kien_ket_thuc: null, hoan_thanh_luc: null,
    so_luong_vao: 1e9, so_luong_ra: 1e9, don_vi_vao: "to", don_vi_ra: "to", don_vi_ra_ten: "tờ",
    can_khuon: false, khuon_da_nhan: false, khuon_be_ma: null, khuon_be_ten: null, khuon_be_so_ke: null,
    khuon_be_tinh_trang: null, kcs_khong_dat: 0, lam_ra,
  } as LenhSxRoutingNode;
}

const NGAN = {
  thong_tin: {
    id: 104, ma: "T08-104", ten: "LONG THỦY", loai: null, order_id: null, order_no: "DH-SOT08", order_line_id: null,
    khach_hang: "Khách sổ T08", khach_hang_id: null, sale: null, so_luong_dat: 1, don_vi_tinh: "cái", is_rush: false,
    han_hoan_thanh_sx: null, han_giao_khach: null, ban_giao_at: null, ghi_chu: null, tao_luc: null, da_dong: false,
    nhom_ten: "Lệnh 104 — LONG THỦY",
  },
  tien_do: {
    phan_tram: 0, uoc_tinh: false, gio_may: 0, du_kien_xong: null, trang_thai: "dang_sx",
    canh_bao: ["thieu_vat_tu"], buoc_hien_tai: null, buoc_hien_tai_cong_viec_id: null, nhom_cong_doan: null,
    may: null, nguoi: [], da_giao: 0, khau: "dang_sx", khau_chi_tiet: null, vat_tu_chu: "Chưa giữ chỗ vật tư",
  },
  thong_so: {
    giay_ten: null, dinh_luong: null, kho_nguyen_dai: null, kho_nguyen_rong: null, kho_in_dai: null, kho_in_rong: null,
    dai_thanh_pham: null, rong_thanh_pham: null, quy_cach_in: null, so_mau_a: null, so_mau_b: null, muc_a: [], muc_b: [],
    so_trang: null, trang_moi_tay: null, so_kem: null, so_manh_xa: null, ghi_chu_ky_thuat: null,
    so_con: 1, so_to_ke_hoach: 0, so_to_nguyen: 0, don_vi_tinh: null,
  },
  routing: {
    nodes: [buoc(1, "Cắt, tề (theo kg)", "Cắt 1", "completed", 10000), buoc(2, "Bế carton 3 lớp", "Bế TD - Linh", "running", 6517)],
    canh: [],
  },
  kcs: { tong_nhan: 0, tong_dat: 0, tong_khong_dat: 0, ty_le_dat: null, batch: [] },
  kho: { so_lenh_trong_nhom: 1, yeu_cau: [] },
  phien_ban: 1,
  tron_goi: null,
  kcs_cuoi: { so_lan: 0, nhan: 0, dat: 0, khong_dat: 0 },
  su_co: [],
  timeline: [{ loai: "san_luong", luc: "2026-10-20T08:10:00+07:00", nguoi_id: null, nguoi: null, cong_viec_id: 1, ten_viec: "Cắt", noi_dung: "Ghi sản lượng" }],
  quy_cach: { dinh_luong: 240, kho_nguyen: "970 × 945", cach_in: "mot_mat", so_mau: 1 },
  dai_duoi: { loai: "ve_kho", so: null, don_vi: "cai" },
} as unknown as LenhSxNganOut;

function ve() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/ngan")) return new Response(JSON.stringify(NGAN), { status: 200 });
    return new Response(JSON.stringify([]), { status: 200 });
  }));
  return render(
    <AuthContext.Provider value={AUTH}>
      <LenhSxNgan lsxId={104} onDong={() => {}} />
    </AuthContext.Provider>,
  );
}

describe("LenhSxNgan · phương án C", () => {
  it("số kế hoạch to in gọn, số nhỏ in đủ", () => {
    expect(soGon(1_000_000_000)).toBe("1 tỷ");
    expect(soGon(2_500_000)).toBe("2,5 triệu");
    expect(soGon(9800)).toBe("9.800");
  });

  it("bốn tab như Việc của tổ; mở ra ở Quy cách với thẻ quy cách của ngăn tổ", async () => {
    ve();
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent?.replace(/\d+$/, "").trim())).toEqual(["Quy cách", "Sản lượng", "Kho và giao", "Lịch sử"]);
    expect(await screen.findByText("Khổ giấy nguyên")).toBeInTheDocument();
    expect(screen.getByText("240 gsm")).toBeInTheDocument();
    // Ở xưởng: không có lần bấm Bắt đầu thì lấy lần ghi sản lượng sớm nhất, không còn "Chưa bắt đầu".
    expect(screen.queryByText("Chưa bắt đầu")).toBeNull();
  });

  it("cột phải đứng yên qua các tab: vướng là chip, dải bước, ô đuôi về kho", async () => {
    ve();
    const dai = (await screen.findByText("Hàng đang tới đâu")).closest("section") as HTMLElement;
    expect(within(dai).getByText("Hàng đang ở Bế carton 3 lớp")).toBeInTheDocument();
    expect(within(dai).getByText("1 trên 2 bước đã xong")).toBeInTheDocument();
    expect(within(dai).getByText("Nhập kho thành phẩm")).toBeInTheDocument();
    expect(screen.getByLabelText("Đang vướng")).toHaveTextContent("Chưa giữ chỗ vật tư");

    await userEvent.click(screen.getByRole("tab", { name: /Sản lượng/ }));
    expect(screen.getByText("Hàng đang tới đâu")).toBeInTheDocument();
    expect(screen.getAllByText("/ 1 tỷ").length).toBeGreaterThan(0);
  });
});

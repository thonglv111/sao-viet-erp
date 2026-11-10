// Màn Theo dõi sản xuất THEO ĐƠN (12/10/2026): chip đếm do máy chủ trả, chọn chip/điều kiện gửi tham số
// lên máy chủ, 403 nói đúng tên màn, bấm dòng mở ngăn bảng mặt hàng; đơn một món bung sẵn routing, nhiều
// món thì chip lọc món và bấm món để bung; mã lệnh chỉ bấm được khi có quyền Hồ sơ lệnh.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModuleCapability, TdsxBuoc, TdsxDonChiTiet, TdsxDonDong, TdsxMon, TdsxTheoDonOut } from "../api/client";
import { AuthContext, type AuthState } from "../auth/AuthContext";
import { PermissionsProvider, buildCapabilities } from "../auth/permissions";
import { TheoDoiSanXuatPage } from "./TheoDoiSanXuatPage";

const AUTH: AuthState = {
  status: "authenticated", user: null, token: "t",
  login: async () => {}, logout: async () => {},
  updateUser: () => {}, notice: null, setNotice: () => {},
};

const DONG: TdsxDonDong = {
  order_id: 7, order_no: "DH007", khach_hang: "Công ty Sao", phu_trach: "Huyên", so_mon: 1,
  mon_dau: "Hộp thuốc", so_luong: 1000, don_vi: "cái", chang: "sx", chang_ket: true,
  dai_dien: {
    ten: "Hộp thuốc", o: "xuong", nhom: "vuong", dat: 1000, don_vi: "cái", kho_da_nhan: 0, da_giao: 0,
    buoc: "Cán màng", buoc_so: 2, buoc_tong: 3, pct: 40, nha_gia_cong: null,
  },
  so_mon_kho: 0, so_mon_giao: 0, han_giao: "2026-10-20",   tre_ngay: null, con_ngay: 8, vuong: { so_mon: 1, ly_do: "thieu_vat_tu", buoc: "Cán màng" },
  nhom: "dang_lam", can_de_y: true,
};

const LIST: TdsxTheoDonOut = {
  items: [DONG], total: 1, page: 1, page_size: 25,
  dem: { tat_ca: 1, can_de_y: 1, dang_lam: 1, cho_giao: 0, da_giao: 0 },
};

const buoc = (ten: string, trang_thai: string, hien_tai = false): TdsxBuoc => ({
  ten, to: "Tổ " + ten, ngoai: false, nha_cung_cap: null, trang_thai, hien_tai,
  hoan_thanh_luc: trang_thai === "xong" ? "2026-10-11T09:00:00" : null, kcs_khong_dat: 0,
  lam_ra: trang_thai === "xong" ? 1000 : 0, ke_hoach_ra: 1000, don_vi_ra: "tờ",
});

const mon = (khoa: string, ten: string, nhom: TdsxMon["nhom"], lsxId: number): TdsxMon => ({
  khoa, ten, dat: 1000, don_vi: "cái", o: nhom === "kho" ? "du_hang" : "xuong", nhom,
  co: nhom === "vuong" ? ["thieu_vat_tu"] : [], kho_da_nhan: nhom === "kho" ? 1000 : 0, da_giao: 0,
  buoc: "Cán màng", buoc_so: 2, buoc_tong: 3, pct: 40, nha_gia_cong: null,
  lam_ra: null, co_hang: nhom === "kho" ? 1000 : 0, co_tu_ton: 0, dang_giu: 0, con_phai_giao: 1000,
  lenh: [{
    id: lsxId, ma: `LSX26-00${lsxId}`, ten, o: "xuong", xong: false, co: [], da_xuong: true,
    tron_goi: false, nha_gia_cong: null, buoc: "Cán màng", buoc_so: 2, buoc_tong: 3, pct: 40,
    buoc_ds: [buoc("In", "xong"), buoc(`Cán màng ${ten}`, "dung", true), buoc("Đóng gói", "cho")],
    lam_ra: 0, ke_hoach_ra: 1000, don_vi_ra: "cái",
  }],
});

const CT_MOT: TdsxDonChiTiet = {
  don: DONG, mon: [mon("c1", "Hộp thuốc", "vuong", 31)], giao_xuong_luc: "2026-10-10T15:22:00Z",
  // 02:00 UTC = 09:00 giờ xưởng, Chủ nhật 11/10.
  lich_su: [{ luc: "2026-10-11T02:00:00Z", loai: "xong_buoc", noi_dung: "Xong In", lenh: "LSX26-0031" }],
};
const CT_NHIEU: TdsxDonChiTiet = {
  don: { ...DONG, so_mon: 2, so_mon_kho: 1 },
  mon: [mon("c1", "Hộp thuốc", "dang", 31), mon("c2", "Tờ hướng dẫn", "kho", 32)],
  lich_su: [], giao_xuong_luc: null,
};

type Tuy = { list?: TdsxTheoDonOut; ct?: TdsxDonChiTiet; status?: number };

function stubApi(t: Tuy = {}): string[] {
  const goi: string[] = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    goi.push(url);
    let data: unknown = [];
    let status = 200;
    if (url.includes("/api/theo-doi-san-xuat/khach-loc")) data = [{ id: 9, ten: "Công ty Sao", so: 1 }];
    else if (url.includes("/api/theo-doi-san-xuat/phu-trach-loc")) data = [{ id: 4, ten: "Huyên", so: 1 }];
    else if (url.includes("/api/theo-doi-san-xuat/theo-don/")) data = t.ct ?? CT_MOT;
    else if (url.includes("/api/theo-doi-san-xuat/theo-don")) {
      status = t.status ?? 200;
      data = status === 200 ? (t.list ?? LIST) : { detail: "Không có quyền" };
    }
    return Promise.resolve({
      ok: status < 400, status, headers: new Headers({ "content-type": "application/json" }),
      json: async () => data, text: async () => JSON.stringify(data),
    } as Response);
  }));
  return goi;
}

function ve(coHoSo = true, navigate = vi.fn()) {
  const caps = buildCapabilities([
    { module_key: "theo_doi_san_xuat", scope: "all", can_read: true } as ModuleCapability,
    ...(coHoSo ? [{ module_key: "lenh_san_xuat", scope: "all", can_read: true } as ModuleCapability] : []),
  ]);
  render(
    <AuthContext.Provider value={AUTH}>
      <PermissionsProvider caps={caps}>
        <TheoDoiSanXuatPage navigate={navigate} />
      </PermissionsProvider>
    </AuthContext.Provider>,
  );
  return navigate;
}

const goiToi = (goi: string[], duong: string) => goi.filter((u) => u.includes(duong));

describe("TheoDoiSanXuatPage · theo đơn", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("⭐ một dòng một đơn: đang làm, hạn giao còn N ngày, đang vướng thành câu", async () => {
    stubApi();
    ve();
    expect(await screen.findByText("DH007")).toBeInTheDocument();
    expect(screen.getByText("Cán màng")).toBeInTheDocument();
    expect(screen.getByText("bước 2 trên 3")).toBeInTheDocument();
    expect(screen.getByText("còn 8 ngày")).toBeInTheDocument();
    expect(screen.getByText("Thiếu vật tư ở Cán màng")).toBeInTheDocument();
  });

  it("⭐ chip đếm do máy chủ trả; bấm chip gửi chip= lên máy chủ", async () => {
    const goi = stubApi();
    ve();
    const canDeY = await screen.findByRole("button", { name: /^Cần để ý/ });
    await waitFor(() => expect(canDeY.textContent).toBe("Cần để ý1"));
    expect(screen.getByRole("button", { name: /^Chờ giao/ }).className).toContain("z");
    await userEvent.click(canDeY);
    await waitFor(() => expect(goiToi(goi, "chip=can_de_y")).toHaveLength(1));
  });

  it("⭐ điều kiện Khách hàng gửi khach_hang_id", async () => {
    const goi = stubApi();
    ve();
    await userEvent.click(await screen.findByRole("button", { name: "Lọc" }));
    expect(screen.getByRole("menuitem", { name: /Phụ trách/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: /Khách hàng/ }));
    await userEvent.click(await screen.findByRole("radio", { name: /Công ty Sao/ }));
    await waitFor(() => expect(goiToi(goi, "khach_hang_id=9")).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: "Bỏ lọc Khách hàng" }));
  });

  it("⭐ 403 ⇒ nói đúng thiếu quyền Theo dõi sản xuất, không nút Thử lại", async () => {
    stubApi({ status: 403 });
    ve();
    expect(await screen.findByText("Bạn không có quyền xem Theo dõi sản xuất.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
  });

  it("⭐ bấm dòng ⇒ ngăn đơn; đơn một món bung sẵn tuyến bước; mã lệnh sang Hồ sơ lệnh", async () => {
    const goi = stubApi();
    const nav = ve();
    await userEvent.click(await screen.findByText("DH007"));
    await waitFor(() => expect(goiToi(goi, "/theo-don/7")).toHaveLength(1));
    expect(await screen.findByText("Cán màng Hộp thuốc")).toBeInTheDocument();
    expect(screen.getByText("Đang ở Cán màng")).toBeInTheDocument();
    expect(screen.getByText("/ 1.000 cái", { exact: false })).toBeInTheDocument();
    // Cột phải: giao xưởng theo giờ xưởng, giao hàng nói phần chưa lên yêu cầu.
    expect(screen.getByText("10/10 22:22")).toBeInTheDocument();
    expect(screen.getByText("Chưa lên yêu cầu giao")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "LSX26-0031" }));
    expect(nav).toHaveBeenCalledWith("lenh-san-xuat", { openHoSoLsxId: 31 });
  });

  it("⭐ tab Lịch sử: chia theo ngày giờ xưởng, giờ UTC quy về +7", async () => {
    stubApi();
    ve();
    await userEvent.click(await screen.findByText("DH007"));
    await userEvent.click(await screen.findByRole("tab", { name: /Lịch sử/ }));
    expect(await screen.findByText("Chủ nhật 11/10")).toBeInTheDocument();
    expect(screen.getByText("09:00")).toBeInTheDocument();
    expect(screen.getByText("Xong In")).toBeInTheDocument();
  });

  it("không có quyền Hồ sơ lệnh ⇒ mã lệnh là chữ, không bấm được", async () => {
    stubApi();
    ve(false);
    await userEvent.click(await screen.findByText("DH007"));
    expect(await screen.findByText("LSX26-0031")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "LSX26-0031" })).toBeNull();
  });

  it("⭐ đơn nhiều món: chip lọc món, bấm món mới bung routing của món đó", async () => {
    stubApi({ ct: CT_NHIEU });
    ve();
    await userEvent.click(await screen.findByText("DH007"));
    const bang = await screen.findByRole("table", { name: /Mặt hàng của đơn DH007/ });
    expect(within(bang).getByText("Tờ hướng dẫn")).toBeInTheDocument();
    // Không món nào vướng ⇒ chưa bung món nào.
    expect(screen.queryByText("Cán màng Hộp thuốc")).toBeNull();

    await userEvent.click(within(bang).getByText("Hộp thuốc"));
    expect(screen.getByText("Cán màng Hộp thuốc")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Đã nhập kho/ }));
    expect(within(bang).queryByText("Hộp thuốc")).toBeNull();
    expect(within(bang).getByText("Tờ hướng dẫn")).toBeInTheDocument();
  });
});

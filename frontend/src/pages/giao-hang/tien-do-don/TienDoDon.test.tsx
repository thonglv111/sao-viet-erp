// Bước "Giao hàng" trong drawer đơn — luật chốt 19/09/2026: KHÔNG lập yêu cầu giao cho phần chưa
// nhập kho. Ô số lượng điền sẵn và TRẦN theo `giao_duoc` máy chủ tính; sản phẩm chưa có hàng trong
// kho thì không có ô.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BuocGiaoHang, tomTatTienDo, viecTiepTheo } from "./TienDoDon";
import { BangSanXuatMon } from "./SanXuatMon";
import { AuthContext, type AuthState } from "../../../auth/AuthContext";
import { PermissionsProvider, buildCapabilities } from "../../../auth/permissions";
import type { DonTienDo, DonTienDoCum, LenhMon, ModuleCapability, OrderDetail } from "../../../api/client";

const AUTH: AuthState = {
  status: "authenticated", user: null, token: "t",
  login: async () => {}, logout: async () => {},
  updateUser: () => {}, notice: null, setNotice: () => {},
};

function cum(o: Partial<DonTienDoCum>): DonTienDoCum {
  return {
    khoa: "k", ten: "Hộp", don_vi: "hộp", order_line_ids: [11], dat: 100, co_lenh: true, lenh: [],
    sx_pct: 50, sx_xong: false, kho_de_nghi: 60, kho_da_nhan: 40, cho_kho: 20, ton_that: 40,
    da_giao: 0, giao_thang: 0, o: null, lenh_o: [], dang_giu: 0, con_phai_giao: 100, giao_duoc: 40, ...o,
  };
}

const TD: DonTienDo = {
  order_id: 3, han_cam_ket: null, du_kien_xong: null, chua_du_du_lieu: false, tre_ngay: null, dang_cho: [],
  ly_do: [],
  cum: [
    cum({ khoa: "hop", ten: "Hộp thuốc", order_line_ids: [11] }),
    cum({ khoa: "to", ten: "Tờ hướng dẫn", order_line_ids: [12], kho_da_nhan: 0, ton_that: 0, giao_duoc: 0 }),
  ],
  yeu_cau: [],
  noi_nhan: {
    khach_id: 7, dia_chi: "Lô C3", nguoi_nhan: "Chị Hạnh", sdt: "0938", luu_y: "Gọi trước 30 phút",
    so_dia_chi: [{ id: 21, nhan: "Kho Bắc Ninh", dia_chi: "KCN Quế Võ", sdt: null, mac_dinh: true }],
    lien_he: [{ id: 31, ten: "Anh Tùng", chuc_vu: "Thủ kho", sdt: "0912", chinh: false }],
  },
};

const ORDER = {
  id: 3, status: "ordered", delivery_address: "Lô C3", delivery_contact_name: "Chị Hạnh",
  delivery_contact_phone: "0938",
} as unknown as OrderDetail;

function ngayMai(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function stubApi() {
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === "POST") posts.push(JSON.parse(String(init.body)));
    return Promise.resolve({
      ok: true, status: 201, headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({}), text: async () => "{}",
    } as Response);
  }));
  return posts;
}

function ve(td: DonTienDo = TD) {
  const caps = buildCapabilities([
    { module_key: "giao_hang", scope: "all", can_read: true, can_create: true } as ModuleCapability,
  ]);
  return render(
    <AuthContext.Provider value={AUTH}>
      <PermissionsProvider caps={caps}>
        <BuocGiaoHang order={ORDER} td={td} taiLai={() => {}} onIn={() => {}} />
      </PermissionsProvider>
    </AuthContext.Provider>,
  );
}

beforeEach(() => vi.unstubAllGlobals());

describe("Bước Giao hàng · chỉ giao phần kho đã nhận", () => {
  it("điền sẵn phần giao được, sản phẩm chưa có hàng không có ô, gửi đúng dòng đầu cụm", async () => {
    const posts = stubApi();
    ve();
    await userEvent.click(screen.getByRole("button", { name: "Tạo yêu cầu giao hàng" }));
    const o = screen.getByLabelText("Số lượng giao — Hộp thuốc") as HTMLInputElement;
    expect(o.value).toBe("40");
    expect(o.max).toBe("40");
    expect(screen.queryByLabelText("Số lượng giao — Tờ hướng dẫn")).toBeNull();
    expect(screen.getByText(/Chưa có hàng trong kho: Tờ hướng dẫn/)).toBeInTheDocument();

    const ngay = screen.getByPlaceholderText("dd/mm/yyyy") as HTMLInputElement;
    // Yêu cầu mới điền sẵn HÔM NAY — đổi ngày thì gõ đè rồi rời ô (rời ô là chốt).
    expect(ngay.value).not.toBe("");
    fireEvent.change(ngay, { target: { value: ngayMai().split("-").reverse().join("/") } });
    fireEvent.blur(ngay);
    await userEvent.click(screen.getByRole("button", { name: "Gửi yêu cầu" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].lines).toEqual([{ order_line_id: 11, qty: 40 }]);
    // Không đổi gì ⇒ nơi nhận theo đơn; không có ô gõ tay nào.
    expect(posts[0]).toMatchObject({ dia_chi_id: null, lien_he_id: null });
    // Ô ngày tự vẽ cũng là textbox — loại nó ra, còn lại không được có ô gõ tay nào.
    expect(screen.queryAllByRole("textbox").filter((el) => el.getAttribute("placeholder") !== "dd/mm/yyyy")).toHaveLength(0);
  });

  it("nơi nhận CHỌN trong sổ của khách, lưu ý giao lấy của đơn", async () => {
    const posts = stubApi();
    ve();
    await userEvent.click(screen.getByRole("button", { name: "Tạo yêu cầu giao hàng" }));
    expect(screen.getByText("Gọi trước 30 phút")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Kho Bắc Ninh" }));
    await userEvent.click(screen.getByRole("radio", { name: "Anh Tùng" }));
    const ngay = screen.getByPlaceholderText("dd/mm/yyyy") as HTMLInputElement;
    // Yêu cầu mới điền sẵn HÔM NAY — đổi ngày thì gõ đè rồi rời ô (rời ô là chốt).
    expect(ngay.value).not.toBe("");
    fireEvent.change(ngay, { target: { value: ngayMai().split("-").reverse().join("/") } });
    fireEvent.blur(ngay);
    await userEvent.click(screen.getByRole("button", { name: "Gửi yêu cầu" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ dia_chi_id: 21, lien_he_id: 31 });
  });

  it("hàng giữ cho đơn khác chỉ được nhắc khi chính nó làm giao được thấp hơn phần còn phải giao", () => {
    const mot = (o: Partial<DonTienDoCum>) => ({ ...TD, cum: [cum({
      ton_kho: [{ kho_ten: "Kho thành phẩm", so_luong: 7820 }] as DonTienDoCum["ton_kho"], giu_don_khac: 5001, ...o,
    })] });
    // Tồn dư đủ phần còn lại ⇒ không nhắc giữ hàng, nói kho có hàng.
    const { unmount } = ve(mot({ con_phai_giao: 2500, giao_duoc: 2500 }));
    expect(screen.queryByText(/đang giữ cho đơn khác/)).toBeNull();
    expect(screen.getByText("Kho thành phẩm")).toBeInTheDocument();
    unmount();
    // Giữ hàng làm hụt ⇒ nói lý do.
    ve(mot({ con_phai_giao: 2500, giao_duoc: 319 }));
    expect(screen.getByText("5.001 trong 7.820 hộp ở kho đang giữ cho đơn khác")).toBeInTheDocument();
  });

  it("đơn lẫn khách đều chưa có địa chỉ ⇒ báo bổ sung ở hồ sơ khách, khoá Gửi", async () => {
    stubApi();
    ve({ ...TD, noi_nhan: { ...TD.noi_nhan, dia_chi: null, so_dia_chi: [] } });
    await userEvent.click(screen.getByRole("button", { name: "Tạo yêu cầu giao hàng" }));
    expect(screen.getByText(/chưa có địa chỉ giao — thêm ở hồ sơ khách hàng/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gửi yêu cầu" })).toBeDisabled();
  });

  it("gõ vượt phần giao được ⇒ báo ngay và khoá nút Gửi", async () => {
    stubApi();
    ve();
    await userEvent.click(screen.getByRole("button", { name: "Tạo yêu cầu giao hàng" }));
    const o = screen.getByLabelText("Số lượng giao — Hộp thuốc");
    await userEvent.clear(o);
    await userEvent.type(o, "41");
    expect(screen.getByText(/Vượt — giao được tối đa 40/)).toBeInTheDocument();
    expect(screen.getByText("Số lượng vượt phần giao được")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gửi yêu cầu" })).toBeDisabled();
  });

  it("kho chưa nhận gì ⇒ nút tạo yêu cầu khoá kèm lý do", () => {
    stubApi();
    ve({ ...TD, cum: TD.cum.map((c) => ({ ...c, giao_duoc: 0 })) });
    expect(screen.getByRole("button", { name: "Tạo yêu cầu giao hàng" })).toBeDisabled();
    expect(screen.getByText(/Chưa có hàng của đơn này ở kho nào/)).toBeInTheDocument();
  });

  it("yêu cầu có chuyến đã huỷ ⇒ Kinh doanh huỷ được, không sửa được", () => {
    stubApi();
    ve({
      ...TD,
      yeu_cau: [{
        id: 5, code: "YCGH-0005", ngay_can_giao: ngayMai(), trang_thai: "chuyen_da_huy", ly_do_huy: null,
        dia_chi: "Lô C3", nguoi_nhan: null, sdt_nguoi_nhan: null, ghi_chu: null, created_at: "",
        dong: [{ order_line_id: 11, ten: "Hộp thuốc", qty: 40, da_giao: 0 }],
        chuyen: {
          id: 9, trang_thai: "da_huy", tai_xe: "Anh Tư",
          xe: null, thoi_gian_ket_thuc: null, nguoi_nhan_thuc_te: null, ly_do_that_bai: null,
          tra_hang_ma: null, tra_hang_xong: false, so_anh: 0,
        },
      }],
    });
    expect(screen.getByText("Chuyến đã huỷ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Huỷ" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sửa" })).toBeNull();
  });

  it("in phiếu giao chỉ mở khi kho đã ghi sổ phiếu xuất", () => {
    stubApi();
    const yc = (khoDaXuat: boolean) => ({
      ...TD,
      yeu_cau: [{
        id: 6, code: "YCGH-0006", ngay_can_giao: ngayMai(), trang_thai: "dang_thuc_hien" as const, ly_do_huy: null,
        dia_chi: "Lô C3", nguoi_nhan: null, sdt_nguoi_nhan: null, ghi_chu: null, created_at: "",
        dong: [{ order_line_id: 11, ten: "Hộp thuốc", qty: 40, da_giao: 0 }],
        chuyen: {
          id: 10, trang_thai: "dang_chuan_bi" as const, tai_xe: "Anh Tư",
          xe: null, thoi_gian_ket_thuc: null, nguoi_nhan_thuc_te: null, ly_do_that_bai: null,
          tra_hang_ma: null, tra_hang_xong: false, kho_da_lap_phieu: true, kho_da_xuat: khoDaXuat, so_anh: 0,
        },
      }],
    });
    const { unmount } = ve(yc(false));
    expect(screen.queryByRole("button", { name: "In phiếu giao" })).toBeNull();
    expect(screen.getByText("chờ kho xuất mới in")).toBeInTheDocument();
    unmount();
    ve(yc(true));
    expect(screen.getByRole("button", { name: "In phiếu giao" })).toBeInTheDocument();
  });

  it("chuyến thất bại ⇒ không có nút In phiếu giao: khách không nhận gì để ký (#34)", () => {
    stubApi();
    ve({
      ...TD,
      yeu_cau: [{
        id: 6, code: "YCGH-0006", ngay_can_giao: ngayMai(), trang_thai: "that_bai" as const, ly_do_huy: null,
        dia_chi: "Lô C3", nguoi_nhan: null, sdt_nguoi_nhan: null, ghi_chu: null, created_at: "",
        dong: [{ order_line_id: 11, ten: "Hộp thuốc", qty: 40, da_giao: 0 }],
        chuyen: {
          id: 10, trang_thai: "dang_tra_hang" as const, tai_xe: "Anh Tư",
          xe: null, thoi_gian_ket_thuc: null, nguoi_nhan_thuc_te: null, ly_do_that_bai: "Khách đóng cửa",
          tra_hang_ma: "DNN0003", tra_hang_xong: false, kho_da_lap_phieu: true, kho_da_xuat: true, so_anh: 0,
        },
      }],
    });
    expect(screen.queryByRole("button", { name: "In phiếu giao" })).toBeNull();
  });
});

describe("Tóm tắt vòng đời · Nhập kho tính mọi sản phẩm, báo món thiếu nguồn", () => {
  // Giống DH002: 1 món có lệnh chưa nhận gì, 1 món giao từ tồn đủ hàng, 2 món không lệnh mà tồn 0.
  const td = {
    ...TD,
    cum: [
      cum({ khoa: "hop", dat: 20000, co_lenh: true, kho_da_nhan: 0, giao_duoc: 0, ton_that: 0 }),
      cum({ khoa: "menu", dat: 1500, co_lenh: false, kho_da_nhan: 0, ton_that: 1500, giao_duoc: 1500 }),
      cum({ khoa: "toroi", dat: 30000, co_lenh: false, kho_da_nhan: 0, ton_that: 0, giao_duoc: 0 }),
      cum({ khoa: "poster", dat: 500, co_lenh: false, kho_da_nhan: 0, ton_that: 0, giao_duoc: 0 }),
    ],
  };

  it("món lấy từ tồn đủ hàng được tính vào Nhập kho, món thiếu nguồn được liệt kê", () => {
    const t = tomTatTienDo(td);
    expect(t.soMonDuHang).toBe(1);
    expect(t.soMon).toBe(4);
    expect(t.khoPct).toBe(25);
    expect(t.khoXong).toBe(false);
    expect(t.thieuNguon.map((c) => c.khoa)).toEqual(["toroi", "poster"]);
  });

  it("món từ tồn đã giao một phần + đang giữ vẫn tính là đã có hàng", () => {
    const t = tomTatTienDo({
      ...TD,
      cum: [cum({ khoa: "menu", dat: 1500, co_lenh: false, da_giao: 500, dang_giu: 400, giao_duoc: 600 })],
    });
    expect(t.khoXong).toBe(true);
    expect(t.thieuNguon).toHaveLength(0);
  });
});

describe("Nhà gia công giao thẳng cho khách (gia công ngoài, không qua KCS/kho trên phần mềm)", () => {
  const xong = { id: 2, ma: "LSX26-0002", da_xuong_xuong: true, pct: 100, uoc_tinh: false, xong: true,
    buoc_hien_tai: null, du_kien_xong: null, trang_thai: null, canh_bao: [] };
  const gt = cum({ ten: "Hộp kem", dat: 5000, sx_pct: 100, sx_xong: true, lenh: [xong], kho_de_nghi: 0,
    kho_da_nhan: 0, cho_kho: 0, ton_that: 0, da_giao: 5000, giao_thang: 5000, con_phai_giao: 0, giao_duoc: 0 });

  it("phần giao thẳng tính là đã có hàng ⇒ Sản xuất xong, việc tiếp theo không còn chờ KCS gửi kho", () => {
    const t = tomTatTienDo({ ...TD, cum: [gt] });
    expect(t.khoXong).toBe(true);
    expect(t.giaoXong).toBe(true);
    const v = viecTiepTheo({
      trangThai: "ordered", canCoc: false, duCoc: true, thieuCoc: 0, chuyenSxLuc: "2026-10-05T06:54:32Z",
      gap: false, hanGiao: null, td: { ...TD, cum: [gt] }, hoaDon: "none",
    })!;
    expect(v.cau).toBe("Kế toán ghi hóa đơn");
  });

  it("bảng Sản xuất: đủ hàng nhờ giao thẳng, hàng về thẳng khách", () => {
    render(<BangSanXuatMon td={{ ...TD, cum: [{ ...gt, o: "du_hang", lenh_o: [{ ...LM, kieu: "tron_goi" }] }] }} />);
    expect(screen.getByText("Đủ hàng")).toBeTruthy();
    expect(screen.getByText("nhà gia công giao thẳng 5.000")).toBeTruthy();
    expect(screen.getByText("5.000 / 5.000 hộp")).toBeTruthy();
    expect(screen.getByText("Giao thẳng cho khách")).toBeTruthy();
    expect(screen.getByText("Gia công trọn gói")).toBeTruthy();
  });
});

const LM: LenhMon = {
  id: 5, ma: "LSX26-0005", o: "xuong", kieu: "xuong", buoc: "Bế", pct: 60, gia_cong: null,
};

const LENH = {
  id: 5, ma: "LSX26-0005", da_xuong_xuong: true, pct: 60, uoc_tinh: false, xong: false,
  buoc_hien_tai: "Bế", du_kien_xong: null, trang_thai: null, canh_bao: [],
};

describe("⭐ Món có lệnh mà đủ hàng nhờ TỒN CÓ SẴN của mã (DH002/DH003, 12/10/2026)", () => {
  // Lệnh của đơn chưa nhập kho gì, nhưng tồn của mã (hàng làm dư đơn trước) gánh đủ 1.000.
  const tuTon = cum({
    ten: "Sách A5", don_vi: "cuốn", dat: 1000, kho_de_nghi: 0, kho_da_nhan: 0, cho_kho: 0,
    giao_duoc: 1000, con_phai_giao: 1000, o: "du_hang", lenh: [LENH], lenh_o: [LM],
  });

  it("tab Sản xuất cùng luật với danh sách và tab Giao: đủ hàng, không còn 0/1.000", () => {
    const t = tomTatTienDo({ ...TD, cum: [tuTon] });
    expect(t.khoXong).toBe(true);
    expect(t.soMonDuHang).toBe(1);
  });

  it("việc tiếp theo là GIAO, không phải chờ KCS hay xưởng — lệnh vẫn chạy thì có thẻ nhắc", () => {
    const v = viecTiepTheo({
      trangThai: "ordered", canCoc: false, duCoc: true, thieuCoc: 0, chuyenSxLuc: "2026-10-05T06:54:32Z",
      gap: false, hanGiao: null, td: { ...TD, cum: [tuTon] }, hoaDon: "none",
    })!;
    expect(v.cau).toBe("Lập yêu cầu giao hàng");
    expect(v.the.map((x) => x.nhan)).toContain("LSX26-0005 vẫn chạy dù đã đủ hàng");
  });

  it("bảng Sản xuất nói rõ hàng đến từ tồn có sẵn, không ghi kho đã nhận đủ", () => {
    render(<BangSanXuatMon td={{ ...TD, cum: [tuTon] }} />);
    expect(screen.getByText("1.000 / 1.000 cuốn")).toBeTruthy();
    expect(screen.getByText("đủ từ tồn có sẵn")).toBeTruthy();
    expect(screen.queryByText("kho đã nhận đủ")).toBeNull();
  });
});

describe("Sản xuất từng mặt hàng: bảng trong ngăn đơn (07/10/2026)", () => {
  const ngoai: LenhMon = {
    ...LM, id: 8, ma: "LSX26-0008", o: "ngoai", kieu: "mot_phan", buoc: null, pct: null,
    gia_cong: { kieu: "mot_phan", nha_cung_cap_id: 3, nha_cung_cap_ten: "Cán màng Hưng Thịnh",
      ten_viec: "Cán màng", tu_luc: null, ve_xuong: true },
  };

  it("mỗi mặt hàng một hàng: lệnh, kiểu làm, đang ở, đã có hàng, hàng về; bấm hàng mở lệnh", async () => {
    const mo = vi.fn();
    render(<BangSanXuatMon onMoLenh={mo} td={{ ...TD, cum: [
      cum({ khoa: "a", ten: "Hộp thuốc", o: "xuong", lenh: [{ ...LENH, canh_bao: ["tre_han"] }], lenh_o: [LM] }),
      cum({ khoa: "b", ten: "Tờ HDSD", o: "ngoai", lenh_o: [ngoai], kho_da_nhan: 0, giao_duoc: 0 }),
      cum({ khoa: "c", ten: "Túi", o: "du_hang", co_lenh: false, kho_da_nhan: 0, ton_that: 100, giao_duoc: 100 }),
    ] }} />);
    expect(screen.getByText("Bế 60%")).toBeTruthy();
    expect(screen.getByText("trễ hạn công đoạn")).toBeTruthy();
    expect(screen.getByText("Trong xưởng")).toBeTruthy();
    expect(screen.getByText("40 / 100 hộp")).toBeTruthy();
    expect(screen.getByText("Cán màng Hưng Thịnh")).toBeTruthy();
    expect(screen.getByText("Gia công một phần")).toBeTruthy();
    expect(screen.getByText("Về xưởng làm tiếp")).toBeTruthy();
    expect(screen.getByText("Không có lệnh")).toBeTruthy();
    expect(screen.getAllByText("Lấy từ tồn kho")).toHaveLength(2);
    await userEvent.click(screen.getByText("Tờ HDSD"));
    expect(mo).toHaveBeenCalledWith(8);
    await userEvent.click(screen.getByRole("button", { name: /LSX26-0005/ }));
    expect(mo).toHaveBeenLastCalledWith(5);
  });
});

describe("Việc tiếp theo của đơn", () => {
  const goc = {
    trangThai: "ordered", canCoc: false, duCoc: true, thieuCoc: 0,
    chuyenSxLuc: "2026-10-05T06:54:32Z", gap: true, hanGiao: "2026-10-30",
    hoaDon: "none" as const, homNay: new Date(2026, 9, 5),
  };

  it("vừa chốt, chưa lệnh nào ⇒ chờ Kế hoạch, kèm giờ chuyển, đơn gấp, số ngày tới hạn", () => {
    const td = { ...TD, cum: [cum({ co_lenh: false, kho_de_nghi: 0, kho_da_nhan: 0, cho_kho: 0, ton_that: 0, giao_duoc: 0 })] };
    const v = viecTiepTheo({ ...goc, td })!;
    expect(v.cau).toBe("Chờ Kế hoạch lên lệnh sản xuất");
    expect(v.the.map((t) => t.nhan)).toEqual(["chuyển xuống 13:54 05/10", "đơn gấp", "còn 25 ngày tới hạn giao"]);
    expect(v.nut?.toi).toBe("ke-hoach-sx");
  });

  it("KCS đã gửi mà kho chưa nhận ⇒ việc của Kho, đứng trước lệnh đang chạy", () => {
    const td = { ...TD, cum: [cum({ ten: "Hộp kem", don_vi: "cái", lenh: [LENH] })] };
    expect(viecTiepTheo({ ...goc, td })!.cau).toBe("Kho chưa nhận 20 cái Hộp kem KCS đã gửi");
  });

  it("lệnh đang chạy, kho không vướng ⇒ nói lệnh và công đoạn đang làm", () => {
    const td = { ...TD, cum: [cum({ lenh: [LENH], cho_kho: 0 })] };
    expect(viecTiepTheo({ ...goc, td })!.cau).toBe("Xưởng đang chạy LSX26-0005, đang Bế");
  });

  it("chờ cọc ⇒ việc của kế toán, chưa nói tới sản xuất", () => {
    const v = viecTiepTheo({ ...goc, canCoc: true, duCoc: false, thieuCoc: 2000000, chuyenSxLuc: null, td: null })!;
    expect(v.cau).toBe("Chờ kế toán thu cọc, còn thiếu 2.000.000 đ");
    expect(v.nut?.toi).toBe("coc");
  });

  it("đơn hủy ⇒ không có việc tiếp theo", () => {
    expect(viecTiepTheo({ ...goc, trangThai: "cancelled", td: TD })).toBeNull();
  });
});

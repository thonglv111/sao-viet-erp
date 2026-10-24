// Bằng chứng THẬT cho phần HIỆN RA của danh mục gốc (Giấy · Vật tư khác · Đơn vị).
//
// Hai thứ dưới đây từng "làm xong" mà người dùng không thấy gì, nên phải khoá lại bằng render chứ
// không bằng niềm tin:
//   · cột ĐVT hiện MÃ (`kem`) thay vì TÊN ("bản kẽm") — mã thì không ai đoán ra;
//   · câu "1 thùng = 3 kg" dựng từ 3 ô đang gõ — `hint` vốn chỉ nhận chuỗi tĩnh nên câu này im.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CFG_CONG_DOAN, CFG_DON_VI, CFG_GIAY, CFG_MAY, CFG_THANH_PHAM, CFG_VAT_TU,
  REBUILD_CONFIGS,
} from "./rebuildCatalogConfigs";
import type { CatalogConfig, FieldDef } from "./RebuildCatalogPage";
import type { Row } from "../api/rebuildCatalog";
import type { ModuleCapability } from "../api/client";
import { PermissionsProvider, buildCapabilities } from "../auth/permissions";
import { DieuHuongDanhMuc } from "./danh-muc/dieuHuong";
import type { NavigateFn } from "../components/AppShell";

function cot(cfg: CatalogConfig, key: string) {
  const c = cfg.columns.find((x) => x.key === key);
  if (!c?.render) throw new Error(`không có cột "${key}" (hoặc cột không tự render)`);
  return c.render;
}

function truong(cfg: CatalogConfig, key: string): FieldDef {
  const f = cfg.fields.find((x) => x.key === key);
  if (!f) throw new Error(`không có field "${key}"`);
  return f;
}

/** Dòng bảng — chỉ cần 3 khoá bắt buộc của `Row`, phần còn lại tuỳ danh mục. */
const row = (extra: Record<string, unknown>): Row =>
  ({ id: 1, ma: "X", ten: "x", ...extra }) as Row;

describe("cột ĐVT của mặt hàng gốc", () => {
  it("hiện TÊN đơn vị chứ không hiện mã", () => {
    render(<>{cot(CFG_VAT_TU, "don_vi_gia")(row({ don_vi_gia: "kem", don_vi_ten: "bản kẽm" }))}</>);
    expect(screen.getByText("bản kẽm")).toBeInTheDocument();
    expect(screen.queryByText("kem")).not.toBeInTheDocument();
  });

  it("chưa có tên thì lùi về mã, không hiện trống", () => {
    render(<>{cot(CFG_GIAY, "don_vi_gia")(row({ don_vi_gia: "kg" }))}</>);
    expect(screen.getByText("kg")).toBeInTheDocument();
  });

  it("chưa chọn đơn vị thì NÓI RÕ, vì thiếu nó là kho không nhập được mặt hàng", () => {
    render(<>{cot(CFG_GIAY, "don_vi_gia")(row({ don_vi_gia: null }))}</>);
    expect(screen.getByText("Chưa chọn đơn vị")).toBeInTheDocument();
  });
});

describe("màn Đơn vị & quy đổi", () => {
  it("KHÔNG còn cột Lưu ý (`canh_bao`) — chủ gỡ 18/09/2026", () => {
    const keys = CFG_DON_VI.columns.map((c) => c.key);
    expect(keys).not.toContain("canh_bao");
    // "Đang dùng ở" (`mat_hang_dung`, server đếm) thêm 04/10/2026: sửa/xoá đơn vị là đụng các mặt hàng đó.
    expect(keys).toEqual(["quy_doi_text", "mat_hang_dung", "ghi_chu"]);
  });
});

describe("form Vật tư khác KHÔNG còn quy cách đóng gói", () => {
  it("bỏ hẳn hai ô — quy đổi chỉ khai ở danh mục Đơn vị & quy đổi, một nơi duy nhất", () => {
    const keys = CFG_VAT_TU.fields.map((f) => f.key);
    expect(keys).not.toContain("don_vi_dong_goi");
    expect(keys).not.toContain("he_so_dong_goi");
    expect(CFG_VAT_TU.columns.map((c) => c.key)).not.toContain("don_vi_dong_goi");
  });
});

describe("ô ĐVT lấy từ danh mục Đơn vị", () => {
  it("chọn từ /api/don-vi, lưu MÃ, và KHÔNG lọc ngừng-dùng ở query", () => {
    const f = truong(CFG_VAT_TU, "don_vi_gia");
    expect(f.type).toBe("ref-search-ma");     // lưu mã `kg`, không lưu id
    expect(f.refPrefix).toBe("/api/don-vi");  // nguồn duy nhất, không còn list cứng
    // Việc gạt đơn vị đã ngừng dùng là của `locConDung` trong CatalogDrawer, KHÔNG phải của
    // query: lọc từ server thì hàng cũ đang trỏ vào đơn vị vừa ngừng mở ra thấy ô TRỐNG,
    // bấm Lưu là xoá mất mã đang đúng.
    expect(f.refParams?.active).toBeUndefined();
  });

  it("giấy không có ô đơn vị nào — máy chủ tự điền kg + tờ (24/10/2026)", () => {
    const keys = CFG_GIAY.fields.map((x) => x.key);
    expect(keys).not.toContain("don_vi_gia");
    expect(keys).not.toContain("don_vi_them");
  });
});

describe("Khoán được hợp nhất vào Công đoạn", () => {
  it("gỡ màn độc lập và đặt tab Khoán giữa Thông tin với Vật tư", () => {
    expect(REBUILD_CONFIGS).not.toHaveProperty("cong-viec-khoan");
    expect(CFG_CONG_DOAN.tabsKhai?.map((t) => t.label)).toEqual(["Thông tin", "Khoán", "Vật tư"]);
    const f = truong(CFG_CONG_DOAN, "khoan");
    expect(f.type).toBe("khoan-cong-doan");
    expect(f.refPrefix).toBe("/api/don-vi");
  });

  it("gửi một aggregate Khoán và dùng null khi chưa cấu hình", () => {
    const rong = CFG_CONG_DOAN.transformSubmit?.({ khoan: {} }, {}, null);
    expect(rong?.khoan).toBeNull();
    const body = CFG_CONG_DOAN.transformSubmit?.({ khoan: {
      unit: "to", unit_price: 0, cong_thuc_khoan: "sl_ra",
      viec_phat_sinh: [{ ten: "Thay kẽm", don_gia: 100000, don_vi: "kem" }],
    } }, {}, null);
    expect(body?.khoan).toEqual({
      unit: "to", unit_price: 0, cong_thuc_khoan: "sl_ra",
      viec_phat_sinh: [{ ten: "Thay kẽm", don_gia: 100000, don_vi: "kem" }],
    });
  });
});

describe("ô Cách đo lượng ĐÃ GỠ khỏi Máy · Vật tư khác (06/09/2026)", () => {
  it("hai màn không còn ô `cong_thuc_luong`", () => {
    // Cách đo nay khai ở drawer Công đoạn: theo CẶP (công đoạn × máy) cho giờ chạy, theo dòng đầu
    // việc cho tiền công, theo dòng vật tư cho định mức. Giữ ô cũ song song là hai nguồn một câu.
    for (const cfg of [CFG_MAY, CFG_VAT_TU]) {
      expect(cfg.fields.some((f) => f.key === "cong_thuc_luong")).toBe(false);
    }
  });

  it("hết ô công thức thì bỏ luôn nhãn tab công thức", () => {
    // Nhãn của một tab không còn ô nào là nhãn chết — đọc code tưởng màn vẫn có chỗ khai.
    expect(CFG_MAY.nhanTabCongThuc).toBeUndefined();
    expect(CFG_VAT_TU.nhanTabCongThuc).toBeUndefined();
  });

  it("Giấy chỉ còn MỘT ô công thức — công thức giá (mg `0348` gỡ ô tính định mức)", () => {
    expect(truong(CFG_GIAY, "cong_thuc_gia").nhanTab).toBe("Công thức tính giá");
    expect(CFG_GIAY.fields.some((f) => f.key === "cong_thuc_luong")).toBe(false);
    expect(CFG_GIAY.fields.filter((f) => f.type === "formula")).toHaveLength(1);
  });

  it("Công đoạn: KHÔNG còn cặp ô sản lượng ra của bước NGOÀI dòng giấy", () => {
    // GỠ 18/09/2026 (mg `0324`): server thôi nhận/trả `cong_thuc_san_luong` + `don_vi_san_luong`
    // (cùng `he_so_ngoai_dong`) — số của bước ngoài dòng giấy nay khai tay ở drawer bước lệnh.
    const keys = CFG_CONG_DOAN.fields.map((f) => f.key);
    for (const k of ["cong_thuc_san_luong", "don_vi_san_luong", "he_so_ngoai_dong"]) {
      expect(keys).not.toContain(k);
    }
    // Ô giá vẫn tự khai `nhanTab` ⇒ tab công thức mang đúng tên, không rơi vào nhãn mặc định.
    expect(truong(CFG_CONG_DOAN, "cong_thuc_gia").nhanTab).toBe("Công thức tính giá");
    expect(CFG_CONG_DOAN.nhanTabCongThuc).toBeUndefined();
  });

  it("Công đoạn: ô Tổ phụ trách chọn NHIỀU tổ, gửi lên luôn là MẢNG", () => {
    // 18/09/2026 (mg `0312`): "Cán màng mờ" do tổ Cán lẫn tổ Thành phẩm làm. Bước lệnh chọn MỘT
    // trong số này; tổ đầu danh sách là tổ mặc định lúc lên lệnh (nhãn `nhanDau`).
    const keys = CFG_CONG_DOAN.fields.map((f) => f.key);
    expect(keys).not.toContain("department_id");
    const f = truong(CFG_CONG_DOAN, "department_ids");
    expect(f.type).toBe("to-multi");
    expect(f.refPrefix).toBe("/api/cong-doan/phong-ban");
    expect(f.nhanDau).toBe("mặc định");
    // Chưa chọn tổ nào phải gửi MẢNG RỖNG (= gỡ hết), không phải bỏ khoá — bỏ khoá thì backend
    // hiểu là "giữ nguyên" và tổ vừa gỡ ở drawer sống lại sau khi lưu.
    expect(CFG_CONG_DOAN.transformSubmit?.({ ma: "CD-0002" }, {}, null).department_ids).toEqual([]);
    expect(CFG_CONG_DOAN.transformSubmit?.({ department_ids: [3, 7] }, {}, null).department_ids)
      .toEqual([3, 7]);
  });

  it("Vật tư khác: có chip riêng + hai ô công thức, mỗi ô một tab", () => {
    // 01/10/2026 — mở lại hai ô công thức, kèm chip riêng của chính vật tư.
    const ct = CFG_VAT_TU.fields.filter((f) => f.type === "formula");
    expect(ct.map((f) => f.key)).toEqual(["cong_thuc_gia", "cong_thuc_dinh_muc"]);
    expect(ct.map((f) => f.nhanTab)).toEqual(["Công thức tính giá", "Công thức định mức"]);
    expect(ct.every((f) => f.chipsTu === "chips")).toBe(true);
    expect(CFG_VAT_TU.fields.some((f) => f.type === "vat-tu-chip" && f.key === "chips")).toBe(true);
    expect(CFG_VAT_TU.fields.some((f) => f.key === "cong_thuc_luong")).toBe(false);
  });

  it("Vật tư khác: ẩn Đơn giá (cả ô lẫn CỘT)", () => {
    // 09/09/2026 — giấu khỏi UI, KHÔNG gỡ cột DB/engine. Kiểm cả `columns`: lần trước ẩn
    // `cong_thuc_gia` chỉ nhớ `fields`, cột vẫn nằm lại trong bảng.
    expect(CFG_VAT_TU.fields.some((f) => f.key === "don_gia")).toBe(false);
    expect(CFG_VAT_TU.columns.some((c) => c.key === "don_gia")).toBe(false);
  });

  it("GIẤY giữ nguyên Đơn giá/kg — đừng gỡ theo Vật tư khác", () => {
    expect(CFG_GIAY.fields.some((f) => f.key === "don_gia")).toBe(true);
    expect(CFG_GIAY.columns.some((c) => c.key === "don_gia")).toBe(true);
  });

  it("GIẤY: bảng bỏ cột Cách tính tiền, thẻ vẫn khai được (05/10/2026)", () => {
    expect(CFG_GIAY.columns.some((c) => c.key === "cong_thuc_gia")).toBe(false);
    expect(CFG_GIAY.fields.some((f) => f.key === "cong_thuc_gia")).toBe(true);
  });

  it("Giấy thay thế ĐÃ GỠ (mg 0405, 13/10/2026) — cả Giấy lẫn Vật tư khác", () => {
    expect(CFG_GIAY.fields.some((f) => f.key === "thay_the_ids")).toBe(false);
    expect(CFG_VAT_TU.fields.some((f) => f.key === "thay_the_ids")).toBe(false);
  });
});

describe("Thành phẩm — hàng đặt riêng của MỘT khách (docs/prd-thanh-pham.md)", () => {
  it("bảng hiện ĐỦ thứ đang lưu: đơn + khách đặt lần đầu (chỉ đọc)", () => {
    // Chủ 17/09/2026: "hiển thị hơi thiếu thông tin so với những gì nó lưu, hiển thị hết đi".
    // Đây là VẾT NGUỒN GỐC máy ghi lúc chốt đơn — cột xem, không phải ô chọn chủ (xem test dưới).
    const keys = CFG_THANH_PHAM.columns.map((c) => c.key);
    expect(keys).toEqual(["don_vi_gia", "order_no", "customer_ten", "ghi_chu"]);
    // Lưới bề rộng px (08/10/2026): mọi cột khai `w` trừ cột CUỐI (Ghi chú ăn phần còn lại).
    const cot = CFG_THANH_PHAM.columns;
    expect(cot.slice(0, -1).every((c) => typeof c.w === "number" && c.w > 0)).toBe(true);
    expect(cot[cot.length - 1].w).toBeUndefined();
  });

  it("dòng KHAI TAY không có đơn thì ghi rõ, đừng để ô trống như chưa nạp", () => {
    const r = { id: 1, ma: "TP-1", ten: "x", order_id: null, order_no: null } as Row;
    expect(render(<>{cot(CFG_THANH_PHAM, "order_no")(r)}</>).container.textContent).toBe("Khai tay");
  });

  describe("⭐ bấm MÃ ĐƠN là mở luôn đơn (chủ 18/09/2026)", () => {
    const r = { id: 1, ma: "TP-1", ten: "x", order_id: 2, order_no: "DH002" } as Row;
    const docDon = { module_key: "don_hang_ban", scope: "all", can_read: true } as ModuleCapability;
    const ve = (nav: NavigateFn, caps: ModuleCapability[]) => render(
      <PermissionsProvider caps={buildCapabilities(caps)}>
        <DieuHuongDanhMuc.Provider value={nav}>{cot(CFG_THANH_PHAM, "order_no")(r)}</DieuHuongDanhMuc.Provider>
      </PermissionsProvider>,
    );

    it("bấm → sang Đơn hàng bán, mở đúng đơn theo id", async () => {
      const nav = vi.fn<NavigateFn>();
      ve(nav, [docDon]);
      await userEvent.click(screen.getByRole("button", { name: "DH002" }));
      expect(nav).toHaveBeenCalledWith("don-hang-ban", { openOrderId: 2 });
    });

    it("KHÔNG quyền đọc đơn ⇒ chữ thường, không bày link dẫn vào màn cấm", () => {
      ve(vi.fn(), []);
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.getByText("DH002")).toBeTruthy();
    });
  });

  it("⭐ KHÔNG có ô CHỌN Khách hàng", () => {
    // Đảo luật 21/08/2026: "khách hàng mình lưu làm gì, mình không dùng tới — thành phẩm này là
    // một cái tên hàng mới, nêu chưa khai để tái sử dụng, tránh phình lên".
    //
    // Trước đó ô này BẮT BUỘC vì `customer_id` là công tắc chia hai màn — để trống là dòng vừa
    // khai rơi sang màn Vật tư khác rồi mất tích. Công tắc nay là cột `la_thanh_pham` (mg 0228)
    // do repo tự đóng dấu, nên bỏ ô này an toàn.
    //
    // Test này ĐỎ ngay khi ai đó đưa lại khách thành một thứ SỬA ĐƯỢC. Hiện khách đặt lần đầu ở
    // cột/khối chỉ đọc (17/09/2026) thì được — đó là nguồn gốc, không phải chủ.
    expect(CFG_THANH_PHAM.fields.some((f) => f.key === "customer_id")).toBe(false);
  });

  it("KHÔNG cho xoá, KHÔNG cho khai tay", () => {
    // Xoá là làm mồ côi lô tồn (L7). Khai tay: 19/08/2026 từng nới, chủ 18/09/2026 "bỏ nút thêm
    // thành phẩm đi" — dòng chỉ do chốt đơn sinh. Máy chủ chặn song song (`_chan_tao_tay`).
    expect(CFG_THANH_PHAM.khongXoa).toBe(true);
    expect(CFG_THANH_PHAM.khongTaoTay).toBe(true);
  });

  it("KHÔNG bày ô Mã thành ô sửa", () => {
    // Mã đã nằm trong lô tồn và phiếu đã ghi sổ. Máy chủ gạt đi, nhưng lúc đó họ đã gõ xong rồi.
    expect(CFG_THANH_PHAM.fields.some((f) => f.key === "ma")).toBe(false);
  });

  it("ô quyền RIÊNG, không dùng chung với Vật tư khác", () => {
    expect(CFG_THANH_PHAM.moduleQuyen).toBe("dm_thanh_pham");
    expect(CFG_VAT_TU.moduleQuyen).toBe("dm_vat_tu");
  });
});

describe("Giấy — ô Công thức tính giá ĐIỀN SẴN khi thêm mới", () => {
  // Trước 11/09/2026 ô này để trống lúc tạo mới, và engine âm thầm chạy công thức dự phòng
  // (`thanh_phan_engine._tinh_thanh_phan`) — người khai không nhìn thấy thứ đang tính tiền giấy
  // của mình. Nay drawer điền sẵn ĐÚNG công thức dự phòng đó để họ thấy, sửa hoặc xoá.
  const CT_CAN = "dinh_luong * dai_nguyen * rong_nguyen * to_nguyen * don_gia_giay";
  const CT_TO = "don_gia_giay * to_nguyen";

  it("chưa chọn ĐVT, hoặc ĐVT bán theo CÂN ⇒ định lượng × khổ × số tờ × đơn giá", () => {
    const f = truong(CFG_GIAY, "cong_thuc_gia");
    // Ô ĐVT không có `default` ⇒ lúc mở drawer nó TRỐNG. Giấy ở đây bán theo cân (đơn giá danh
    // mục là đ/kg), nên trống thì đoán theo cân — chọn ĐVT xong vẫn đổi lại được.
    expect(f.macDinhTheo?.({})).toBe(CT_CAN);
    expect(f.macDinhTheo?.({ don_vi_gia: "kg" })).toBe(CT_CAN);
    expect(f.macDinhTheo?.({ don_vi_gia: "tan" })).toBe(CT_CAN);
  });

  it("ĐVT đếm theo TỜ (tờ · ram · cái) ⇒ chỉ đơn giá × số tờ", () => {
    // Cùng luật với engine: khai đ/tờ mà vẫn nhân định lượng × diện tích là tiền giấy lệch hàng
    // chục lần, không ai soi ra vì phiếu vẫn ra một con số trông hợp lý.
    const f = truong(CFG_GIAY, "cong_thuc_gia");
    expect(f.macDinhTheo?.({ don_vi_gia: "to" })).toBe(CT_TO);
    expect(f.macDinhTheo?.({ don_vi_gia: "ram" })).toBe(CT_TO);
    expect(f.macDinhTheo?.({ don_vi_gia: "cai" })).toBe(CT_TO);
  });
});

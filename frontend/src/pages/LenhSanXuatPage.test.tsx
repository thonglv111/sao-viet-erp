// Task 14 (deep link QR): `AppShell` đọc hash `#lsx=&pv=` (xem `appShellDeepLink.test.ts`) rồi bơm
// xuống đây qua hai prop `openHoSoId`/`openHoSoPv`. Bài canh này chốt khúc CUỐI của dây chuyền —
// prop tới tay component thì đúng lệnh phải tự mở, KỂ CẢ khi lệnh đó không nằm trong trang bảng
// đang tải (người quét QR ở xưởng không quan tâm trang mấy, tab nào). Khúc đầu dây chuyền (hash
// sống sót qua đăng nhập) nằm ở `LoginPage.test.tsx`; khúc phân tích hash nằm ở
// `appShellDeepLink.test.ts`. Ngăn lệnh mới (`LenhSxNgan`, 12/10/2026) nạp `GET /{id}/ngan`.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { LenhSxListOut, LenhSxNganOut, LuaChonLoc } from "../api/client";
import { AuthContext, type AuthState } from "../auth/AuthContext";
import { PermissionsProvider, buildCapabilities } from "../auth/permissions";
import type { ModuleCapability } from "../api/client";
import { LenhSanXuatPage } from "./LenhSanXuatPage";

const AUTH: AuthState = {
  status: "authenticated", user: null, token: "t",
  login: async () => {}, logout: async () => {},
  updateUser: () => {}, notice: null, setNotice: () => {},
};

const DON_VI = [{ ma: "cai", ten: "cái" }];

/** Nguồn ô Khách / Đơn của thanh lọc (06/10/2026 — thay `/bo-loc`). */
const KHACH_LOC: LuaChonLoc[] = [{ id: 9, ten: "Công ty Sao", so: 1 }];
const DON_LOC: LuaChonLoc[] = [{ id: 3, ten: "DH-0003", so: 1 }];

/** Bảng phía sau chỉ có lệnh #5 — KHÔNG có lệnh #77. Cố tình: hồ sơ mở qua deep link phải tự đứng
 *  được mà không cần bảng biết gì về nó, đúng thứ ghi chú `LenhSanXuatPage.tsx` nói ("hồ sơ vẽ ĐÈ
 *  lên bảng chứ không thay màn"). */
const LIST: LenhSxListOut = {
  items: [{
    id: 5, ma: "LSX26-0005", ten: "Lệnh khác", so_luong_dat: 10, don_vi_tinh: "cái",
    khach_hang: "Công ty Sao", order_id: 3, order_no: "DH-0003",
    han_hoan_thanh_sx: "2026-10-20", is_rush: true,
    khau: "sau_sx", khau_chi_tiet: "cho_nhap_kho", da_dong: true,
    han_giao_khach: "2026-10-25", tron_goi: false, nha_gia_cong: null,
    chang: [
      { ten: "In", nhom: null, trang_thai: "xong", hien_tai: false },
      { ten: "Cán màng", nhom: null, trang_thai: "chay", hien_tai: true, ngoai: true },
    ],
  }],
  total: 1, page: 1, page_size: 25,
  dem_theo_tab: { tat_ca: 1, dang_sx: 0, sau_sx: 1, da_giao: 0 },
};

/** Ngăn TỐI GIẢN — đủ mọi trường bắt buộc của `LenhSxNganOut`; bài chủ yếu soi ĐÚNG LỆNH nào mở. */
const HOSO_77: LenhSxNganOut = {
  thong_tin: {
    id: 77, ma: "LSX26-0077", ten: "Lệnh quét QR", loai: null,
    order_id: null, order_no: null, order_line_id: null,
    khach_hang: null, khach_hang_id: null, sale: null,
    so_luong_dat: 100, don_vi_tinh: "cái", is_rush: false,
    han_hoan_thanh_sx: null, han_giao_khach: null,
    ban_giao_at: null, ghi_chu: null, tao_luc: null, da_dong: false, nhom_ten: null,
  },
  tien_do: {
    phan_tram: 0, uoc_tinh: false, gio_may: 0,
    du_kien_xong: null, trang_thai: "dang_sx", canh_bao: [],
    buoc_hien_tai: null, buoc_hien_tai_cong_viec_id: null, nhom_cong_doan: null,
    may: null, nguoi: [], da_giao: 0, khau: "dang_sx", khau_chi_tiet: null, vat_tu_chu: null,
  },
  thong_so: {
    giay_ten: null, dinh_luong: null,
    kho_nguyen_dai: null, kho_nguyen_rong: null, kho_in_dai: null, kho_in_rong: null,
    dai_thanh_pham: null, rong_thanh_pham: null, quy_cach_in: null,
    so_mau_a: null, so_mau_b: null, muc_a: [], muc_b: [],
    so_trang: null, trang_moi_tay: null, so_kem: null, so_manh_xa: null,
    ghi_chu_ky_thuat: null,
    so_con: 0, so_to_ke_hoach: 0, so_to_nguyen: 0, don_vi_tinh: null,
  },
  routing: { nodes: [], canh: [] },
  kcs: { tong_nhan: 0, tong_dat: 0, tong_khong_dat: 0, ty_le_dat: null, batch: [] },
  kho: { so_lenh_trong_nhom: 0, yeu_cau: [] },
  phien_ban: 3,
  tron_goi: null,
  kcs_cuoi: { so_lan: 0, nhan: 0, dat: 0, khong_dat: 0 },
  su_co: [],
  timeline: [],
  quy_cach: null,
  dai_duoi: null,
};

/** Hồ sơ của LỆNH KHÁC (#5 — chính là dòng có sẵn trong `LIST`), dùng để (a) sửa vòng 1 P4: chứng
 *  minh stub trả ĐÚNG hồ sơ theo id được hỏi chứ không phải luôn `HOSO_77`; (b) sửa vòng 1 P5: là
 *  đích của lượt "mở tay" sau khi đã mở một hồ sơ khác qua QR — `phien_ban: 5` CỐ Ý lớn hơn mọi
 *  `pv` dùng trong file này (1/3), để nếu `moHoSoTay` có bug quên xoá `pv` cũ thì điều kiện băng
 *  cảnh báo (`pv < phien_ban`) vẫn đúng và băng LẠI HIỆN — bài test bắt được đúng ca đó. */
const HOSO_5: LenhSxNganOut = {
  ...HOSO_77,
  thong_tin: { ...HOSO_77.thong_tin, id: 5, ma: "LSX26-0005", ten: "Lệnh khác" },
  phien_ban: 5,
};

const HOSO_BY_ID: Record<number, LenhSxNganOut> = { 77: HOSO_77, 5: HOSO_5 };

/** Fetch giả PHÂN BIỆT ĐƯỜNG DẪN — hai nguồn `LenhSanXuatPage` gọi lúc mount (danh sách, bộ lọc
 *  khách) cộng nguồn `LenhSxHoSoView` gọi khi hồ sơ mở (hồ sơ một lệnh, danh mục đơn vị). Thứ tự
 *  kiểm PHẢI cụ thể trước chung: `/bo-loc` đứng trước lượt kiểm số ở cuối đường dẫn, nếu không nó
 *  rơi nhầm vào nhánh danh sách trần. Trả về mảng URL đã gọi để bài canh tham số gửi đi.
 *
 *  Sửa vòng 1 (P4): nhánh hồ sơ TRƯỚC ĐÂY trả `HOSO_77` bất kể id hỏi là gì — bài test dựa vào stub
 *  đó không canh được việc `LenhSanXuatPage` có truyền ĐÚNG id đã yêu cầu hay không (một bug hardcode
 *  fetch nhầm id vẫn nhận lại `HOSO_77` như thường, bài vẫn xanh). Nay tra theo `HOSO_BY_ID`; id lạ
 *  ⇒ trả 404 thật (không phải "trả bừa `HOSO_77`") để một bug id-sai lộ ra thành lỗi tải hồ sơ, có
 *  thể quan sát được thay vì im lặng trùng khớp. */
/** `list` đổi được để bài canh dải chặng dựng một bảng khác mà không phải chép lại cả stub. */
function stubApi(list: LenhSxListOut = LIST): string[] {
  const goi: string[] = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    goi.push(url);
    let data: unknown;
    let status = 200;
    const mHoSo = /\/api\/lenh-san-xuat\/(\d+)\/ngan$/.exec(url);
    if (url.includes("/api/don-vi")) data = { items: DON_VI };
    else if (url.includes("/api/lenh-san-xuat/khach-loc")) data = KHACH_LOC;
    else if (url.includes("/api/lenh-san-xuat/don-loc")) data = DON_LOC;
    else if (mHoSo) {
      const id = Number(mHoSo[1]);
      const hs = HOSO_BY_ID[id];
      if (hs) data = hs;
      else {
        status = 404;
        data = { detail: `không có lệnh id=${id} trong stub` };
      }
    } else if (url.includes("/api/lenh-san-xuat")) data = list;
    else data = {};
    return Promise.resolve({
      ok: status < 400, status, headers: new Headers({ "content-type": "application/json" }),
      json: async () => data, text: async () => JSON.stringify(data),
    } as Response);
  }));
  return goi;
}

const CAPS = buildCapabilities([
  {
    module_key: "giao_hang", scope: "all",
    can_read: true, can_create: true, can_update: true,
  } as ModuleCapability,
]);

/** Cây UI dùng CHUNG cho lượt `render` đầu và mọi lượt `rerender` sau (sửa vòng 2, mục A) — tách
 *  riêng để bài canh "quét lại cùng lệnh" đổi được `openHoSoSeq` mà không phải chép lại hai lớp
 *  Provider bao quanh. */
function uiLenhSanXuat(
  openHoSoId?: number | null,
  openHoSoPv?: number | null,
  openHoSoSeq?: number | null,
) {
  return (
    <AuthContext.Provider value={AUTH}>
      <PermissionsProvider caps={CAPS}>
        <LenhSanXuatPage
          openHoSoId={openHoSoId}
          openHoSoPv={openHoSoPv}
          openHoSoSeq={openHoSoSeq}
        />
      </PermissionsProvider>
    </AuthContext.Provider>
  );
}

function ve(openHoSoId?: number | null, openHoSoPv?: number | null, openHoSoSeq?: number | null) {
  return render(uiLenhSanXuat(openHoSoId, openHoSoPv, openHoSoSeq));
}

// KHÔNG `vi.unstubAllGlobals()` ở đây (khác `LenhSxHoSoView.test.tsx`): `setup.ts` stub
// `ResizeObserver` MỘT LẦN cho cả file — màn này (khác `LenhSxHoSoView`) có dùng nó để đo tràn
// ngang của bảng, unstub sạch giữa hai bài là xoá luôn cái đó và bài sau ăn `ReferenceError`. Mỗi
// bài tự gọi `stubApi()` để có `fetch` MỚI, nên không cần dọn gì thêm giữa các bài.
describe("LenhSanXuatPage · deep link QR mở đúng hồ sơ (Task 14)", () => {
  it("⭐ có openHoSoId ⇒ hồ sơ lệnh #77 tự mở, dù bảng phía sau chỉ tải lệnh #5", async () => {
    stubApi();
    ve(77, 3);

    // Bảng vẫn tải bình thường ở phía sau — hồ sơ chỉ VẼ ĐÈ lên nó (docstring `LenhSanXuatPage`).
    await screen.findByText("LSX26-0005");
    // Và đúng lệnh #77 được yêu cầu, không phải lệnh nào khác — hồ sơ tự bật không cần bấm dòng.
    await screen.findByText("LSX26-0077");
  });

  it("⭐ không truyền openHoSoId ⇒ không lệnh nào tự mở (hành vi mặc định không đổi)", async () => {
    stubApi();
    ve();

    await screen.findByText("LSX26-0005");
    expect(screen.queryByText("LSX26-0077")).not.toBeInTheDocument();
  });
});

// Sửa vòng 1, P5: chưa có bài nào canh đường `pv` BÊN TRONG `LenhSanXuatPage` (khác
// `LenhSxHoSoView.test.tsx` — chỗ đó canh NỘI DUNG băng khi `pv` đã tới tay component, còn đây
// canh việc `LenhSanXuatPage` có TỰ TRUYỀN đúng `pv` xuống hay không, và có XOÁ nó đi lúc mở tay
// hay không). Hai bài dưới đúng kịch bản điều phối viên chốt.
describe("LenhSanXuatPage · đường `pv` (Task 14, sửa vòng 1 P5)", () => {
  it("⭐ openHoSoPv nhỏ hơn phien_ban của hồ sơ #77 ⇒ băng cảnh báo hiện", async () => {
    stubApi();
    ve(77, 1); // HOSO_77.phien_ban = 3 ⇒ 1 < 3.

    await screen.findByRole("heading", { name: "LSX26-0077" });
    expect(
      screen.getByText("Phiếu giấy v1, lệnh hiện tại đã là v3"),
    ).toBeInTheDocument();
  });

  it("⭐ đóng hồ sơ QR rồi mở tay lệnh #5 ⇒ KHÔNG còn băng (mở tay không có tờ giấy nào để so)", async () => {
    stubApi();
    ve(77, 1);

    await screen.findByRole("heading", { name: "LSX26-0077" });
    expect(screen.getByText(/Phiếu giấy v1/)).toBeInTheDocument();

    // Đóng hồ sơ QR — nút DUY NHẤT rõ vai "đóng" của màn (xem LenhSxHoSoView.tsx).
    await userEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(screen.queryByRole("heading", { name: "LSX26-0077" })).not.toBeInTheDocument();

    // Mở tay lệnh #5 bằng cách bấm dòng trong bảng — không qua QR nên không có `pv`.
    await userEvent.click(screen.getByText("LSX26-0005"));
    await screen.findByRole("heading", { name: "LSX26-0005" });

    // `HOSO_5.phien_ban = 5` CỐ Ý > mọi `pv` dùng trong bài này — nếu còn sót `pv=1` từ lượt QR
    // trước, điều kiện băng (`pv < phien_ban`) vẫn đúng và băng lại hiện lên nhầm lệnh.
    expect(screen.queryByText(/^Phiếu giấy v/)).not.toBeInTheDocument();
  });

  // Bài trên đi qua NÚT ĐÓNG trước khi mở tay — đúng đường một người dùng chuột đi thật. Nhưng
  // `dongHoSo` (nút đóng) VÀ `moHoSoTay` (mở tay) MỖI HÀM đều tự xoá `pv` của mình (xem
  // LenhSanXuatPage.tsx dòng ~176-193): đục MỘT TRONG HAI dòng đó thôi thì bài trên vẫn xanh vì
  // hàm còn lại đỡ thay — không chứng minh riêng lẻ được dòng nào. `LenhSxHoSoView.tsx:352-356` tự
  // ghi nhận một đường tắt CÓ THẬT không qua nút đóng: `lsxId` đổi trong lúc lớp phủ vẫn mounted
  // (Shift+Tab lọt xuống dòng bị che rồi bấm Enter). Bài dưới đi đúng đường đó — mở tay lệnh #5
  // trong khi hồ sơ #77 (mang `pv=1`) CHƯA đóng — để cô lập ĐÚNG MỘT dòng: `setHoSoPv(null)` bên
  // trong `moHoSoTay`.
  // Đường thật của kịch bản này (mở tay lệnh khác trong khi hồ sơ #77 còn che màn) KHÔNG PHẢI chuột:
  // lớp phủ hồ sơ vẽ ĐÈ, chặn hit-test chuột lên dòng bảng phía sau trong trình duyệt thật — jsdom
  // không hit-test nên chuột "click qua" được, còn đời thật thì không. Đường thật là BÀN PHÍM:
  // Shift+Tab từ nút Đóng lọt xuống dòng bị che (`tr.lds-dong`, tabIndex=0) rồi Enter.
  // Bài này đi đúng đường đó: lấy tiêu điểm vào dòng rồi bấm Enter. Sau đó đóng hồ sơ và canh
  // `dongHoSo` trả tiêu điểm về đúng dòng vừa mở (`tr[data-lsx]`), đặt trong `requestAnimationFrame`.
  //
  // Đường này sống được là NHỜ lớp phủ hồ sơ chưa trap tiêu điểm / chưa `inert` nền phía sau (soi
  // ở rà lại vòng 1, N29 — điều phối viên đã park, KHÔNG sửa trong Task 14 vì nó đụng mọi ngăn kéo
  // trong hệ chứ không riêng gì deep link). Nếu sau này khiếm khuyết a11y đó được vá (ngăn kéo trap
  // tiêu điểm / nền `inert`), đường bàn phím này không còn tới được dòng bị che nữa —
  // `setHoSoPv(null)` trong `moHoSoTay` khi đó thành thuần phòng thủ (không còn đường thật nào gọi
  // tới nó qua ngả này) và BÀI NÀY HẾT Ý NGHĨA. Lúc đó XOÁ bài, đừng vá lại cho nó xanh.
  it("⭐ mở tay lệnh #5 trong khi hồ sơ QR khác CHƯA đóng ⇒ `moHoSoTay` tự xoá pv cũ, không băng; đóng thì tiêu điểm về dòng", async () => {
    stubApi();
    ve(77, 1);

    await screen.findByRole("heading", { name: "LSX26-0077" });
    expect(screen.getByText(/Phiếu giấy v1/)).toBeInTheDocument();

    // KHÔNG bấm nút đóng — mở thẳng lệnh #5 trong khi hồ sơ #77 còn đang mở: tiêu điểm vào dòng
    // (như Shift+Tab lọt xuống) rồi Enter.
    const dong = (await screen.findByText("LSX26-0005")).closest("tr") as HTMLElement;
    dong.focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("heading", { name: "LSX26-0005" });

    expect(screen.queryByText(/^Phiếu giấy v/)).not.toBeInTheDocument();

    // Đóng hồ sơ: tiêu điểm phải về đúng dòng vừa mở (trả trong requestAnimationFrame).
    await userEvent.click(screen.getByRole("button", { name: "Đóng" }));
    await waitFor(() => expect(document.activeElement).toBe(dong));
  });
});

// Sửa vòng 2 (mục A, lỗi MỚI mức Quan trọng ở lượt rà lại): quét LẠI ĐÚNG lệnh vừa đóng ngăn kéo
// thì trước vòng sửa này KHÔNG mở lại gì. `openHoSoId`/`openHoSoPv` ra CÙNG cặp giá trị như lần
// trước ⇒ hai giá trị nguyên thuỷ đó "không đổi" dưới mắt effect khai deps `[openHoSoId,
// openHoSoPv]` — dù `AppShell` có tạo object `navParams` MỚI mỗi lượt `navigate`, hiệu đó vô nghĩa
// vì `LenhSanXuatPage` chỉ đọc giá trị nguyên thuỷ bóc ra, không đọc chính object. Gốc rễ và cách
// sửa: xem chú thích `navigate` + `navSeq` trong `AppShell.tsx`, và effect deep link trong
// `LenhSanXuatPage.tsx` (nay có thêm `openHoSoSeq` trong deps).
describe("LenhSanXuatPage · quét LẠI đúng lệnh vừa đóng vẫn phải mở lại (Task 14, sửa vòng 2 mục A)", () => {
  it("⭐ quét lại #lsx=77&pv=1 (cùng id/pv, chỉ openHoSoSeq tăng) sau khi đã đóng ⇒ hồ sơ 77 mở lại", async () => {
    stubApi();
    const { rerender } = ve(77, 1, 1);

    await screen.findByRole("heading", { name: "LSX26-0077" });

    // Lỡ tay đóng ngăn kéo — như tổ trưởng thật sự làm giữa hai lượt quét.
    await userEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(screen.queryByRole("heading", { name: "LSX26-0077" })).not.toBeInTheDocument();

    // Quét LẠI CHÍNH mã đó: `openHoSoId`/`openHoSoPv` giống hệt lượt trước (`77`, `1`) — đúng cặp
    // giá trị nguyên thuỷ `AppShell` thật sự truyền khi tổ trưởng quét lại cùng một tờ giấy. Chỉ
    // `openHoSoSeq` tăng (2), đúng như `navigate()` thật của `AppShell` tự làm ở MỌI lượt gọi.
    rerender(uiLenhSanXuat(77, 1, 2));

    // Trước vòng sửa 2: effect không chạy lại (deps không đổi) ⇒ dòng dưới đây timeout, bài đỏ.
    await screen.findByRole("heading", { name: "LSX26-0077" });
  });
});

// 4 tab theo khâu; phương án A 12/10/2026: tám cột, có tuyến bước ngang và hạn giao khách.
describe("LenhSanXuatPage · danh sách tra cứu", () => {
  it("⭐ bốn tab lấy số nguyên từ `dem_theo_tab`; dòng có pill khâu, thẻ Đã đóng lệnh, GẤP", async () => {
    stubApi();
    ve();

    await screen.findByText("LSX26-0005");
    // Hàng lọc nhanh khâu (nút bật, khuôn lưới chung) — số lấy nguyên từ `dem_theo_tab`.
    const tabs = within(screen.getByRole("group", { name: "Lọc lệnh theo khâu" })).getAllByRole("button");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Tất cả1", "Đang sản xuất0", "Sau sản xuất1", "Đã giao đủ0",
    ]);
    expect(screen.getByText("Chờ nhập kho")).toBeInTheDocument();
    expect(screen.getByText("Đã đóng lệnh")).toBeInTheDocument();
    expect(screen.getByText("GẤP")).toBeInTheDocument();
    expect(screen.getByText("DH-0003")).toBeInTheDocument();
    // Tám cột theo phương án A.
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "Lệnh", "Đơn", "Khách hàng", "Mặt hàng", "Số lượng", "Các bước", "Trạng thái", "Hạn giao",
    ]);
    // Tuyến bước ngang trong dòng: tên bước dưới chấm, bước đang chạy có vòng.
    expect(screen.getByRole("img", { name: "In xong; Cán màng đang chạy" })).toBeInTheDocument();
    expect(screen.getByText("25/10/2026")).toBeInTheDocument();
  });

  it("⭐ đổi tab gửi `tab=`; thanh lọc chọn khách gửi `khach_hang_id=`; kỳ gửi `tu_ngay=` + `moc=`", async () => {
    const goi = stubApi();
    ve();
    await screen.findByText("LSX26-0005");

    await userEvent.click(within(screen.getByRole("group", { name: "Lọc lệnh theo khâu" })).getByRole("button", { name: /Sau sản xuất/ }));
    await waitFor(() => expect(goi.some((u) => u.includes("tab=sau_sx"))).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Lọc" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Khách hàng/ }));
    await userEvent.click(await screen.findByRole("radio", { name: /Công ty Sao/ }));
    await waitFor(() => expect(goi.some((u) => u.includes("khach_hang_id=9"))).toBe(true));

    // Kỳ theo Hạn sản xuất (thay hai ô ngày rời cũ).
    await userEvent.click(screen.getByRole("button", { name: /Mọi thời gian/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Hạn sản xuất" }));
    await userEvent.click(screen.getByRole("radio", { name: /Năm nay/ }));
    await waitFor(() =>
      expect(goi.some((u) => u.includes("moc=han_sx") && /tu_ngay=\d{4}-01-01/.test(u))).toBe(true));

    // Không còn gọi hai đường đã bỏ.
    expect(goi.some((u) => u.includes("/summary"))).toBe(false);
  });

  it("⭐ tab rỗng mà bộ lọc vẫn có lệnh ⇒ mời về tab Tất cả", async () => {
    stubApi({ ...LIST, items: [], total: 0 });
    ve();
    const loc = await screen.findByRole("group", { name: "Lọc lệnh theo khâu" });
    await userEvent.click(within(loc).getByRole("button", { name: /Đã giao đủ/ }));
    expect(await screen.findByText("Tab «Đã giao đủ» hiện không có lệnh nào.")).toBeInTheDocument();
  });
});

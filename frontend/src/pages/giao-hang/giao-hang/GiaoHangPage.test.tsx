// Màn Giao hàng — khoá hai thứ mà `tsc` và `vite build` KHÔNG bắt được:
//
//   1. "MỘT Ô = MỘT TAB" có thật ở giao diện chưa. Đây là luật chốt 15/08/2026 và đã cắn một lần
//      rồi: cấp ô rồi mà tab không hiện, hoặc tệ hơn — tab hiện cho người không có ô. Cả hai
//      chiều đều phải test, vì `can()` trả `false` mặc định nên chiều "thiếu ô ⇒ ẩn" luôn xanh
//      kể cả khi dây bị đứt hoàn toàn.
//   2. Khoảng trống nói được BƯỚC TIẾP THEO. Bảng rỗng chỉ nói "hết chuyện"; người mở màn lần đầu
//      không biết yêu cầu giao đẻ ra từ đâu.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import GiaoHangPage from "./GiaoHangPage";
import { boNguonLenDon } from "./shared/nguonLenDon";
import { AuthContext, type AuthState } from "../../../auth/AuthContext";
import { PermissionsProvider, buildCapabilities } from "../../../auth/permissions";
import type { ModuleCapability } from "../../../api/client";

const AUTH: AuthState = {
  status: "authenticated", user: null, token: "t",
  login: async () => {}, logout: async () => {},
  updateUser: () => {}, notice: null, setNotice: () => {},
};

/** Ô quyền của màn Giao hàng — chỉ bật đúng những cờ truyền vào. */
function caps(o: Partial<ModuleCapability>) {
  return buildCapabilities([
    { module_key: "giao_hang", scope: "all", can_read: true, ...o } as ModuleCapability,
  ]);
}

const CHUYEN = {
  id: 1, request_id: 7, request_code: "YCGH-260819-A1B2", order_id: 3, order_code: "DH-GH-01",
  customer_name: "Công ty Bánh kẹo Minh Long", lan_thu: 1, employee_id: 5,
  employee_name: "Trần Văn Hùng",
  ghi_chu_phan_cong: null, trang_thai: "dang_giao", km: null, thoi_gian_ket_thuc: null,
  nguoi_nhan_thuc_te: null, ly_do_that_bai: null, huong_xu_ly: null, ngay_hen_lai: null,
  ghi_chu_ket_qua: null, lines: [], yeu_cau_kho_ma: "DNX0007",
  yeu_cau_kho_trang_thai: "approved",
};

const YEU_CAU = {
  id: 7, code: "YCGH-260819-A1B2", order_id: 3, order_code: "DH-GH-03", customer_id: 1,
  customer_name: "Dược phẩm Sao Mai", department_id: 1, ngay_can_giao: "2026-08-26",
  dia_chi: "Lô C3", nguoi_nhan: "Chị Hạnh", sdt_nguoi_nhan: "0938765432", ghi_chu: null,
  trang_thai: "dang_thuc_hien", ly_do_huy: null, created_by: 1, created_by_name: "Admin",
  created_at: "2026-08-19T10:00:00Z", lines: [], so_lan_giao: 1, trang_thai_lsx: [],
};

function stubApi({ trips = [], khoi = [], requests = [], drivers = [], taiXe, xe = [], luotMo = [],
                   deNghi = [], rieng }: {
  /** Chuyến LẺ (ngoài lượt) và khối LƯỢT XE — hai loại khối của `/bang-giao`. */
  trips?: unknown[]; khoi?: { diem: unknown[] }[];
  requests?: unknown[]; drivers?: unknown[]; taiXe?: unknown[];
  /** Danh mục Xe giao hàng (`/api/xe`) và lượt đang mở của xe (`/luot-xe`) — lượt xe 18/09/2026. */
  xe?: unknown[]; luotMo?: unknown[];
  /** Đề nghị xuất kho của các chuyến — bước hẹn kho sau Lên đơn (mg 0400). */
  deNghi?: unknown[];
  /** Trả lời RIÊNG cho một URL (vd POST bat-dau-giao kèm cảnh báo). `undefined` = đi nhánh chung. */
  rieng?: (url: string) => unknown;
}) {
  const goi: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const p = String(url);
    goi.push({ url: p, body: init?.body ? JSON.parse(String(init.body)) : null });
    const traRieng = rieng?.(p);
    // Chi tiết MỘT yêu cầu — `/requests/7`, phải bắt TRƯỚC `/requests` chung, và phải đúng
    // hình dạng `{request, trips, lich_su}`. Bản đầu trả `{items: []}` nên dialog `.catch` nuốt
    // mất, test xanh mà không chứng minh gì.
    const body = traRieng !== undefined ? traRieng
      : /\/requests\/\d+/.test(p)
      ? {
          request: {
            ...YEU_CAU,
            lines: [
              { id: 1, order_line_id: 11, qty: 119, mo_ta: "Hộp thuốc 10 vỉ",
                don_vi_tinh: "hộp", da_giao: 0 },
              { id: 2, order_line_id: 12, qty: 119, mo_ta: "Tờ hướng dẫn",
                don_vi_tinh: "tờ", da_giao: 0 },
            ],
          },
          trips: [],
          lich_su: [],
        }
      // Danh mục Xe (12/09/2026): hai hộp Lên đơn / Ghi kết quả nạp ô Xe từ `/api/xe`. Thiếu
      // nhánh này thì stub trả `{}` ⇒ `items` undefined ⇒ hộp thoại vỡ ngay lúc vẽ.
      : p.includes("/api/xe") ? { items: xe, total: xe.length }
      : p.includes("/luot-xe?") ? { items: luotMo }
      : p.includes("/de-nghi-kho") ? deNghi
      : p.includes("/con-phai-giao")
      ? { order_id: 3, da_giao_du: false,
          lines: [{ order_line_id: 11, mo_ta: "Hộp giấy", don_vi_tinh: "hộp",
                    qty_dat: 100, da_giao: 0, con_phai_giao: 40 }] }
      : p.includes("/tai-xe-chon")
        ? { items: taiXe ?? [{ id: 5, code: "NVGH01", full_name: "Trần Văn Hùng",
                               department: "Kho", co_tai_khoan: true, co_thao_tac: true }] }
        : p.includes("/bang-giao")
          ? { items: [...khoi.map((l) => ({ luot: l, trip: null })),
                      ...trips.map((t) => ({ luot: null, trip: t }))],
              total: khoi.length + trips.length,
              so_don: khoi.reduce((n, l) => n + l.diem.length, 0) + trips.length }
        : p.includes("/trips") ? { items: trips, total: trips.length }
          : p.includes("/requests") ? { items: requests, total: requests.length }
            : p.includes("/nhan-vien") ? { items: drivers }
              : {};
    return Promise.resolve({
      ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
      json: async () => body, text: async () => JSON.stringify(body),
    } as Response);
  }));
  return goi;
}

function ve(o: Partial<ModuleCapability>) {
  return render(
    <AuthContext.Provider value={AUTH}>
      <PermissionsProvider caps={caps(o)}>
        <GiaoHangPage />
      </PermissionsProvider>
    </AuthContext.Provider>,
  );
}

/** Có ô Lên kế hoạch thì màn mở ở tab Yêu cầu giao — test bảng Đơn giao hàng phải bấm sang. */
function veDon(o: Partial<ModuleCapability>) {
  const r = ve(o);
  fireEvent.click(screen.getByRole("tab", { name: /Đơn giao hàng/ }));
  return r;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  boNguonLenDon();
  window.localStorage.clear();
});

describe("Giao hàng · một ô = một tab", () => {
  it("chỉ có ô Xem ⇒ đúng MỘT tab", async () => {
    stubApi({});
    ve({});
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    expect(screen.getByRole("tab", { name: /Đơn giao hàng/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Yêu cầu giao/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Nhân viên giao hàng/ })).not.toBeInTheDocument();
  });

  it("tên tab đúng như đã chốt: Yêu cầu giao · Đơn giao hàng · Nhân viên giao hàng", async () => {
    stubApi({});
    ve({ can_plan: true, can_view_drivers: true });
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
    const ten = screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\d+$/, "").trim());
    expect(ten).toEqual(["Yêu cầu giao", "Đơn giao hàng", "Nhân viên giao hàng"]);
    // Tab đầu cũng là tab mở sẵn.
    expect(screen.getByRole("tab", { name: /Yêu cầu giao/ })).toHaveAttribute("aria-selected", "true");
  });

  it("⭐ bật ô Lên kế hoạch ⇒ tab đó HIỆN RA", async () => {
    // Chiều khẳng định mới bắt được dây đứt: `can()` mặc định false nên chiều phủ định
    // luôn xanh, kể cả khi cột không bao giờ tới được frontend.
    stubApi({});
    ve({ can_plan: true });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Yêu cầu giao/ })).toBeInTheDocument());
    expect(screen.queryByRole("tab", { name: /Nhân viên giao hàng/ })).not.toBeInTheDocument();
  });

  it("⭐ chấm tab Yêu cầu giao theo luật ĐÃ XEM: mở tab là tắt, quay lại không bật lại", async () => {
    // Bản trước bật chấm hễ còn yêu cầu chờ ⇒ đứng ngay trong tab mà chấm vẫn đỏ (07/10/2026).
    // Màn mở ở tab Yêu cầu giao ⇒ bấm sang Đơn giao hàng TRƯỚC khi yêu cầu tải về thì mới thấy chấm.
    stubApi({ requests: [YEU_CAU] });
    const { container } = veDon({ can_plan: true });
    const cham = () => container.querySelector(".gh-seg__cham");
    await waitFor(() => expect(cham()).not.toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: /Yêu cầu giao/ }));
    await waitFor(() => expect(cham()).toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: /Đơn giao hàng/ }));
    expect(cham()).toBeNull();
  });

  it("⭐ bật ô Nhân viên giao hàng ⇒ tab đó HIỆN RA", async () => {
    stubApi({});
    ve({ can_view_drivers: true });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Nhân viên giao hàng/ })).toBeInTheDocument());
  });

  it("không có ô Nhân viên giao hàng thì KHÔNG gọi API tab đó", async () => {
    // Gọi rồi nuốt 403 là che mất lỗi cấu hình thật, và tốn một vòng mạng vô ích.
    const goi = stubApi({});
    ve({ can_plan: true });
    await waitFor(() => expect(goi.some((g) => g.url.includes("/bang-giao"))).toBe(true));
    // Chỉ xét lời gọi của TAB (kèm tháng) — ngăn Lên đơn ở tab Yêu cầu giao tự nạp danh sách tài xế.
    expect(goi.some((g) => g.url.includes("/nhan-vien?thang="))).toBe(false);
  });
});

describe("Giao hàng · khoảng trống nói được bước tiếp theo", () => {
  it("chưa có chuyến nào ⇒ chỉ đường về màn Đơn hàng bán", async () => {
    stubApi({});
    ve({});
    await waitFor(() =>
      expect(screen.getByText("Chưa có đơn giao hàng nào")).toBeInTheDocument());
    expect(screen.getByText(/Đơn hàng bán/)).toBeInTheDocument();
  });
});

describe("Giao hàng · bảng kế hoạch", () => {
  it("hiện đủ mã yêu cầu, khách, tài xế và trạng thái đọc được", async () => {
    stubApi({ trips: [CHUYEN] });
    ve({});
    await waitFor(() => expect(screen.getByText("YCGH-260819-A1B2")).toBeInTheDocument());
    expect(screen.getByText("Công ty Bánh kẹo Minh Long")).toBeInTheDocument();
    expect(screen.getByText("Trần Văn Hùng")).toBeInTheDocument();
    // Trạng thái phải là TIẾNG VIỆT, không phải khoá kỹ thuật `dang_giao`. Nhìn TRONG dòng — hàng
    // lọc nhanh phía trên cũng có nút "Đang giao".
    const dong = screen.getByText("YCGH-260819-A1B2").closest("tr")!;
    expect(within(dong).getByText("Đang giao")).toBeInTheDocument();
    expect(screen.queryByText("dang_giao")).not.toBeInTheDocument();
  });

  it("chuyến đang giao mà KHÔNG có ô Thao tác ⇒ không bày nút Nhập kết quả", async () => {
    // Bày nút rồi bấm ăn 403 trông như hệ thống hỏng, chứ không như "anh không có quyền".
    stubApi({ trips: [CHUYEN] });
    ve({});
    await waitFor(() => expect(screen.getByText("YCGH-260819-A1B2")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Nhập kết quả/ })).not.toBeInTheDocument();
  });

  it("có ô Thao tác ⇒ nút Nhập kết quả hiện ra", async () => {
    stubApi({ trips: [CHUYEN] });
    ve({ can_create: true });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Nhập kết quả/ })).toBeInTheDocument());
  });
});

describe("Giao hàng · không để chuyến nào tắc", () => {
  // Mỗi trạng thái "đang chạy" phải có ĐÚNG một nút đưa nó đi tiếp. Thiếu một nút thì chuyến
  // nằm lại đó vĩnh viễn — API có mà giao diện quên là loại lỗi không ai báo, chỉ thấy "đơn này
  // sao mãi chưa xong". Trừ "Chờ kho xuất": kho ghi sổ phiếu xuất là chuyến tự đi tiếp (12/10/2026).
  const buoc: [string, RegExp][] = [
    ["da_lay_hang", /Bắt đầu giao/],
    ["dang_giao", /Nhập kết quả/],
    // Chuyến CŨ chưa có yêu cầu nhập trả hàng — còn nút lập phiếu trả kho.
    ["dang_tra_hang", /Lập phiếu trả kho/],
  ];
  for (const [tt, nut] of buoc) {
    it(`trạng thái ${tt} có nút đi tiếp`, async () => {
      stubApi({ trips: [{ ...CHUYEN, trang_thai: tt }] });
      ve({ can_create: true });
      expect(await screen.findByRole("button", { name: nut })).toBeInTheDocument();
    });
  }

  it("⭐ chờ kho xuất ⇒ KHÔNG có nút Đã lấy hàng: kho ghi sổ phiếu xuất là chuyến tự đi tiếp", async () => {
    // Lỗi thật 12/10/2026: nút chỉ gác "đã gửi kho" nên tài xế bấm được cả khi kho chưa lập phiếu.
    stubApi({ trips: [{ ...CHUYEN, trang_thai: "dang_chuan_bi", yeu_cau_kho_ma: "DNX0007" }] });
    veDon({ can_create: true, can_plan: true });
    expect(await screen.findByText("Chờ kho xuất")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Đã lấy hàng|Bắt đầu giao|Gửi yêu cầu xuất kho/ })).toBeNull();
  });

  it("đang trả hàng đã có yêu cầu nhập ⇒ chờ THỦ KHO ghi sổ, tài xế không bấm gì", async () => {
    stubApi({ trips: [{ ...CHUYEN, trang_thai: "dang_tra_hang", tra_hang_ma: "YCN-0009", tra_hang_trang_thai: "approved" }] });
    ve({ can_create: true });
    expect(await screen.findByText("Chờ kho nhận lại")).toBeInTheDocument();
    expect(screen.getByText("YCN-0009")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lập phiếu trả kho|Kho đã nhận lại/ })).toBeNull();
  });

  /** Đổi / huỷ là việc của RIÊNG một chuyến, nằm trong ngăn — bấm dòng để mở. */
  const moNganChuyen = async () => {
    await userEvent.click(await screen.findByText("YCGH-260819-A1B2"));
    return screen.findByRole("dialog", { name: "YCGH-260819-A1B2" });
  };

  it("chuyến chưa cầm hàng có nút Đổi / huỷ chuyến cho người lên đơn", async () => {
    stubApi({ trips: [{ ...CHUYEN, trang_thai: "da_len_ke_hoach" }] });
    veDon({ can_plan: true, can_create: true });
    const n = await moNganChuyen();
    expect(within(n).getByRole("button", { name: /Đổi \/ huỷ chuyến/ })).toBeInTheDocument();
  });

  it("kho đã lập phiếu ⇒ bấm Huỷ chuyến chỉ báo lý do, không có nút xác nhận huỷ", async () => {
    stubApi({ trips: [{ ...CHUYEN, trang_thai: "dang_chuan_bi", yeu_cau_kho_ma: "YCX-0007",
      kho_da_lap_phieu: true }] });
    veDon({ can_plan: true, can_create: true });
    const n = await moNganChuyen();
    await userEvent.click(within(n).getByRole("button", { name: /Đổi \/ huỷ chuyến/ }));
    const ngan = await screen.findByRole("dialog", { name: "Đổi chuyến" });
    await userEvent.click(within(ngan).getByRole("button", { name: "Huỷ chuyến" }));
    expect(await screen.findByText(/báo kho huỷ phiếu trước/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Lý do huỷ" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Huỷ chuyến" })).toHaveLength(1);
  });

  it("⭐ ngăn Đổi chuyến: đổi phụ xe trên danh sách người, Lưu gửi phụ xe + ghi chú, không đụng tài xế", async () => {
    // Phương án A 12/10/2026: dùng lại danh sách người của Lên đơn, đổi được cả phụ xe.
    const goi = stubApi({
      trips: [{ ...CHUYEN, trang_thai: "da_len_ke_hoach", xe_bien_so: "51D-853.66" }],
      taiXe: [
        { id: 5, code: "NVGH01", full_name: "Trần Văn Hùng", department: "Kho", co_tai_khoan: true, co_thao_tac: true },
        { id: 6, code: "NVGH02", full_name: "Lê Văn Phụ", department: "Kho", co_tai_khoan: true, co_thao_tac: true },
      ],
      rieng: (u) => (u.endsWith("/plans/1") ? { trip: CHUYEN, canh_bao: [] } : undefined),
    });
    veDon({ can_plan: true, can_create: true });
    const n = await moNganChuyen();
    await userEvent.click(within(n).getByRole("button", { name: /Đổi \/ huỷ chuyến/ }));
    const ngan = await screen.findByRole("dialog", { name: "Đổi chuyến" });
    expect(within(ngan).getByText("51D-853.66")).toBeInTheDocument();
    expect(within(ngan).getByRole("button", { name: "Lưu thay đổi" })).toBeDisabled();
    expect(await within(ngan).findByRole("button", { name: "Tài xế: Trần Văn Hùng" }))
      .toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(ngan).getByRole("button", { name: "Phụ xe: Lê Văn Phụ" }));
    await userEvent.type(within(ngan).getByRole("textbox", { name: "Ghi chú cho kíp xe" }), "Gọi bảo vệ");
    await userEvent.click(within(ngan).getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(goi.some((g) => g.url.endsWith("/plans/1") && g.body)).toBe(true));
    expect(goi.find((g) => g.url.endsWith("/plans/1") && g.body)!.body)
      .toEqual({ phu_xe_employee_id: 6, ghi_chu_phan_cong: "Gọi bảo vệ" });
  });

  it("Huỷ chuyến hỏi lý do ⇒ gửi lý do lên máy chủ", async () => {
    const goi = stubApi({
      trips: [{ ...CHUYEN, trang_thai: "da_len_ke_hoach" }],
      rieng: (u) => (u.endsWith("/plans/1/huy") ? CHUYEN : undefined),
    });
    veDon({ can_plan: true, can_create: true });
    const n = await moNganChuyen();
    await userEvent.click(within(n).getByRole("button", { name: /Đổi \/ huỷ chuyến/ }));
    const ngan = await screen.findByRole("dialog", { name: "Đổi chuyến" });
    await userEvent.click(within(ngan).getByRole("button", { name: "Huỷ chuyến" }));
    const oLyDo = await screen.findByRole("textbox", { name: "Lý do huỷ" });
    const xacNhan = () => screen.getAllByRole("button", { name: "Huỷ chuyến" }).at(-1)!;
    expect(xacNhan()).toBeDisabled();
    await userEvent.type(oLyDo, "Khách dời ngày");
    await userEvent.click(xacNhan());
    await waitFor(() => expect(goi.some((g) => g.url.endsWith("/plans/1/huy"))).toBe(true));
    expect(goi.find((g) => g.url.endsWith("/plans/1/huy"))!.body).toEqual({ ly_do: "Khách dời ngày" });
  });

  it("⭐ huỷ chuyến xong mà dòng biến khỏi danh sách ⇒ ngăn đang mở đóng theo, không đứng ở Chờ kho xuất (#33)", async () => {
    const trips: unknown[] = [{ ...CHUYEN, trang_thai: "dang_chuan_bi" }];
    stubApi({
      trips,
      rieng: (u) => {
        if (!u.endsWith("/plans/1/huy")) return undefined;
        trips.length = 0;     // máy chủ: chuyến huỷ ⇒ rút khỏi bảng giao
        return { ...CHUYEN, trang_thai: "da_huy" };
      },
    });
    veDon({ can_plan: true, can_create: true });
    const n = await moNganChuyen();
    expect(within(n).getAllByText(/Chờ kho xuất/).length).toBeGreaterThan(0);
    await userEvent.click(within(n).getByRole("button", { name: /Đổi \/ huỷ chuyến/ }));
    const ngan = await screen.findByRole("dialog", { name: "Đổi chuyến" });
    await userEvent.click(within(ngan).getByRole("button", { name: "Huỷ chuyến" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Lý do huỷ" }), "Khách hoãn");
    await userEvent.click(screen.getAllByRole("button", { name: "Huỷ chuyến" }).at(-1)!);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "YCGH-260819-A1B2" })).toBeNull());
  });
});

describe("Giao hàng · yêu cầu xuất kho là chứng từ CỦA KHO", () => {
  it("⭐ lên đơn là gửi kho ⇒ KHÔNG còn nút Gửi yêu cầu xuất kho, kể cả chuyến cũ chưa gửi", async () => {
    // Hàng ra khỏi kho vẫn phải có phiếu kho — nhưng lên đơn rồi thì kiểu gì cũng gửi, nên máy
    // chủ gửi luôn lúc lên đơn (12/10/2026) thay vì bắt điều phối bấm thêm một nút.
    stubApi({ trips: [{ ...CHUYEN, trang_thai: "da_len_ke_hoach", yeu_cau_kho_ma: null }] });
    veDon({ can_plan: true, can_create: true });
    await waitFor(() => expect(screen.getByText("YCGH-260819-A1B2")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Gửi yêu cầu xuất kho/ })).toBeNull();
  });

  it("mã DNX KHÔNG bày ở cột Thao tác", async () => {
    // Nó không phải thao tác, không có nhãn, đứng cạnh nút thì trông như một nút hỏng
    // (chủ chốt 20/08/2026). Mã vẫn còn ở chi tiết yêu cầu, chỗ có ngữ cảnh để đọc.
    stubApi({ trips: [{ ...CHUYEN, trang_thai: "da_len_ke_hoach" }] });
    veDon({ can_plan: true });
    await waitFor(() => expect(screen.getByText("YCGH-260819-A1B2")).toBeInTheDocument());
    expect(screen.queryByText("DNX0007")).toBeNull();
  });
});

describe("Giao hàng · một yêu cầu = MỘT dòng", () => {
  // Gộp theo yêu cầu (lấy lần MỚI NHẤT + cộng km cả các lần) nay làm ở MÁY CHỦ
  // (`delivery_repo._loc_chuyen`/`tong_km_theo_yeu_cau`, xem `test_09b_...` bên backend) — FE chỉ
  // còn việc HIỂN THỊ đúng những gì `/trips` trả về, nên stub thẳng MỘT dòng đã gộp sẵn, đúng
  // hình dạng API thật (PRD §9: 18km lần hỏng + 22km lần thành công ⇒ `tong_km` 40, ở đây dùng
  // 10 + 200 = 210 để tách bạch với `km` riêng của lần cuối).
  const DA_GOP = { ...CHUYEN, lan_thu: 2, trang_thai: "thanh_cong", km: 200, tong_km: 210 };

  it("⭐ cột Km hiện TỔNG cả các lần máy chủ gộp, không phải km lần cuối", async () => {
    stubApi({ trips: [DA_GOP] });
    ve({});
    await waitFor(() => expect(screen.getByText("210")).toBeInTheDocument());
    expect(screen.queryByText("200")).not.toBeInTheDocument();
  });

  it("dòng hiện trạng thái của lần MỚI NHẤT do máy chủ trả về", async () => {
    stubApi({ trips: [DA_GOP] });
    ve({});
    await waitFor(() => expect(screen.getByText("Giao thành công")).toBeInTheDocument());
    const dong = screen.getByText("Giao thành công").closest("tr")!;
    expect(within(dong).queryByText("Giao thiếu")).not.toBeInTheDocument();
  });
});

describe("Giao hàng · ô kết quả phải hiện SỐ LƯỢNG", () => {
  async function moKetQua(kq?: string) {
    stubApi({ trips: [CHUYEN] });
    ve({ can_create: true });
    await userEvent.click(await screen.findByRole("button", { name: /Nhập kết quả/ }));
    if (kq) await userEvent.click(await screen.findByRole("radio", { name: kq }));
  }

  it("⭐ Nhận đủ vẫn hiện số lượng của TỪNG dòng hàng", async () => {
    // Trước đây chọn "Giao thành công" là máy tự điền, người bấm không thấy mình xác nhận bao
    // nhiêu — mà đó là con số cộng thẳng vào "đã giao" của đơn.
    await moKetQua();
    const h = await screen.findByRole("dialog", { name: /^Tới / });
    await waitFor(() => expect(within(h).getAllByRole("listitem")).toHaveLength(2));
    for (const li of within(h).getAllByRole("listitem")) expect(li).toHaveTextContent(/119/);
    // Nhận đủ = số là CHỮ, không có ô; muốn sửa số thì đổi kết quả sang Nhận thiếu.
    expect(screen.queryByLabelText(/Số thực nhận — Hộp thuốc/)).toBeNull();
  });

  it("Giao thiếu ⇒ mở khoá ô để sửa", async () => {
    await moKetQua("Nhận thiếu");
    expect(await screen.findByLabelText(/Số thực nhận — Hộp thuốc/)).toBeEnabled();
  });

  it("⭐ gửi giao thiếu phải kèm ĐỦ HAI dòng hàng, không chỉ dòng đầu", async () => {
    // Bản đầu chỉ gửi `lines[0]` — đơn hai mặt hàng là ghi thiếu hẳn một dòng, không ai báo.
    const goi = stubApi({ trips: [CHUYEN] });
    ve({ can_create: true });
    await userEvent.click(await screen.findByRole("button", { name: /Nhập kết quả/ }));
    await userEvent.click(await screen.findByRole("radio", { name: "Nhận thiếu" }));

    const o1 = await screen.findByLabelText(/Số thực nhận — Hộp thuốc/);
    await userEvent.clear(o1);
    await userEvent.type(o1, "60");
    await userEvent.type(screen.getByLabelText(/Số km thực tế/), "22");
    await userEvent.type(screen.getByLabelText(/Người nhận hàng/), "Chị Hạnh");
    await userEvent.click(screen.getByRole("button", { name: /Lưu kết quả/ }));

    const post = goi.find((g) => g.url.includes("/ket-qua"));
    expect(post).toBeTruthy();
    const body = post!.body as { so_thuc_nhan: { order_line_id: number; qty: number }[] };
    expect(body.so_thuc_nhan).toEqual([
      { order_line_id: 11, qty: 60 },
      { order_line_id: 12, qty: 119 },
    ]);
  });
});

describe("Giao hàng · KHO LẬP PHIẾU ⇒ \"Kho đã chuẩn bị xong\"", () => {
  // Chủ chốt 20/08/2026. Kho KHÔNG bấm gì trên màn Giao hàng — họ lập phiếu bên màn của họ, và
  // chữ ở đây đổi theo sổ kho (`kho_da_lap_phieu` suy từ `stock_vouchers`, không phải cột lưu).
  const dangChuanBi = { ...CHUYEN, trang_thai: "dang_chuan_bi" };

  it("chưa lập phiếu ⇒ vẫn là \"Chờ kho xuất\"", async () => {
    stubApi({ trips: [{ ...dangChuanBi, kho_da_lap_phieu: false }] });
    ve({ can_read: true });
    expect(await screen.findByText("Chờ kho xuất")).toBeInTheDocument();
    expect(screen.queryByText("Kho đã chuẩn bị xong")).toBeNull();
  });

  it("⭐ lập phiếu rồi ⇒ đổi thành \"Kho đã chuẩn bị xong\"", async () => {
    // Tài xế nhìn dòng này để biết có nên đi lấy hàng chưa — sai chữ là đi không.
    stubApi({ trips: [{ ...dangChuanBi, kho_da_lap_phieu: true }] });
    ve({ can_read: true });
    expect(await screen.findByText("Kho đã chuẩn bị xong")).toBeInTheDocument();
  });

  it("cờ chỉ đổi chữ ở ĐÚNG bước chuẩn bị, không tràn sang bước khác", async () => {
    // `dang_giao` mà cũng đổi chữ thì tài xế đang trên đường lại thấy "Kho đã chuẩn bị xong".
    stubApi({ trips: [{ ...CHUYEN, trang_thai: "dang_giao", kho_da_lap_phieu: true }] });
    ve({ can_read: true });
    expect(await screen.findByText("Đang giao")).toBeInTheDocument();
    expect(screen.queryByText("Kho đã chuẩn bị xong")).toBeNull();
  });
});

describe("Giao hàng · KM ngày và KM tháng là HAI cột", () => {
  const NV = {
    employee_id: 5, ho_ten: "Trần Văn Hùng", trang_thai: "ranh",
    chuyen_dang_thuc_hien: null, chuyen_ke_tiep: null,
    so_chuyen_xong: 1, tong_km: 12, so_chuyen_thang: 9, tong_km_thang: 340,
  };

  it("⭐ hiện ĐỦ cả hai con số, không gộp làm một", async () => {
    // Hai khung thời gian trả lời hai câu khác nhau: ngày để điều độ ("giờ ai đang rảnh"),
    // tháng để theo dõi định kỳ (chủ chốt 20/08/2026). Gộp một cột là mất một trong hai.
    stubApi({ drivers: [NV] });
    ve({ can_read: true, can_view_drivers: true });
    await userEvent.click(await screen.findByRole("tab", { name: /Nhân viên giao hàng/ }));
    expect(await screen.findByText("340")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("⭐ đổi THÁNG ⇒ gọi lại API kèm tham số tháng", async () => {
    // Thiếu `thang` trong deps của `load` thì đổi tháng mà bảng đứng im — người dùng tưởng
    // tháng sau không có gì (chủ chốt 20/08/2026: "tôi muốn xem tháng sau như nào").
    const goi = stubApi({ drivers: [NV] });
    ve({ can_read: true, can_view_drivers: true });
    await userEvent.click(await screen.findByRole("tab", { name: /Nhân viên giao hàng/ }));

    // Ô kỳ tự vẽ (MonthPicker): bấm mở bảng 12 tháng, lật về năm 2026 rồi bấm Tháng 9.
    await userEvent.click(await screen.findByLabelText(/Tháng/));
    const bang = screen.getByRole("dialog", { name: "Tháng" });
    for (let i = 0; i < 20 && !within(bang).queryByText("Năm 2026"); i++) {
      const nam = Number(within(bang).getByText(/^Năm \d+$/).textContent!.slice(4));
      await userEvent.click(within(bang).getByRole("button", { name: nam > 2026 ? "Năm trước" : "Năm sau" }));
    }
    await userEvent.click(within(bang).getByRole("button", { name: "Tháng 9" }));
    await waitFor(() =>
      expect(goi.some((g) => g.url.includes("thang=2026-09"))).toBe(true));
  });

  it("hết người trong tháng đang xem ⇒ VẪN còn ô chọn tháng để quay lại", async () => {
    // Ẩn ô chọn lúc bảng rỗng là nhốt người dùng ở đúng cái tháng trống.
    stubApi({ drivers: [] });
    ve({ can_read: true, can_view_drivers: true });
    await userEvent.click(await screen.findByRole("tab", { name: /Nhân viên giao hàng/ }));
    expect(await screen.findByLabelText(/Tháng/)).toBeInTheDocument();
  });

  it("thiếu số tháng (bản cũ của máy chủ) ⇒ hiện 0, không vỡ", async () => {
    // Máy chủ chưa deploy mà FE đã lên thì `so_chuyen_thang` vắng — hiện "undefined" thì xấu,
    // mà crash thì mất cả bảng.
    const { so_chuyen_thang: _a, tong_km_thang: _b, ...cu } = NV;
    stubApi({ drivers: [cu] });
    ve({ can_read: true, can_view_drivers: true });
    await userEvent.click(await screen.findByRole("tab", { name: /Nhân viên giao hàng/ }));
    expect(await screen.findByText("Trần Văn Hùng")).toBeInTheDocument();
  });
});

describe("Giao hàng · chọn tài xế không cảnh báo quyền", () => {
  // 12/10/2026 chủ bỏ cảnh báo "chưa cấp quyền / chưa có tài khoản" ở ngăn lên đơn — người lên đơn
  // phân chuyến cho ai cũng được, chuyện tài xế có bấm được nút hay không không phải việc của ngăn này.
  const YC = {
    id: 7, code: "YCGH-260819-A1B2", order_id: 3, order_code: "DH-GH-03",
    customer_name: "Dược phẩm Sao Mai", ngay_can_giao: "2026-08-26", dia_chi: "Lô C3",
    trang_thai: "cho_len_ke_hoach", lines: [], so_lan_giao: 0, trang_thai_lsx: [],
    created_at: "2026-08-19T10:00:00Z",
  };

  it("tài xế chưa có tài khoản ⇒ không thẻ, không băng cảnh báo", async () => {
    stubApi({ requests: [YC], taiXe: [{ id: 9, code: "NV9", full_name: "Tài Xế A", department: "Giao hàng",
                                        co_tai_khoan: false, co_thao_tac: false }] });
    ve({ can_plan: true, can_read: true });
    await userEvent.click(await screen.findByRole("tab", { name: /Yêu cầu giao/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Lên đơn giao/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Tài xế: Tài Xế/ }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Chưa có tài khoản|Chưa cấp quyền/i)).toBeNull();
  });
});

describe("Giao hàng · cột Hàng một dòng: món đầu + thẻ số món còn lại", () => {
  // 20/08/2026 chủ chốt chỉ ĐẾM vì tên dài làm dòng cao gấp ba. 07/10/2026 chủ chọn phương án A
  // (docs/mockups/giao-hang-lam-lai-3-phuong-an.html): ghi tên món đầu MỘT dòng, dài thì cắt "…",
  // món còn lại gom thành thẻ "+N món" — đủ biết hàng gì mà dòng vẫn một hàng.
  const YC2 = {
    id: 7, code: "YCGH-260819-A1B2", order_id: 3, order_code: "DH-GH-03",
    customer_name: "Dược phẩm Sao Mai", ngay_can_giao: "2026-08-26", dia_chi: "Lô C3",
    trang_thai: "cho_len_ke_hoach", so_lan_giao: 0, trang_thai_lsx: [],
    created_at: "2026-08-19T10:00:00Z",
    lines: [
      { id: 1, order_line_id: 11, qty: 1200, mo_ta: "Hộp thuốc 10 vỉ — in 2 màu, cán bóng",
        don_vi_tinh: "hộp", da_giao: 0 },
      { id: 2, order_line_id: 12, qty: 1200, mo_ta: "Tờ hướng dẫn sử dụng — gấp 3",
        don_vi_tinh: "tờ", da_giao: 0 },
    ],
  };

  it("⭐ hiện tên món đầu + \"+1 món\", không đổ hết danh sách ra bảng", async () => {
    stubApi({ requests: [YC2] });
    ve({ can_plan: true, can_read: true });
    await userEvent.click(await screen.findByRole("tab", { name: /Yêu cầu giao/ }));
    expect(await screen.findByText("Hộp thuốc 10 vỉ — in 2 màu, cán bóng")).toBeInTheDocument();
    expect(screen.getByText("+1 món")).toBeInTheDocument();
    expect(screen.queryByText("Tờ hướng dẫn sử dụng — gấp 3")).toBeNull();
  });

  it("⭐ cụm Ruột + Bìa là MỘT quyển: tên cụm, không \"+1 món\", ô SL có số (12/10/2026)", async () => {
    const cum = { cum_khoa: "sach a5|300", cum_ten: "Sách A5 64 trang", cum_dvt: "cuốn" };
    stubApi({ requests: [{ ...YC2, lines: [
      { id: 1, order_line_id: 11, qty: 300, mo_ta: "Ruột sách A5 64 trang", don_vi_tinh: "cuốn", da_giao: 0, ...cum },
      { id: 2, order_line_id: 12, qty: 300, mo_ta: "Bìa sách A5", don_vi_tinh: "cuốn", da_giao: 0, ...cum },
    ] }] });
    ve({ can_plan: true, can_read: true });
    await userEvent.click(await screen.findByRole("tab", { name: /Yêu cầu giao/ }));
    const o = await screen.findByText("Sách A5 64 trang");
    expect(o.closest("td")?.getAttribute("title")).toBe("Sách A5 64 trang: 300 cuốn (Ruột sách A5 64 trang + Bìa sách A5)");
    expect(screen.queryByText("+1 món")).toBeNull();
    expect(screen.queryByText("Ruột sách A5 64 trang")).toBeNull();
    expect(o.closest("tr")).toHaveTextContent("300cuốn");
  });
});

describe("Giao hàng · khung trang", () => {
  it("⭐ gốc màn phải mang class khung `.rc` — thiếu là nội dung dán sát hai mép", async () => {
    // Bản đầu để gốc là `.kho-list` (mượn của ba màn Kho). Class đó CHỈ chỉnh bảng, không mang
    // layout — ba màn Kho không lộ ra vì `KhoPage` đã bọc `.rc` sẵn, còn màn này do AppShell
    // dựng thẳng nên không có ai bọc hộ. `tsc` và `vite build` đều xanh, mắt mới thấy.
    stubApi({});
    const { container } = ve({});
    await waitFor(() =>
      expect(screen.getByText("Chưa có đơn giao hàng nào")).toBeInTheDocument());
    const goc = container.firstElementChild;
    expect(goc?.tagName).toBe("MAIN");
    expect(goc).toHaveClass("rc");
  });
});

describe("Giao hàng · ô số phải là ô SỐ", () => {
  it("⭐ ô km là input số, không phải ô chữ", async () => {
    // `inputMode="numeric"` CHỈ đổi bàn phím điện thoại — trên máy tính gõ chữ vẫn lọt vào.
    // Bản đầu dùng đúng cái đó và người dùng gõ được "ưe" vào ô số lượng.
    stubApi({ trips: [CHUYEN] });
    ve({ can_create: true });
    const nut = await screen.findByRole("button", { name: /Nhập kết quả/ });
    await userEvent.click(nut);
    const o = await screen.findByLabelText(/Số km thực tế/);
    expect(o).toHaveAttribute("type", "number");
    expect(o).toHaveAttribute("min", "0");   // 0 km là số THẬT, đừng đổi thành 1
  });

  it("⭐ chọn tài xế bằng danh sách, không bắt gõ mã", async () => {
    // Gõ mã nhân viên thì sai một chữ số là phân công nhầm người, không có gì báo.
    stubApi({ requests: [], trips: [] });
    ve({ can_plan: true });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Yêu cầu giao/ })).toBeInTheDocument());
    expect(screen.queryByLabelText(/Mã nhân viên/)).not.toBeInTheDocument();
  });
});

describe("Giao hàng · LƯỢT XE — lên đơn vào lượt (PRD khoán km §14)", () => {
  // Chủ chốt 18/09/2026: tài xế ghi số đồng hồ lúc đi, lúc tới từng khách, lúc về kho — máy tự
  // trừ ra km TỪNG CHẶNG rồi tra đơn giá theo chặng. Người lên đơn quyết đơn nào chung một lượt.
  const XE = { id: 3, ma: "51D-853.66", ten: "Xe tải 3.5T", tai_trong: 3.5, active: true };
  const YC = {
    id: 7, code: "YCGH-260819-A1B2", order_id: 3, order_code: "DH-GH-03",
    customer_name: "Dược phẩm Sao Mai", ngay_can_giao: "2026-09-18", dia_chi: "Lô C3",
    trang_thai: "cho_len_ke_hoach", lines: [], so_lan_giao: 0, trang_thai_lsx: [],
    created_at: "2026-09-18T01:00:00Z",
  };

  async function lenDon(luotMo: unknown[]) {
    const goi = stubApi({
      requests: [YC], xe: [XE], luotMo,
      rieng: (u) => (u.endsWith("/plans") ? { trip: CHUYEN, canh_bao: [] } : undefined),
    });
    ve({ can_plan: true, can_read: true });
    await userEvent.click(await screen.findByRole("tab", { name: /Yêu cầu giao/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Lên đơn giao/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Tài xế: Trần Văn Hùng" }));
    await userEvent.click(await screen.findByRole("radio", { name: /51D-853\.66/ }));
    return goi;
  }

  it("⭐ chọn xe ⇒ hiện ô Lượt xe, mặc định LƯỢT MỚI và gửi `luot_xe_id: \"moi\"`", async () => {
    const goi = await lenDon([]);
    expect(await screen.findByLabelText(/Lượt xe/)).toHaveValue("moi");
    await userEvent.click(screen.getByRole("button", { name: "Lên đơn giao hàng" }));
    await waitFor(() => expect(goi.some((g) => g.url.endsWith("/plans"))).toBe(true));
    const body = goi.find((g) => g.url.endsWith("/plans"))!.body as Record<string, unknown>;
    expect(body.vehicle_id).toBe(3);
    expect(body.luot_xe_id).toBe("moi");
  });

  it("⭐ ghép vào lượt ĐANG MỞ của xe đó ⇒ gửi id lượt", async () => {
    const goi = await lenDon([{ id: 4, code: "LX-260918-AB12", ngay: "2026-09-18", so_diem: 1,
                               tai_xe: "Trần Văn Hùng", da_xuat_phat: false }]);
    const o = await screen.findByLabelText(/Lượt xe/);
    await waitFor(() =>
      expect(within(o).getByRole("option", { name: /LX-260918-AB12/ })).toBeInTheDocument());
    await userEvent.selectOptions(o, "4");
    await userEvent.click(screen.getByRole("button", { name: "Lên đơn giao hàng" }));
    await waitFor(() => expect(goi.some((g) => g.url.endsWith("/plans"))).toBe(true));
    const body = goi.find((g) => g.url.endsWith("/plans"))!.body as Record<string, unknown>;
    expect(body.luot_xe_id).toBe(4);
    // Lượt của xe NÀO thì hỏi đúng xe đó — lượt là vòng chạy của một chiếc xe.
    expect(goi.some((g) => g.url.includes("/luot-xe?vehicle_id=3"))).toBe(true);
  });
});

describe("Giao hàng · ngăn LÊN ĐƠN phương án B (07/10/2026)", () => {
  // Mockup docs/mockups/giao-hang-len-don-phuong-an-B.html: hai danh sách xe + người, mỗi bên một ô
  // tìm GẦN ĐÚNG (không dấu, không thứ tự, chữ cái đầu, vài số biển số); hàng đã chọn ghim đầu.
  const YC = {
    id: 7, code: "YCGH-260819-A1B2", order_id: 3, order_code: "DH-GH-03",
    customer_name: "Dược phẩm Sao Mai", ngay_can_giao: "2026-09-18", dia_chi: "Lô C3",
    trang_thai: "cho_len_ke_hoach", lines: [], so_lan_giao: 0, trang_thai_lsx: [],
    created_at: "2026-09-18T01:00:00Z",
  };
  const NGUOI = [
    { id: 5, code: "NV094", full_name: "Nguyễn Văn Việt", department: "Giao hàng", co_tai_khoan: true, co_thao_tac: true },
    { id: 6, code: "NV097", full_name: "Trần Phong Vũ", department: "Giao hàng", co_tai_khoan: true, co_thao_tac: true },
    { id: 8, code: "NV096", full_name: "Trần Hoàng Giang", department: "Giao hàng", co_tai_khoan: true, co_thao_tac: true },
  ];
  const XE2 = [
    { id: 13, ma: "51K-77404", ten: "Xe a Việt", tai_trong: 5, active: true },
    { id: 15, ma: "51D-40752", ten: "Xe a Sang", tai_trong: 3.5, active: true },
  ];

  async function mo() {
    stubApi({ requests: [YC], taiXe: NGUOI, xe: XE2 });
    ve({ can_plan: true, can_read: true });
    await userEvent.click(await screen.findByRole("tab", { name: /Yêu cầu giao/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Lên đơn giao/ }));
    return screen.findByRole("dialog");
  }
  const tenNguoi = (hop: HTMLElement) =>
    within(within(hop).getByRole("group", { name: "Người" })).getAllByRole("button", { name: /^Tài xế: / })
      .map((b) => b.getAttribute("aria-label")!.replace("Tài xế: ", ""));

  it("⭐ tìm người không dấu, đảo thứ tự, chữ cái đầu, mã nhân viên đều ra đúng người", async () => {
    const hop = await mo();
    await within(hop).findByRole("button", { name: "Tài xế: Nguyễn Văn Việt" });
    const o = within(hop).getByRole("searchbox", { name: "Tìm người" });
    for (const q of ["viet nguyen", "nvv", "094"]) {
      fireEvent.change(o, { target: { value: q } });
      expect(tenNguoi(hop)).toEqual(["Nguyễn Văn Việt"]);
    }
    fireEvent.change(o, { target: { value: "zzz" } });
    expect(within(hop).getByText("Không có ai khớp «zzz»")).toBeInTheDocument();
  });

  it("⭐ bấm chọn xe thì hàng ĐỨNG YÊN chỗ cũ; xe đã chọn vẫn hiện dù ô tìm không khớp nó", async () => {
    const hop = await mo();
    const dsXe = () => within(within(hop).getByRole("radiogroup", { name: "Xe" })).getAllByRole("radio");
    await userEvent.click(await within(hop).findByRole("radio", { name: /51D-40752/ }));
    expect(dsXe().map((r) => r.textContent)).toEqual([
      expect.stringContaining("51K-77404"), expect.stringContaining("51D-40752"),
    ]);
    expect(dsXe()[1]).toHaveAttribute("aria-checked", "true");
    fireEvent.change(within(hop).getByRole("searchbox", { name: "Tìm xe" }), { target: { value: "77404" } });
    expect(dsXe().map((r) => r.textContent)).toEqual([
      expect.stringContaining("51K-77404"), expect.stringContaining("51D-40752"),
    ]);
  });

  it("⭐ bấm Tài xế người cuối danh sách thì người đó không nhảy lên đầu", async () => {
    const hop = await mo();
    await userEvent.click(await within(hop).findByRole("button", { name: "Tài xế: Trần Hoàng Giang" }));
    expect(tenNguoi(hop)).toEqual(["Nguyễn Văn Việt", "Trần Phong Vũ", "Trần Hoàng Giang"]);
  });

  it("⭐ một người không vừa tài xế vừa phụ xe; bấm Phụ xe người đang là tài xế thì đổi vai", async () => {
    const hop = await mo();
    await userEvent.click(await within(hop).findByRole("button", { name: "Tài xế: Trần Phong Vũ" }));
    await userEvent.click(within(hop).getByRole("button", { name: "Phụ xe: Trần Phong Vũ" }));
    expect(within(hop).getByRole("button", { name: "Tài xế: Trần Phong Vũ" })).toHaveAttribute("aria-pressed", "false");
    expect(within(hop).getByRole("button", { name: "Phụ xe: Trần Phong Vũ" })).toHaveAttribute("aria-pressed", "true");
    expect(within(hop).getByText("Còn thiếu xe và tài xế.")).toBeInTheDocument();
  });

  it("⭐ hộp Lên đơn KHÔNG còn ô giờ lấy hàng / dự kiến giao (mg 0400)", async () => {
    const hop = await mo();
    await within(hop).findByRole("button", { name: "Tài xế: Nguyễn Văn Việt" });
    expect(within(hop).queryByText("Thời gian")).toBeNull();
    expect(within(hop).queryByRole("textbox", { name: /Lấy hàng|Dự kiến giao/ })).toBeNull();
  });
});

describe("Giao hàng · bước ĐỀ NGHỊ XUẤT KHO sau Lên đơn (mg 0400, 12/10/2026)", () => {
  // Mockup docs/mockups/giao-hang-buoc-gui-kho: lưu đơn xong ngăn KHÔNG đóng mà sang đề nghị vừa
  // gửi kho để hẹn Cần lúc + dặn kho. Hàng khoá theo yêu cầu giao.
  const XE = { id: 3, ma: "51D-853.66", ten: "Xe tải 3.5T", tai_trong: 3.5, active: true };
  const YC = {
    id: 7, code: "YCGH-260819-A1B2", order_id: 3, order_code: "DH-GH-03",
    customer_name: "Dược phẩm Sao Mai", ngay_can_giao: "2026-09-18", dia_chi: "Lô C3",
    trang_thai: "cho_len_ke_hoach", lines: [], so_lan_giao: 0, trang_thai_lsx: [],
    created_at: "2026-09-18T01:00:00Z",
  };
  const DN = {
    id: 90, ma: "DNX0094", trip_id: 1, request_code: YC.code, customer_name: "Dược phẩm Sao Mai",
    order_code: "DH-GH-03", ngay_can_giao: "2099-09-18", ngay_can: "2099-09-18", can_luc: null,
    ghi_chu: null, kho_ten: "Kho thành phẩm", sua_duoc: true,
    hang: [{ ten: "Hộp thuốc 10 vỉ", ma: "TP-00002", so_luong: 119, dvt: "hộp" }],
  };

  async function lenDonXong(deNghi: unknown[]) {
    const goi = stubApi({
      requests: [YC], xe: [XE], deNghi,
      rieng: (u) => (u.endsWith("/plans") ? { trip: CHUYEN, canh_bao: [], phieu: ["DNX0094"] } : undefined),
    });
    ve({ can_plan: true, can_read: true });
    await userEvent.click(await screen.findByRole("tab", { name: /Yêu cầu giao/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Lên đơn giao/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Tài xế: Trần Văn Hùng" }));
    await userEvent.click(await screen.findByRole("radio", { name: /51D-853\.66/ }));
    await userEvent.click(screen.getByRole("button", { name: "Lên đơn giao hàng" }));
    return goi;
  }

  it("⭐ lưu đơn xong ⇒ ngăn sang Đề nghị xuất kho, hàng khoá, kho thành phẩm; Lưu cho kho gửi Cần lúc + ghi chú", async () => {
    const goi = await lenDonXong([DN]);
    const hop = await screen.findByRole("dialog");
    expect(await within(hop).findByRole("heading", { name: "Đề nghị xuất kho" })).toBeInTheDocument();
    expect(within(hop).getByText(/Đã lên đơn YCGH-260819-A1B2/)).toBeInTheDocument();
    expect(await within(hop).findByText("Hộp thuốc 10 vỉ")).toBeInTheDocument();
    expect(within(hop).getByText("Kho thành phẩm")).toBeInTheDocument();
    // Mở ra là ngày cần giao của yêu cầu, giờ để trống.
    expect(within(hop).getByRole("textbox", { name: "Ngày cần" })).toHaveValue("18/09/2099");
    expect(within(hop).getByRole("textbox", { name: "Giờ cần" })).toHaveValue("");

    const oGio = within(hop).getByRole("textbox", { name: "Giờ cần" });
    fireEvent.change(oGio, { target: { value: "14:00" } });
    fireEvent.blur(oGio);
    await userEvent.type(within(hop).getByRole("textbox", { name: /Ghi chú cho kho/ }), "Dán tem khách");
    await userEvent.click(within(hop).getByRole("button", { name: "Lưu cho kho" }));

    await waitFor(() => expect(goi.some((g) => g.url.endsWith("/de-nghi-kho") && g.body)).toBe(true));
    const body = goi.find((g) => g.url.endsWith("/de-nghi-kho") && g.body)!.body;
    expect(body).toEqual({ ngay_can: "2099-09-18", gio_can: "14:00",
                           dong: [{ trip_id: 1, ghi_chu: "Dán tem khách" }] });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Đề nghị xuất kho" })).toBeNull());
  });

  it("Để sau ⇒ đóng, không gửi hẹn kho (đề nghị giữ ngày cần giao)", async () => {
    const goi = await lenDonXong([DN]);
    const hop = await screen.findByRole("dialog");
    await within(hop).findByText("Hộp thuốc 10 vỉ");
    await userEvent.click(within(hop).getByRole("button", { name: "Để sau" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Đề nghị xuất kho" })).toBeNull());
    expect(goi.some((g) => g.url.endsWith("/de-nghi-kho") && g.body)).toBe(false);
  });

  it("kho đã lập phiếu ⇒ bước chỉ xem, không có nút Lưu cho kho", async () => {
    await lenDonXong([{ ...DN, sua_duoc: false }]);
    const hop = await screen.findByRole("dialog");
    expect(await within(hop).findByText("Kho đã lập phiếu nên không hẹn lại được nữa.")).toBeInTheDocument();
    expect(within(hop).queryByRole("button", { name: "Lưu cho kho" })).toBeNull();
  });
});

describe("Giao hàng · MỘT LƯỢT = MỘT DÒNG, bấm dòng mở ngăn (06/10/2026)", () => {
  // Mockup docs/mockups/giao-hang-phuong-an-B-chi-tiet.html: bảng mỗi dòng một lượt, ô Điểm giao kể
  // đủ khách + mã đơn + nơi giao + ngày hẹn; nút bước kế tiếp của cả lượt ngay trên dòng. Bấm dòng
  // ⇒ ngăn rộng chung: Lộ trình · Chứng từ (mỗi đơn một bộ) · Lịch sử.
  const LUOT_DIEM = {
    id: 4, code: "LX-260918-AB12", vehicle_id: 3, ngay: "2026-09-18", so_diem: 2,
    so_dong_ho_xuat_phat: null, so_dong_ho_ve_kho: null, ve_kho_luc: null, km_ve_kho: null,
    so_dong_ho: null, so_dong_ho_gan_nhat: null, goi_y_xuat_phat: 12000,
    cho_ve_kho: false, la_diem_cuoi: false,
  };
  const diem = (id: number, rid: number, code: string, khach: string, tt: string,
                luot: Record<string, unknown> = {}) => ({
    ...CHUYEN, id, request_id: rid, request_code: code, customer_name: khach, trang_thai: tt,
    order_code: `DH-${rid}`, dia_chi: "Số 18 Đại lộ Độc Lập, KCN VSIP 1, Phường Thuận An, TP Hồ Chí Minh",
    ngay_can_giao: "2026-09-19", nguoi_nhan: "Nguyễn Thanh Vy", sdt_nguoi_nhan: "0797235637",
    vehicle_id: 3, xe_bien_so: "51D-853.66", employee_name: "Trần Văn Hùng",
    phu_xe_name: "Lê Triều", yeu_cau_kho_ma: null, luot: { ...LUOT_DIEM, ...luot },
  });
  const khoi = (o: Record<string, unknown> = {}, tt = "dang_chuan_bi",
                luot: Record<string, unknown> = {}) => ({
    id: 4, code: "LX-260918-AB12", ngay: "2026-09-18", vehicle_id: 3, xe_bien_so: "51D-853.66",
    xe_ten: "Xe tải 3.5T", so_dong_ho_xuat_phat: null, so_dong_ho_ve_kho: null, ve_kho_luc: null,
    km_ve_kho: null, goi_y_xuat_phat: 12000, so_dong_ho_gan_nhat: null, cho_ve_kho: false,
    tong_km: 0, so_cho_lay_hang: 0, so_cho_bat_dau: 0, so_dang_giao: 0,
    created_at: "2026-09-18T01:00:00Z",
    diem: [diem(31, 21, "YCGH-260918-AAAA", "Young Poong", tt, luot),
           diem(32, 22, "YCGH-260918-BBBB", "AOBO", tt, luot)],
    ...o,
  });
  const dong = () => screen.findByRole("row", { name: "Lượt LX-260918-AB12" });
  /** Bấm vào dòng (ô mã lượt) ⇒ ngăn chi tiết mang tên lượt. */
  const moNgan = async () => {
    await userEvent.click(within(await dong()).getByText("LX-260918-AB12"));
    return screen.findByRole("dialog", { name: "LX-260918-AB12" });
  };

  it("⭐ một dòng MỘT hàng (phương án A 07/10/2026): xe, người giao, điểm ĐẦU + thẻ \"+N điểm\", tình trạng", async () => {
    stubApi({ khoi: [khoi({ so_cho_lay_hang: 2 })] });
    veDon({ can_plan: true });
    const d = await dong();
    expect(within(d).getByText("51D-853.66")).toBeInTheDocument();
    expect(within(d).getByText("Trần Văn Hùng")).toBeInTheDocument();
    // Phụ xe ở chú thích ô, không chiếm chỗ trên dòng.
    expect(within(d).getByText("Trần Văn Hùng").closest("td")).toHaveAttribute("title", "Phụ xe Lê Triều");
    expect(within(d).getByText("Young Poong")).toBeInTheDocument();
    expect(within(d).getByText("+1 điểm")).toBeInTheDocument();
    // Điểm sau nằm ở chú thích (đủ khách, đơn, nơi giao, hẹn) và trong ngăn — không đổ ra dòng.
    expect(within(d).queryByText("AOBO")).toBeNull();
    expect(within(d).getByText("Young Poong").closest("td")?.getAttribute("title")).toMatch(/2\. AOBO \(DH-22\)/);
    expect(within(d).getByText("DH-21")).toBeInTheDocument();
    // Bỏ số nhà đầu và tỉnh cuối — đủ để biết điểm nằm vùng nào.
    expect(within(d).getByText("KCN VSIP 1, Phường Thuận An")).toBeInTheDocument();
    expect(within(d).getByText("19/09")).toBeInTheDocument();
    // Chờ kho xuất thì dòng không có nút — kho ghi sổ là lượt tự đi tiếp.
    expect(within(d).getByText("Chờ kho xuất")).toBeInTheDocument();
    expect(within(d).queryByRole("button")).toBeNull();
    // Tab không mang số đếm (luật chung 07/10/2026) — số đơn đã nằm ở chân bảng.
    expect(screen.getByRole("tab", { name: /Đơn giao hàng/ })).not.toHaveTextContent(/\d/);
  });

  it("⭐ dòng lượt báo trễ hẹn theo điểm trễ nhất + số điểm trễ (12/10/2026)", async () => {
    // Hẹn 19/09: điểm 1 khách nhận 22/09 (trễ 3 ngày), điểm 2 nhận đúng 19/09.
    const k = khoi({ so_dong_ho_xuat_phat: 12000 }, "thanh_cong");
    const diemTre = [{ ...k.diem[0], thoi_gian_ket_thuc: "2026-09-22T03:00:00Z" },
                     { ...k.diem[1], thoi_gian_ket_thuc: "2026-09-19T03:00:00Z" }];
    stubApi({ khoi: [{ ...k, diem: diemTre }] });
    veDon({ can_plan: true });
    const d = await dong();
    expect(within(d).getByText("Trễ 3 ngày")).toBeInTheDocument();
    expect(within(d).getByText("1/2 điểm trễ")).toBeInTheDocument();
  });

  it("⭐ bấm dòng ⇒ dải lộ trình Rời kho → từng khách → Về kho, chọn sẵn điểm đầu chưa có kết quả", async () => {
    // Phương án C (12/10/2026): cả lượt là MỘT dải ô, chỉ thẻ của ô đang chọn hiện ra.
    stubApi({ khoi: [khoi({ so_cho_lay_hang: 2 })] });
    veDon({ can_plan: true });
    const n = await moNgan();
    expect(within(n).getByRole("tab", { name: /Lộ trình/ })).toHaveAttribute("aria-selected", "true");
    const lt = within(n).getByRole("list", { name: "Lộ trình" });
    expect(within(lt).getAllByRole("button").map((b) => b.getAttribute("aria-label")))
      .toEqual(["Mốc rời kho", "Điểm 1 Young Poong", "Điểm 2 AOBO", "Mốc về kho"]);
    expect(within(lt).getByRole("button", { name: "Điểm 1 Young Poong" })).toHaveAttribute("aria-pressed", "true");
    expect(within(n).queryByRole("article", { name: "Điểm 2 AOBO" })).toBeNull();
    const d1 = within(n).getByRole("article", { name: "Điểm 1 Young Poong" });
    expect(within(d1).getByText(/Số 18 Đại lộ Độc Lập/)).toBeInTheDocument();
    expect(within(d1).getByRole("link", { name: "Mở bản đồ" })).toHaveAttribute(
      "href", expect.stringContaining("google.com/maps/search"));
    expect(within(d1).getByRole("link", { name: "0797 235 637" })).toHaveAttribute("href", "tel:0797235637");
    // Hàng của điểm đọc từ chi tiết yêu cầu.
    expect(await within(d1).findByText("Hộp thuốc 10 vỉ")).toBeInTheDocument();
    // Chờ kho xuất: đầu ngăn không có nút, chỉ một câu nói lượt đang chờ ai.
    expect(within(n).getByText(/Kho ghi sổ phiếu xuất xong thì điểm đó tự sang Đã lấy hàng/)).toBeInTheDocument();
    expect(within(n).queryByRole("button", { name: /Gửi yêu cầu xuất kho|Đã lấy hàng/ })).toBeNull();
    // Bấm ô khác trên dải ⇒ thẻ đổi theo; ô Rời kho nói xe chưa rời.
    await userEvent.click(within(lt).getByRole("button", { name: "Điểm 2 AOBO" }));
    expect(within(n).getByRole("article", { name: "Điểm 2 AOBO" })).toBeInTheDocument();
    expect(within(n).queryByRole("article", { name: "Điểm 1 Young Poong" })).toBeNull();
    await userEvent.click(within(lt).getByRole("button", { name: "Mốc rời kho" }));
    expect(within(within(n).getByRole("article", { name: "Rời kho" })).getByText(/Xe chưa rời kho/))
      .toBeInTheDocument();
  });

  it("⭐ tab Chứng từ: mỗi đơn một bộ giấy tờ — chọn đơn nào chỉ hiện giấy tờ của đơn đó", async () => {
    const k = khoi({}, "dang_chuan_bi");
    k.diem[0] = { ...k.diem[0], yeu_cau_kho_ma: "YCX-0001",
                  phieu_xuat: { ma: "PXK-0001", trang_thai: "posted", luc: "2026-09-18T00:20:00Z", boi_ten: "Phạm Văn Lộc" } } as never;
    const goi = stubApi({ khoi: [k] });
    ve({ can_read: true });
    const n = await moNgan();
    await userEvent.click(within(n).getByRole("tab", { name: "Chứng từ" }));
    const ray = within(n).getByRole("navigation", { name: "Đơn trong lượt" });
    expect(within(ray).getAllByRole("button", { pressed: false }).length
      + within(ray).getAllByRole("button", { pressed: true }).length).toBe(2);
    // Mã yêu cầu giao nằm ở thẻ đơn cột trái, bấm mở yêu cầu (13/10/2026).
    expect(within(ray).getByRole("button", { name: "YCGH-260918-AAAA" })).toBeInTheDocument();
    expect(within(ray).getByRole("button", { name: "YCGH-260918-BBBB" })).toBeInTheDocument();
    const giay = within(n).getByRole("list", { name: "Giấy tờ của đơn" });
    expect(within(giay).queryByText(/YCGH-/)).toBeNull();
    // PXK một số: thẻ phiếu ở dòng đề nghị + số của phiếu xuất kho bán hàng.
    expect(within(giay).getAllByText("PXK-0001")).toHaveLength(2);
    expect(within(giay).getByText("Phiếu xuất kho bán hàng")).toBeInTheDocument();
    expect(within(giay).getByText("Đã xuất kho")).toBeInTheDocument();

    await userEvent.click(within(ray).getByRole("button", { name: /AOBO/ }));
    const giay2 = within(n).getByRole("list", { name: "Giấy tờ của đơn" });
    expect(within(giay2).queryByText("PXK-0001")).toBeNull();
    expect(within(giay2).getByText("Chưa gửi kho")).toBeInTheDocument();
    expect(within(giay2).getByText("Chờ kho xuất")).toBeInTheDocument();
    // Tệp đính kèm nạp theo ĐÚNG chuyến của đơn đang chọn.
    await waitFor(() => expect(goi.some((g) => g.url.includes("/trips/32/dinh-kem"))).toBe(true));
  });

  it("⭐ nhà gia công giao thẳng: không xe, không tài xế, không km — nói nhà gia công và lệnh nguồn", async () => {
    const gt = {
      ...CHUYEN, id: 40, request_id: 7, request_code: "YCGH-261006-SICU", trang_thai: "thanh_cong",
      employee_name: "Nguyễn Thị Minh Phương", tong_km: 0, yeu_cau_kho_ma: null,
      // Khách nhận 04/10 theo biên bản, chốt trên hệ thống 06/10; hạn trên đơn 30/10.
      thoi_gian_ket_thuc: "2026-10-04T05:00:00Z", created_at: "2026-10-06T05:46:00Z",
      ngay_can_giao: "2026-10-30", dia_chi: "Số 18 Đại lộ Độc Lập, KCN VSIP 1, Phường Thuận An, TP Hồ Chí Minh",
      lines: [{ order_line_id: 11, qty_giao: 5000 }],
      giao_thang: { gia_cong_ngoai_id: 3, nha_cung_cap_ten: "Cơ sở Gia công Cán màng Thành Công",
                    nha_cung_cap_sdt: "0910726420", lsx_id: 2, lsx_ma: "LSX26-0002" },
    };
    stubApi({ trips: [gt] });
    ve({ can_read: true });
    const d = await screen.findByRole("row", { name: "Giao thẳng YCGH-261006-SICU" });
    expect(within(d).getByText("Nhà gia công")).toBeInTheDocument();
    expect(within(d).getByText("Cơ sở Gia công Cán màng Thành Công")).toBeInTheDocument();
    // Người chốt KHÔNG phải tài xế — dòng không ghi tên họ như kíp xe.
    expect(within(d).queryByText("Nguyễn Thị Minh Phương")).toBeNull();
    expect(within(d).queryByText(/Lấy hàng/)).toBeNull();
    expect(within(d).getByText("Khách nhận 04/10")).toBeInTheDocument();
    expect(within(d).getByText("30/10")).toBeInTheDocument();
    expect(within(d).getByText("Trước hẹn 26 ngày")).toBeInTheDocument();
    await userEvent.click(within(d).getByText("Giao thẳng"));
    const n = await screen.findByRole("dialog", { name: "YCGH-261006-SICU" });
    expect(within(n).getByText("LSX26-0002")).toBeInTheDocument();
    expect(within(n).getByText("Ghi nhận")).toBeInTheDocument();
    // Ngày khách nhận (kế toán ghi hoá đơn theo ngày này) tách khỏi lúc bấm chốt.
    expect(within(n).getByText("Khách nhận")).toBeInTheDocument();
    expect(within(n).getByText("04/10/2026")).toBeInTheDocument();
    expect(within(n).getByText("12:46 06/10")).toBeInTheDocument();
    expect(within(n).queryByText("Xe")).toBeNull();
    await userEvent.click(within(n).getByRole("tab", { name: "Chứng từ" }));
    expect(within(n).getByText("Không qua kho")).toBeInTheDocument();
  });

  it("⭐ KHÔNG có nút lẻ gửi kho / lấy hàng / bắt đầu giao ở từng điểm của lượt", async () => {
    // Hai chỗ bấm cho cùng một việc là chỗ rối nhất của bản trước (bấm thử 18/09/2026).
    stubApi({ khoi: [khoi({ so_cho_lay_hang: 1, so_cho_bat_dau: 1 }, "dang_chuan_bi")] });
    veDon({ can_plan: true, can_create: true });
    const n = await moNgan();
    for (const a of within(n).getAllByRole("article"))
      for (const ten of [/Gửi yêu cầu xuất kho/, /Đã lấy hàng/, /Bắt đầu giao/])
        expect(within(a).queryByRole("button", { name: ten })).toBeNull();
    // …mà chỉ còn nút CẢ LƯỢT ở đầu ngăn; lượt lệch nhịp (một điểm kho chưa xuất) vẫn bắt đầu giao
    // được điểm đã xuất.
    expect(within(n).queryByRole("button", { name: /Đã lấy hàng/ })).toBeNull();
    expect(within(n).getByRole("button", { name: "Bắt đầu giao (1 điểm)" })).toBeInTheDocument();
  });

  it("⭐ kho mới xuất MỘT điểm ⇒ lượt nói \"Kho đã xuất 1/2\", không phải Đã lấy hàng", async () => {
    // Lỗi thật 12/10/2026: lấy 1/3 điểm mà cả lượt ghi "Đã lấy hàng", ngoài bảng lẫn đầu ngăn.
    const k = khoi({ so_cho_lay_hang: 1, so_cho_bat_dau: 1 });
    k.diem = [{ ...k.diem[0], trang_thai: "da_lay_hang" }, k.diem[1]] as never;
    stubApi({ khoi: [k] });
    veDon({ can_plan: true, can_create: true });
    const d = await dong();
    expect(within(d).getByText("Kho đã xuất 1/2")).toBeInTheDocument();
    expect(within(d).queryByText("Đã lấy hàng")).toBeNull();
    const n = await moNgan();
    expect(within(n).getAllByText("Kho đã xuất 1/2").length).toBeGreaterThan(0);
  });

  it("⭐ kho lập phiếu đủ mọi điểm ⇒ lượt nói \"Kho đã chuẩn bị xong\", vẫn không có nút lấy hàng", async () => {
    const k = khoi({ so_cho_lay_hang: 2 });
    k.diem = k.diem.map((t) => ({ ...t, kho_da_lap_phieu: true })) as never;
    stubApi({ khoi: [k] });
    veDon({ can_plan: true, can_create: true });
    const d = await dong();
    expect(within(d).getByText("Kho đã chuẩn bị xong")).toBeInTheDocument();
    expect(within(d).queryByRole("button")).toBeNull();
  });

  it("⭐ Bắt đầu giao: có số cuối của xe ⇒ số đứng SẴN, một cú bấm là xong", async () => {
    const goi = stubApi({
      khoi: [khoi({ so_cho_bat_dau: 2 }, "da_lay_hang")],
      rieng: (u) => (u.endsWith("/luot-xe/4/bat-dau-giao")
        ? { so_chuyen: 2, phieu: [], canh_bao: [] } : undefined),
    });
    ve({ can_create: true });
    await userEvent.click(within(await dong()).getByRole("button", { name: "Bắt đầu giao (2 điểm)" }));
    // Bấm ở dòng chỉ MỞ hộp — chưa gửi gì.
    expect(goi.some((g) => g.url.includes("/bat-dau-giao"))).toBe(false);
    const h = await screen.findByRole("dialog", { name: "Bắt đầu giao lượt LX-260918-AB12" });
    expect(within(h).getByText("12.000")).toBeInTheDocument();
    // Số đứng sẵn là CHỮ — không có ô điền sẵn để tài xế gõ nối vào (lỗi E2E 27/09/2026).
    expect(within(h).queryByRole("textbox")).toBeNull();
    await userEvent.click(within(h).getByRole("button", { name: "Bắt đầu giao" }));
    await waitFor(() =>
      expect(goi.some((g) => g.url.endsWith("/luot-xe/4/bat-dau-giao"))).toBe(true));
    expect(goi.filter((g) => g.url.includes("/bat-dau-giao"))).toHaveLength(1);   // MỘT lệnh
    expect(goi.find((g) => g.url.endsWith("/luot-xe/4/bat-dau-giao"))!.body)
      .toEqual({ so_dong_ho_xuat_phat: 12000, xac_nhan_km_lon: false });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Bắt đầu giao lượt/ })).toBeNull());
  });

  it("⭐ đồng hồ chỉ số khác ⇒ mở ô TRỐNG gõ lại cả số; số lùi phải tích xác nhận", async () => {
    const goi = stubApi({
      khoi: [khoi({ so_cho_bat_dau: 2 }, "da_lay_hang")],
      rieng: (u) => (u.endsWith("/luot-xe/4/bat-dau-giao")
        ? { so_chuyen: 2, phieu: [], canh_bao: [] } : undefined),
    });
    ve({ can_create: true });
    await userEvent.click(within(await dong()).getByRole("button", { name: "Bắt đầu giao (2 điểm)" }));
    const h = await screen.findByRole("dialog", { name: "Bắt đầu giao lượt LX-260918-AB12" });
    await userEvent.click(within(h).getByRole("button", { name: "Đồng hồ chỉ số khác" }));
    const o = within(h).getByLabelText(/Số trên đồng hồ xe lúc rời kho/);
    expect(o).toHaveValue("");
    await userEvent.type(o, "11990");
    const nut = within(h).getByRole("button", { name: "Bắt đầu giao" });
    expect(nut).toBeDisabled();
    await userEvent.click(within(h).getByRole("checkbox", { name: /số 11.990 là đúng/ }));
    expect(nut).toBeEnabled();
    await userEvent.clear(o);
    await userEvent.type(o, "12030");
    expect(o).toHaveValue("12.030");
    expect(within(h).getByText(/chạy thêm 30 km/)).toBeInTheDocument();
    expect(within(h).queryByRole("checkbox")).toBeNull();
    await userEvent.click(nut);
    await waitFor(() =>
      expect(goi.some((g) => g.url.endsWith("/luot-xe/4/bat-dau-giao"))).toBe(true));
    expect(goi.find((g) => g.url.endsWith("/luot-xe/4/bat-dau-giao"))!.body)
      .toEqual({ so_dong_ho_xuat_phat: 12030, xac_nhan_km_lon: false });
  });

  it("lượt đầu tiên của xe (sổ chưa có số) ⇒ phải gõ", async () => {
    stubApi({ khoi: [khoi({ so_cho_bat_dau: 2, goi_y_xuat_phat: null }, "da_lay_hang",
      { goi_y_xuat_phat: null })] });
    ve({ can_create: true });
    await userEvent.click(within(await dong()).getByRole("button", { name: "Bắt đầu giao (2 điểm)" }));
    const h = await screen.findByRole("dialog", { name: "Bắt đầu giao lượt LX-260918-AB12" });
    expect(within(h).getByLabelText(/Số trên đồng hồ xe lúc rời kho/)).toHaveValue("");
    expect(within(h).getByRole("button", { name: "Bắt đầu giao" })).toBeDisabled();
    expect(within(h).queryByRole("button", { name: /Dùng số cuối/ })).toBeNull();
  });

  it("cảnh báo của máy chủ sau khi rời kho ⇒ nằm lại trên ngăn cho người bấm đọc", async () => {
    const canh = "Còn 1 chuyến của lượt kho chưa xuất hàng — chưa bắt đầu giao.";
    stubApi({
      khoi: [khoi({ so_cho_bat_dau: 2 }, "da_lay_hang")],
      rieng: (u) => (u.endsWith("/luot-xe/4/bat-dau-giao")
        ? { so_chuyen: 2, phieu: [], canh_bao: [canh] } : undefined),
    });
    ve({ can_create: true });
    await userEvent.click(within(await dong()).getByRole("button", { name: "Bắt đầu giao (2 điểm)" }));
    const h = await screen.findByRole("dialog", { name: "Bắt đầu giao lượt LX-260918-AB12" });
    await userEvent.click(within(h).getByRole("button", { name: "Bắt đầu giao" }));
    const n = await screen.findByRole("dialog", { name: "LX-260918-AB12" });
    expect(await within(n).findByText(canh)).toBeInTheDocument();
  });

  it("đã có số xuất phát (xe đi dở, bốc thêm điểm) ⇒ bấm thẳng, không hỏi lại số", async () => {
    const goi = stubApi({
      khoi: [khoi({ so_cho_bat_dau: 1, so_dong_ho_xuat_phat: 12000 }, "da_lay_hang")],
      rieng: (u) => (u.endsWith("/luot-xe/4/bat-dau-giao")
        ? { so_chuyen: 1, phieu: [], canh_bao: [] } : undefined),
    });
    ve({ can_create: true });
    await userEvent.click(within(await dong()).getByRole("button", { name: "Bắt đầu giao (1 điểm)" }));
    await waitFor(() =>
      expect(goi.some((g) => g.url.endsWith("/luot-xe/4/bat-dau-giao"))).toBe(true));
    expect(goi.find((g) => g.url.endsWith("/luot-xe/4/bat-dau-giao"))!.body).toBeNull();
    expect(screen.queryByLabelText(/Số đồng hồ lúc xuất phát/)).toBeNull();
  });

  const dangGiao = () => khoi(
    { so_dang_giao: 2, so_dong_ho_xuat_phat: 12000, so_dong_ho_gan_nhat: 12000,
      goi_y_xuat_phat: null },
    "dang_giao",
    { so_dong_ho_xuat_phat: 12000, so_dong_ho_gan_nhat: 12000, goi_y_xuat_phat: null },
  );
  const moKetQuaDiemDau = async () => {
    const n = await moNgan();
    await userEvent.click(within(n).getAllByRole("button", { name: "Nhập kết quả" })[0]);
  };

  it("⭐ đang giao ⇒ dòng chỉ đường \"Nhập kết quả\" vào ngăn, mỗi điểm một nút; ô SỐ ĐỒNG HỒ thay ô km", async () => {
    const goi = stubApi({ khoi: [dangGiao()] });
    ve({ can_create: true });
    // Nút trên dòng MỞ ngăn (việc nhập là của từng điểm, không phải của cả lượt).
    await userEvent.click(within(await dong()).getByRole("button", { name: "Nhập kết quả (2 điểm)" }));
    const n = await screen.findByRole("dialog", { name: "LX-260918-AB12" });
    // Câu "Tới khách nào thì bấm Nhập kết quả…" đã gỡ 13/10/2026: nút nằm ngay trên thẻ điểm đang chọn.
    // Chỉ thẻ của ô đang chọn có nút — chọn ô nào nhập cho điểm đó.
    const lt = within(n).getByRole("list", { name: "Lộ trình" });
    expect(within(n).getAllByRole("button", { name: "Nhập kết quả" })).toHaveLength(1);
    await userEvent.click(within(lt).getByRole("button", { name: "Điểm 2 AOBO" }));
    expect(within(within(n).getByRole("article", { name: "Điểm 2 AOBO" }))
      .getByRole("button", { name: "Nhập kết quả" })).toBeInTheDocument();
    await userEvent.click(within(lt).getByRole("button", { name: "Điểm 1 Young Poong" }));
    await userEvent.click(within(n).getByRole("button", { name: "Nhập kết quả" }));
    const o = await screen.findByLabelText(/Số đồng hồ lúc tới khách/);
    expect(screen.queryByLabelText(/Số km thực tế/)).toBeNull();
    // Xe là xe CỦA LƯỢT — không bày ô đổi xe riêng một chuyến.
    expect(screen.queryByLabelText(/Xe đã chạy chuyến/)).toBeNull();
    // Điểm 1 ⇒ số trước là số rời kho, đứng sẵn cạnh nhãn.
    expect(screen.getByText("12.000 km")).toBeInTheDocument();
    await userEvent.type(o, "12021");
    expect(screen.getByText("21 km")).toBeInTheDocument();
    // Người nhận lấy sẵn từ yêu cầu giao — không phải gõ.
    expect(within(screen.getByRole("dialog", { name: /^Tới / })).getByText("Nguyễn Thanh Vy"))
      .toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Lưu kết quả/ }));
    await waitFor(() => expect(goi.some((g) => g.url.includes("/trips/31/ket-qua"))).toBe(true));
    const body = goi.find((g) => g.url.includes("/ket-qua"))!.body as Record<string, unknown>;
    expect(body.so_dong_ho).toBe(12021);
    expect(body.nguoi_nhan_thuc_te).toBe("Nguyễn Thanh Vy");
    expect("km" in body).toBe(false);
    expect("vehicle_id" in body).toBe(false);
  });

  it("chặng > 500 km KHÔNG còn hỏi xác nhận (gỡ ngưỡng 13/10/2026)", async () => {
    stubApi({ khoi: [dangGiao()] });
    ve({ can_create: true });
    await moKetQuaDiemDau();
    await userEvent.type(await screen.findByLabelText(/Số đồng hồ lúc tới khách/), "12600");
    expect(screen.getByText("600 km")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Xác nhận/ })).toBeNull();
  });

  it("gõ dở số đồng hồ KHÔNG báo thấp; đủ chữ số mà thấp hơn số trước ⇒ chặn", async () => {
    // Bấm thử 18/09/2026: gõ "9757" (đang tới 97570) đã hiện cảnh báo đỏ, doạ người gõ đúng.
    stubApi({ khoi: [dangGiao()] });
    ve({ can_create: true });
    await moKetQuaDiemDau();
    const o = await screen.findByLabelText(/Số đồng hồ lúc tới khách/);
    await userEvent.type(o, "1200");
    expect(screen.queryByText(/Thấp nhất là/)).toBeNull();
    await userEvent.type(o, "0");            // 12000 → bằng, vẫn không báo
    expect(screen.queryByText(/Thấp nhất là/)).toBeNull();
    await userEvent.clear(o);
    await userEvent.type(o, "11990");        // đủ chữ số và nhỏ hơn thật ⇒ báo
    expect(screen.getByText(/Thấp nhất là 12.000 km/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lưu kết quả/ })).toBeDisabled();
  });

  it("hộp Nhập kết quả KHÔNG báo \"hết hàng\" trong lúc còn đang tải", async () => {
    // Bấm thử 18/09/2026: hộp vừa mở đã ghi "Không còn hàng nào để giao" rồi mới hiện hàng.
    stubApi({ khoi: [dangGiao()] });
    ve({ can_create: true });
    await moKetQuaDiemDau();
    expect(screen.queryByText("Không còn hàng nào để giao.")).toBeNull();
    const h = await screen.findByRole("dialog", { name: /^Tới / });
    expect(await within(h).findByText(/Hộp thuốc/)).toBeInTheDocument();
  });

  it("⭐ mọi điểm xong ⇒ nút Về kho ngay trên dòng, gửi số đồng hồ vào ĐÚNG lượt", async () => {
    const goi = stubApi({
      khoi: [khoi({ cho_ve_kho: true, so_dong_ho_xuat_phat: 12000, so_dong_ho_gan_nhat: 12028 },
                  "thanh_cong", { so_dong_ho: 12028 })],
      rieng: (u) => (u.endsWith("/luot-xe/4/ve-kho")
        ? { id: 4, code: "LX-260918-AB12", so_dong_ho_ve_kho: 12045, km_ve_kho: 17,
            ve_kho_luc: "2026-09-18T09:00:00Z", canh_bao: [] }
        : undefined),
    });
    ve({ can_create: true });
    await userEvent.click(within(await dong()).getByRole("button", { name: "Về kho" }));
    const h = await screen.findByRole("dialog", { name: "Về kho lượt LX-260918-AB12" });
    const o = within(h).getByLabelText(/Số trên đồng hồ xe lúc về tới kho/);
    const nut = within(h).getByRole("button", { name: "Lưu về kho" });
    // Nhỏ hơn số ở điểm giao cuối ⇒ báo ngay, khoá nút (máy chủ chặn cứng, đồng hồ không chạy lùi).
    await userEvent.type(o, "12020");
    expect(within(h).getByRole("alert")).toHaveTextContent(/Nhỏ hơn số ở điểm giao cuối \(12.028 km\)/);
    expect(nut).toBeDisabled();
    await userEvent.clear(o);
    await userEvent.type(o, "12045");
    expect(o).toHaveValue("12.045");
    expect(within(h).getByText(/Chặng về kho 17 km/)).toBeInTheDocument();
    await userEvent.click(nut);
    await waitFor(() => expect(goi.some((g) => g.url.endsWith("/luot-xe/4/ve-kho"))).toBe(true));
    expect(goi.find((g) => g.url.endsWith("/ve-kho"))!.body)
      .toEqual({ so_dong_ho: 12045 });
    const n = await screen.findByRole("dialog", { name: "LX-260918-AB12" });
    expect(await within(n).findByText(/chặng về kho 17 km/)).toBeInTheDocument();
  });

  it("còn điểm đang giao ⇒ KHÔNG có nút Về kho", async () => {
    stubApi({ khoi: [dangGiao()] });
    ve({ can_create: true });
    expect(within(await dong()).queryByRole("button", { name: "Về kho" })).toBeNull();
    const n = await moNgan();
    expect(within(n).queryByRole("button", { name: "Về kho" })).toBeNull();
  });

  it("đã về kho ⇒ dòng ghi Đã về kho + tổng km, ngăn có mốc Về kho với km chặng về", async () => {
    stubApi({
      khoi: [khoi({ ve_kho_luc: "2026-09-18T09:00:00Z", so_dong_ho_xuat_phat: 12000,
                    so_dong_ho_ve_kho: 12045, km_ve_kho: 17, tong_km: 45 }, "thanh_cong")],
    });
    ve({ can_create: true });
    const d = await dong();
    expect(within(d).getByText("Đã về kho")).toBeInTheDocument();
    expect(within(d).getByText("45")).toBeInTheDocument();
    // Không còn việc gì cho cả lượt ⇒ dòng không có nút nào.
    expect(within(d).queryAllByRole("button")).toHaveLength(0);
    const n = await moNgan();
    // Dải ghi km chặng về giữa điểm cuối và ô Về kho; thẻ Về kho nói đủ lúc về, đồng hồ, chặng.
    const lt = within(n).getByRole("list", { name: "Lộ trình" });
    expect(within(lt).getByText("17 km")).toBeInTheDocument();
    await userEvent.click(within(lt).getByRole("button", { name: "Mốc về kho" }));
    const theVe = within(n).getByRole("article", { name: "Về kho" });
    expect(within(theVe).getByText("12.045")).toBeInTheDocument();
    expect(within(theVe).getByText("17 km")).toBeInTheDocument();
    expect(within(n).queryByRole("button", { name: /Về kho|Bắt đầu|lấy hàng/ })).toBeNull();
  });
});

describe("Giao hàng · GOM NHIỀU YÊU CẦU chạy MỘT lượt (chủ chốt 18/09/2026)", () => {
  // "Gom nhiều phiếu lại chạy 1 lượt" — MỖI yêu cầu vẫn một đơn giao hàng + một phiếu xuất kho;
  // lượt chỉ gom đường đi.
  const XE = { id: 3, ma: "51D-853.66", ten: "Xe tải 3.5T", tai_trong: 3.5, active: true };
  const yc = (id: number, code: string, khach: string) => ({
    id, code, order_id: id, order_code: `DH-${id}`, customer_name: khach,
    ngay_can_giao: "2026-09-19", dia_chi: "Lô C3", trang_thai: "cho_len_ke_hoach", lines: [],
    so_lan_giao: 0, trang_thai_lsx: [], created_at: "2026-09-18T01:00:00Z",
  });
  const A = yc(21, "YCGH-260918-AAAA", "Young Poong");
  const B = yc(22, "YCGH-260918-BBBB", "AOBO");
  const KHOI_MOI = {
    id: 4, code: "LX-260918-AB12", ngay: "2026-09-19", vehicle_id: 3, xe_bien_so: "51D-853.66",
    xe_ten: "Xe tải 3.5T", so_dong_ho_xuat_phat: null, so_dong_ho_ve_kho: null, ve_kho_luc: null,
    km_ve_kho: null, goi_y_xuat_phat: null, so_dong_ho_gan_nhat: null, cho_ve_kho: false,
    tong_km: 0, so_cho_lay_hang: 2, so_cho_bat_dau: 0, so_dang_giao: 0,
    diem: [
      { ...CHUYEN, id: 31, request_id: 21, request_code: A.code, customer_name: "Young Poong",
        trang_thai: "dang_chuan_bi", yeu_cau_kho_ma: "DNX0101" },
      { ...CHUYEN, id: 32, request_id: 22, request_code: B.code, customer_name: "AOBO",
        trang_thai: "dang_chuan_bi", yeu_cau_kho_ma: "DNX0102" },
    ],
  };

  it("⭐ tick hai yêu cầu ⇒ \"Lên lượt xe (2)\" ⇒ MỘT lần gửi cả hai, rồi khối lượt nổi lên", async () => {
    const goi = stubApi({
      requests: [A, B], xe: [XE], khoi: [KHOI_MOI],
      rieng: (u) => (u.endsWith("/giao-hang/luot-xe")
        ? { luot_id: 4, code: "LX-260918-AB12", trips: [{ ...CHUYEN, id: 31 }, { ...CHUYEN, id: 32 }],
            canh_bao: [], phieu: ["DNX0101", "DNX0102"] }
        : undefined),
      deNghi: [31, 32].map((t, i) => ({
        id: 100 + i, ma: `DNX010${i + 1}`, trip_id: t, request_code: [A.code, B.code][i],
        customer_name: ["Young Poong", "AOBO"][i], order_code: `DH-${21 + i}`, ngay_can_giao: "2099-09-19",
        ngay_can: "2099-09-19", can_luc: null, ghi_chu: null, kho_ten: "Kho thành phẩm", sua_duoc: true,
        hang: [{ ten: "Tờ rơi", ma: null, so_luong: 100, dvt: "tờ" }],
      })),
    });
    ve({ can_plan: true, can_read: true, can_create: true });
    await userEvent.click(await screen.findByRole("tab", { name: /Yêu cầu giao/ }));
    await screen.findByRole("checkbox", { name: `Chọn ${A.code}` });
    // Chưa tick gì thì KHÔNG có thanh lên lượt — thanh nổi ở đáy màn, hiện/ẩn không đẩy bảng.
    expect(screen.queryByRole("button", { name: /Lên lượt xe/ })).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: `Chọn ${A.code}` }));
    expect(screen.getByRole("region", { name: "Yêu cầu đã chọn" })).toHaveTextContent("Đã chọn 1 yêu cầu");
    await userEvent.click(screen.getByRole("checkbox", { name: `Chọn ${B.code}` }));
    await userEvent.click(screen.getByRole("button", { name: "Lên lượt xe (2)" }));

    const hop = await screen.findByRole("dialog");
    expect(within(hop).getByRole("heading", { name: "Lên lượt xe" })).toBeInTheDocument();
    expect(within(hop).getByText("2 yêu cầu")).toBeInTheDocument();
    await userEvent.click(within(hop).getByRole("button", { name: "Tài xế: Trần Văn Hùng" }));
    await userEvent.click(await within(hop).findByRole("radio", { name: /51D-853\.66/ }));
    await userEvent.click(within(hop).getByRole("button", { name: "Lên lượt xe cho 2 đơn" }));

    await waitFor(() => expect(goi.some((g) => g.url.endsWith("/giao-hang/luot-xe"))).toBe(true));
    const body = goi.find((g) => g.url.endsWith("/giao-hang/luot-xe"))!.body as Record<string, unknown>;
    expect(body.request_ids).toEqual([21, 22]);
    expect(body).toMatchObject({ employee_id: 5, vehicle_id: 3, luot_xe_id: "moi" });
    // Không gọi `/plans` lẻ từng yêu cầu.
    expect(goi.some((g) => g.url.endsWith("/plans"))).toBe(false);
    // Sang bước hẹn kho: HAI đề nghị, một ô Cần lúc chung, ghi chú riêng từng dòng.
    const buoc = await screen.findByRole("dialog");
    expect(await within(buoc).findByText("2 đề nghị", { selector: ".gh-the" })).toBeInTheDocument();
    expect(within(buoc).getByText("chung cho cả lượt")).toBeInTheDocument();
    await userEvent.type(within(buoc).getByRole("textbox", { name: "Ghi chú cho kho DNX0102" }), "Cổng sau");
    await userEvent.click(within(buoc).getByRole("button", { name: "Mai" }));
    await userEvent.click(within(buoc).getByRole("button", { name: "Lưu cho kho" }));
    await waitFor(() => expect(goi.some((g) => g.url.endsWith("/de-nghi-kho") && g.body)).toBe(true));
    const hen = goi.find((g) => g.url.endsWith("/de-nghi-kho") && g.body)!.body as Record<string, unknown>;
    expect(hen.gio_can).toBeNull();
    expect(hen.dong).toEqual([{ trip_id: 31, ghi_chu: null }, { trip_id: 32, ghi_chu: "Cổng sau" }]);
    // Về tab Đơn giao hàng, dòng lượt vừa lập NỔI lên — lên lượt là đã gửi kho, khỏi bấm gì thêm.
    const k = await screen.findByRole("row", { name: "Lượt LX-260918-AB12" });
    expect(k).toHaveClass("is-moi");
    expect(within(k).getByText("Chờ kho xuất")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Đã lên đơn và gửi kho 2 đề nghị xuất DNX0101, DNX0102");
    expect(screen.getByRole("tab", { name: /Đơn giao hàng/ })).toHaveAttribute("aria-selected", "true");
  });

  it("lên lượt mà chưa chọn xe ⇒ nút lưu mờ (lượt là vòng chạy của MỘT chiếc xe)", async () => {
    stubApi({ requests: [A, B], xe: [] });
    ve({ can_plan: true, can_read: true });
    await userEvent.click(await screen.findByRole("tab", { name: /Yêu cầu giao/ }));
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Chọn tất cả yêu cầu trên trang" }));
    await userEvent.click(screen.getByRole("button", { name: "Lên lượt xe (2)" }));
    const hop = await screen.findByRole("dialog");
    await userEvent.click(await within(hop).findByRole("button", { name: "Tài xế: Trần Văn Hùng" }));
    expect(within(hop).getByRole("button", { name: "Lên lượt xe cho 2 đơn" })).toBeDisabled();
    expect(within(hop).getByText(/lượt là vòng chạy của một chiếc xe/)).toBeInTheDocument();
  });
});

describe("Giao hàng · ngăn YÊU CẦU GIAO phương án A (07/10/2026)", () => {
  const CHO = {
    ...YEU_CAU, trang_thai: "cho_len_ke_hoach", ghi_chu: "Gọi trước 30 phút",
    lines: [{ id: 1, order_line_id: 11, qty: 4000, mo_ta: "Tờ rơi A4 4/4", don_vi_tinh: "tờ", da_giao: 0 }],
  };
  const traChiTiet = (url: string) =>
    /\/requests\/7(\/huy)?$/.test(url) ? { request: CHO, trips: [], lich_su: [] } : undefined;

  async function moYeuCau() {
    await userEvent.click(await screen.findByRole("tab", { name: /Yêu cầu giao/ }));
    await userEvent.click(await screen.findByRole("button", { name: CHO.code }));
    return screen.findByRole("dialog", { name: CHO.code });
  }

  it("⭐ vỏ ngăn chung: tóm tắt, Giao tới nhãn trái, không thẻ rỗng, lịch sử có mốc gửi yêu cầu", async () => {
    stubApi({ requests: [CHO], rieng: traChiTiet });
    ve({ can_plan: true });
    const n = await moYeuCau();
    expect(within(n).getByText("Chờ lên đơn")).toBeInTheDocument();
    expect(within(n).getByText("Dược phẩm Sao Mai")).toBeInTheDocument();
    expect(within(n).getByRole("link", { name: "0938 765 432" })).toHaveAttribute("href", "tel:0938765432");
    expect(within(n).getByText("Gọi trước 30 phút")).toBeInTheDocument();
    expect(within(n).getByText("Tờ rơi A4 4/4")).toBeInTheDocument();
    // Chưa có chuyến ⇒ không dựng nhóm Chuyến giao rỗng.
    expect(within(n).queryByText("Chuyến giao")).toBeNull();
    expect(within(n).queryByText(/Chưa lên kế hoạch/)).toBeNull();
    await userEvent.click(within(n).getByRole("tab", { name: "Lịch sử" }));
    expect(within(n).getByText("Gửi yêu cầu giao")).toBeInTheDocument();
  });

  it("⭐ nút Lên đơn giao ở đầu ngăn mở ngăn Lên đơn của đúng yêu cầu", async () => {
    stubApi({ requests: [CHO], rieng: traChiTiet });
    ve({ can_plan: true });
    const n = await moYeuCau();
    await userEvent.click(within(n).getByRole("button", { name: "Lên đơn giao" }));
    const hop = await screen.findByRole("dialog", { name: /Lên đơn giao hàng/ });
    expect(within(hop).getByText(CHO.code)).toBeInTheDocument();
  });

  it("⭐ Huỷ yêu cầu: bấm mới mở ô lý do, lý do rỗng thì khoá, gửi đúng lý do", async () => {
    const goi = stubApi({ requests: [CHO], rieng: traChiTiet });
    ve({ can_plan: true, can_cancel: true });
    const n = await moYeuCau();
    expect(within(n).queryByLabelText("Lý do huỷ")).toBeNull();
    await userEvent.click(within(n).getByRole("button", { name: "Huỷ yêu cầu" }));
    const nut = within(n).getByRole("button", { name: "Xác nhận huỷ" });
    expect(nut).toBeDisabled();
    await userEvent.type(within(n).getByLabelText("Lý do huỷ"), "Khách lùi ngày");
    await userEvent.click(nut);
    await waitFor(() => expect(goi.find((g) => g.url.endsWith("/requests/7/huy"))?.body)
      .toEqual({ ly_do: "Khách lùi ngày" }));
  });
});

describe("Giao hàng · bảng hàng của ngăn đi kèm bảng giao (07/10/2026)", () => {
  it("⭐ ngăn một đơn hiện bảng hàng từ `hang` của bảng giao — không chờ chi tiết yêu cầu", async () => {
    const gt = {
      ...CHUYEN, id: 41, request_id: 9, request_code: "YCGH-261006-SICU", trang_thai: "thanh_cong",
      employee_name: "Nguyễn Thị Minh Phương", tong_km: 0, yeu_cau_kho_ma: null,
      thoi_gian_ket_thuc: "2026-10-04T05:00:00Z", created_at: "2026-10-06T05:46:00Z",
      ngay_can_giao: "2026-10-30", dia_chi: "Số 18 Đại lộ Độc Lập", lines: [],
      giao_thang: { gia_cong_ngoai_id: 3, nha_cung_cap_ten: "Cán màng Thành Công",
                    nha_cung_cap_sdt: "0910726420", lsx_id: 2, lsx_ma: "LSX26-0002" },
      hang: [{ id: 1, order_line_id: 11, qty: 5000, mo_ta: "Hộp kem 50ml", don_vi_tinh: "cái", da_giao: 5000 }],
    };
    // Chi tiết yêu cầu trả RỖNG dòng hàng: bảng hàng vẫn phải có vì nó đi từ bảng giao.
    stubApi({ trips: [gt], rieng: (u) => (/\/requests\/9$/.test(u)
      ? { request: { ...YEU_CAU, id: 9, lines: [] }, trips: [], lich_su: [] } : undefined) });
    ve({ can_read: true });
    const d = await screen.findByRole("row", { name: "Giao thẳng YCGH-261006-SICU" });
    await userEvent.click(within(d).getByText("Giao thẳng"));
    const n = await screen.findByRole("dialog", { name: "YCGH-261006-SICU" });
    expect(within(n).getByText("Hàng giao")).toBeInTheDocument();
    expect(within(n).getByText("Hộp kem 50ml")).toBeInTheDocument();
  });
});

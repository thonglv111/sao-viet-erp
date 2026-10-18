import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SxWorkItemChiTiet } from "../api/client";
import { ThsxDrawer } from "./ThsxDrawer";
import type { ThsxExec } from "./ThsxExecPanels";
import type { SxChoCuaViec } from "./thsxChoXacNhan";
import type { ThsxDrawerTab } from "./ThsxDrawer";

// Thẻ tệp và mục Kết quả KCS tự gọi API lúc mount — ngoài phạm vi các test này.
vi.mock("./ThsxTepLenh", () => ({ ThsxTepLenh: () => null }));
vi.mock("./ThsxKetQuaKcs", () => ({ ThsxKetQuaKcs: () => <div>[kết quả KCS]</div> }));
// Tab Vật tư đọc token để mở form Kho — chỉ cần có mặt.
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ token: "t" }) }));

function chiTiet(runOrder: boolean, daNhan = false, muc?: "all" | "own"): SxWorkItemChiTiet {
  return {
    cong_viec: {
      id: 1, department_id: 7, nguon_ma: "LSX26-0001", nguon_ten: "Hộp bánh", ten_cong_doan: "Bế",
      loai_buoc: "may", nha_cung_cap: null, may_id: null, may: null,
      quy_cach: null, ghi_chu: null, trang_thai: "released",
      khuon: { ma: "KB-0004", ten: "Hộp bánh mang đi 4 ngăn", so_ke: "Kệ B2", tinh_trang: "dang_dat_lam" },
      khuon_da_nhan: daNhan, khuon_da_tra: false,
    },
    trang_thai: "released",
    version: 1,
    quyen: { run_order: runOrder },
    quyen_muc: muc ? { run_order: muc } : {},
    phan_cong: [], phien_chay: [], khoang_tham_gia: [],
    ban_giao_di: [], ban_giao_den: [], ban_giao_chang_sau: [], ho_tro: [],
    san_luong: { tong_tot: 0, da_giao: 0, batches: [], muc_tieu: null, thuc_nhan: null, con_thieu: null, don_vi: null },
  } as unknown as SxWorkItemChiTiet;
}

const cotPhai = () => screen.getByRole("complementary", { name: "Thông tin việc" });

function mo(runOrder: boolean, daNhan = false, muc?: "all" | "own") {
  const onNhanKhuon = vi.fn();
  render(
    <ThsxDrawer chiTiet={chiTiet(runOrder, daNhan, muc)} loading={false} candidates={[]} hoTroUngVien={[]}
      mayOptions={[]} exec={{} as ThsxExec} busy={false} onGiao={vi.fn()} onRut={vi.fn()}
      onBatDau={vi.fn()} onNhanKhuon={onNhanKhuon} onTraKhuon={vi.fn()} onTamDung={vi.fn()}
      onKetThuc={vi.fn()} onClose={vi.fn()} />,
  );
  return { onNhanKhuon };
}

describe("ThsxDrawer · khuôn chưa nhận", () => {
  it("có quyền Thực hiện lệnh: nút Đã nhận khuôn hiện, cảnh báo gọi đúng tên nút và mục", () => {
    const { onNhanKhuon } = mo(true);
    screen.getByRole("button", { name: "Đã nhận khuôn" }).click();
    expect(onNhanKhuon).toHaveBeenCalledTimes(1);
    // Câu vướng nằm ở cột phải (ngăn B), gọi đúng tên nút và đúng dòng có nút.
    expect(cotPhai().textContent).toContain(
      "Chưa nhận khuôn/khung KB-0004 — bấm “Đã nhận khuôn” ở dòng Khuôn bên dưới rồi mới Bắt đầu.",
    );
    expect(document.body.textContent).not.toContain("khối trên");
    expect(document.body.textContent).not.toContain("Cần quyền Thực hiện lệnh");
  });

  it("thiếu quyền: không có nút, cả khối lẫn cảnh báo nói lý do thay vì bảo đi tìm nút", () => {
    mo(false);
    expect(screen.queryByRole("button", { name: "Đã nhận khuôn" })).toBeNull();
    expect(screen.getByText("Cần quyền Thực hiện lệnh ở tổ này mới xác nhận nhận khuôn được.")).toBeTruthy();
    expect(document.body.textContent).toContain(
      "Chưa nhận khuôn/khung KB-0004 — cần quyền Thực hiện lệnh ở tổ này mới xác nhận được.",
    );
  });

  it("quyền Của tôi mà việc chưa giao: nói là chưa giao cho bạn, không bảo đi xin quyền", () => {
    mo(false, false, "own");
    expect(screen.queryByRole("button", { name: "Đã nhận khuôn" })).toBeNull();
    expect(screen.getByText(
      "Việc này chưa giao cho bạn — quyền Thực hiện lệnh của bạn ở tổ này là “Của tôi”, chỉ áp cho việc được giao.",
    )).toBeTruthy();
    expect(document.body.textContent).toContain(
      "Chưa nhận khuôn/khung KB-0004 — việc chưa giao cho bạn, mà quyền của bạn ở tổ này là “Của tôi”.",
    );
    expect(document.body.textContent).not.toContain("Cần quyền");
    expect(document.body.textContent).not.toContain("cần quyền");
  });

  it("đã nhận: không còn cảnh báo, không còn dòng thiếu quyền", () => {
    mo(false, true);
    expect(document.body.textContent).not.toContain("Chưa nhận khuôn/khung");
    expect(document.body.textContent).not.toContain("Cần quyền Thực hiện lệnh");
  });
});

// Kíp chuẩn GỠ 18/09/2026 (mg `0321`): hệ thôi biết một việc NÊN mấy người, nên không còn câu
// "số thợ khác kíp chuẩn" nào — chỉ giữ luật về NGƯỜI (≥ 1 thợ). Luật "có thợ không phải công nhật" gỡ 09/10/2026.
describe("ThsxDrawer · thợ được giao", () => {
  function moKip(soDangGiao: number, trangThai = "released", laKhoan = true) {
    const base = chiTiet(true, true);
    const phanCong = Array.from({ length: soDangGiao }, (_, i) => ({
      id: i + 1, employee_id: 100 + i, ho_ten: `Thợ ${i + 1}`, la_luong_khoan: laKhoan, trang_thai: "active",
    }));
    const ct = {
      ...base,
      cong_viec: { ...base.cong_viec, khuon: null, trang_thai: trangThai },
      trang_thai: trangThai,
      phan_cong: phanCong,
    } as unknown as SxWorkItemChiTiet;
    render(
      <ThsxDrawer chiTiet={ct} loading={false} candidates={[]} hoTroUngVien={[]}
        mayOptions={[]} exec={{} as ThsxExec} busy={false} onGiao={vi.fn()} onRut={vi.fn()}
        onBatDau={vi.fn()} onNhanKhuon={vi.fn()} onTraKhuon={vi.fn()} onTamDung={vi.fn()}
        onKetThuc={vi.fn()} onClose={vi.fn()} />,
    );
    return document.body.textContent ?? "";
  }

  it("chưa giao ai: chỉ báo cần giao thợ, không báo lệch kíp (dễ đọc nhầm là lệch giờ)", () => {
    const txt = moKip(0);
    // Ngăn B: ô vướng nói lý do (kèm nút Giao người), dòng Thợ ghi "chưa giao ai" — một ý nói một lần.
    expect(within(cotPhai()).getByText("chưa giao ai")).toBeTruthy();
    expect(txt).toContain("Cần giao ít nhất 1 thợ mới bắt đầu được.");
    expect(within(cotPhai()).getAllByRole("button", { name: /Giao người/ }).length).toBeGreaterThan(0);
    expect(txt).not.toContain("kíp chuẩn");
    expect(txt).not.toContain("Kíp lệch");
    expect(txt).not.toContain("khoán");
  });

  it("giao 1 thợ: không còn câu kíp chuẩn nào, thẻ thợ không gắn chữ khoán", () => {
    const txt = moKip(1);
    expect(txt).not.toContain("kíp chuẩn");
    expect(txt).not.toContain("chọn lý do");
    expect(txt).not.toContain("khoán");
    expect(txt).not.toContain("Cần giao ít nhất 1 thợ");
    expect(cotPhai().querySelectorAll(".thsx-b-tho__the").length).toBe(1);
  });

  it("người đang giao toàn công nhật: không gắn thẻ, KHÔNG chặn Bắt đầu", () => {
    const txt = moKip(2, "released", false);
    expect(txt).not.toContain("công nhật");
    expect(txt).not.toContain("Cần giao ít nhất 1 thợ");
    expect(txt).not.toContain("khoán");
  });

  it("tạm dừng với 3 thợ: không hỏi lý do số người", () => {
    const txt = moKip(3, "paused");
    expect(txt).not.toContain("kíp chuẩn");
    expect(txt).not.toContain("chọn lý do");
  });
});

describe("ThsxDrawer · tab KCS", () => {
  function moTab(props: { tabDau?: ThsxDrawerTab; cho?: SxChoCuaViec } = {}) {
    render(
      <ThsxDrawer chiTiet={chiTiet(true, true)} loading={false} candidates={[]} hoTroUngVien={[]}
        mayOptions={[]} exec={{} as ThsxExec} busy={false} onGiao={vi.fn()} onRut={vi.fn()}
        onBatDau={vi.fn()} onNhanKhuon={vi.fn()} onTraKhuon={vi.fn()} onTamDung={vi.fn()}
        onKetThuc={vi.fn()} onClose={vi.fn()} {...props} />,
    );
  }

  it("kết quả KCS không nằm lẫn trong tab Vận hành, bấm tab KCS mới hiện", () => {
    moTab();
    expect(screen.queryByText("[kết quả KCS]")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "KCS" }));
    expect(screen.getByText("[kết quả KCS]")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "KCS" }).getAttribute("aria-selected")).toBe("true");
  });

  it("mở từ lỗi KCS: vào thẳng tab KCS, có chấm báo lỗi chờ xem", () => {
    moTab({ tabDau: "kcs", cho: { nhan: 0, kcs: 1 } });
    expect(screen.getByText("[kết quả KCS]")).toBeTruthy();
    expect(screen.getByTitle("Có lỗi KCS chờ tổ xem")).toBeTruthy();
  });

  it("không có lỗi chờ xem: không có chấm", () => {
    moTab();
    expect(screen.queryByTitle("Có lỗi KCS chờ tổ xem")).toBeNull();
  });

  it("đổi tab thì khung cuộn về đầu, không giữ vị trí cuộn của tab cũ", () => {
    // jsdom không cuộn thật (scrollTop luôn 0, gán bị bỏ qua) — cắm tạm getter/setter để đọc được giá trị gán.
    const goc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");
    const cuon = new WeakMap<HTMLElement, number>();
    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
      configurable: true,
      get(this: HTMLElement) { return cuon.get(this) ?? 0; },
      set(this: HTMLElement, v: number) { cuon.set(this, v); },
    });
    try {
      moTab();
      const body = document.querySelector<HTMLElement>(".thsx-panel__body")!;
      body.scrollTop = 488;
      fireEvent.click(screen.getByRole("tab", { name: "KCS" }));
      expect(body.scrollTop).toBe(0);
    } finally {
      if (goc) Object.defineProperty(HTMLElement.prototype, "scrollTop", goc);
      else delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop;
    }
  });
});

describe("ThsxDrawer · tab Nhận (§11.5)", () => {
  function moNhan(props: { tabDau?: ThsxDrawerTab; cho?: SxChoCuaViec; confirm?: boolean } = {}) {
    const base = chiTiet(true, true);
    const ct = {
      ...base,
      quyen: { ...base.quyen, confirm_output: props.confirm ?? true },
      ban_giao_den: [
        { id: 5, doi_tac_cong_viec_id: 9, doi_tac_ten: "Cán màng mờ", cung_to: false, so_luong: 50,
          don_vi: "to", trang_thai: "confirmed", version: 3, batch_ids: [],
          nguoi_de_xuat: "Lê Cán Màng", de_xuat_luc: "2026-09-17T08:30:00",
          nguoi_xac_nhan: "Trần Tổ Bế", xac_nhan_luc: "2026-09-17T09:10:00",
          nguon_cong_doan: "Cán màng mờ", nguon_to: "Tổ cán phủ", dich_cong_doan: "Bế", dich_to: "Tổ bế" },
        { id: 6, doi_tac_cong_viec_id: 9, doi_tac_ten: "Cán màng mờ", cung_to: false, so_luong: 30,
          don_vi: "to", trang_thai: "proposed", version: 1, batch_ids: [],
          nguoi_de_xuat: "Lê Cán Màng", de_xuat_luc: "2026-09-17T11:00:00",
          nguoi_xac_nhan: null, xac_nhan_luc: null },
      ],
    } as unknown as SxWorkItemChiTiet;
    const xacNhanBanGiao = vi.fn();
    render(
      <ThsxDrawer chiTiet={ct} loading={false} candidates={[]} hoTroUngVien={[]}
        mayOptions={[]} exec={{ xacNhanBanGiao } as unknown as ThsxExec} busy={false} onGiao={vi.fn()} onRut={vi.fn()}
        onBatDau={vi.fn()} onNhanKhuon={vi.fn()} onTraKhuon={vi.fn()} onTamDung={vi.fn()}
        onKetThuc={vi.fn()} onClose={vi.fn()} tabDau={props.tabDau} cho={props.cho} />,
    );
    return { xacNhanBanGiao };
  }

  it("mở từ bàn giao chờ nhận: vào thẳng tab Nhận, có chấm, nút Xác nhận ngay đầu danh sách", () => {
    const { xacNhanBanGiao } = moNhan({ tabDau: "gn", cho: { nhan: 1, kcs: 0 } });
    expect(screen.getByRole("tab", { name: /Giao và nhận/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTitle("Có bàn giao chờ tổ nhận")).toBeTruthy();
    const dong = document.querySelectorAll(".thsx-x-bg");
    expect(dong).toHaveLength(2);
    // Lần chờ nhận đứng trước lần đã xác nhận.
    expect(dong[0].textContent).toContain("chờ xác nhận");
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    expect(xacNhanBanGiao).toHaveBeenCalledWith(6, 1);
  });

  it("không có việc chờ: mở ở Quy cách, không chấm; bấm tab Giao và nhận vẫn thấy lịch sử bàn giao đến", () => {
    moNhan();
    expect(screen.queryByTitle("Có bàn giao chờ tổ nhận")).toBeNull();
    expect(document.querySelectorAll(".thsx-x-bg")).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: /Giao và nhận/ }));
    expect(document.querySelectorAll(".thsx-x-bg")).toHaveLength(2);
  });

  it("mỗi dòng ghi ai giao, ai nhận, lúc nào; không còn điều chỉnh trên lần giao", () => {
    moNhan({ tabDau: "gn" });
    const [cho, daNhan] = Array.from(document.querySelectorAll<HTMLElement>(".thsx-x-bg"));
    expect(cho.textContent).toContain("Lê Cán Màng");
    expect(cho.textContent).toContain("Chưa xác nhận");

    // Một dòng bảng: công đoạn + tổ đầu kia, bên giao ai lúc nào, bên nhận ai lúc nào — tách ô, không nối bằng dấu chấm giữa.
    expect(daNhan.textContent).toMatch(/Cán màng mờTổ cán phủLê Cán Màng.*08:30/);
    expect(daNhan.textContent).toMatch(/Trần Tổ Bế.*09:10/);
    expect(daNhan.textContent).not.toContain("·");
    // Tên công đoạn đầu kia chỉ hiện MỘT lần (không nhắc lại ở đầu thẻ).
    expect(daNhan.textContent!.split("Cán màng mờ")).toHaveLength(2);
    // Điều chỉnh số trên lần giao đã gỡ (10/10/2026) — lệch số thì bên giao sửa số mẻ.
    expect(screen.queryByRole("button", { name: /Điều chỉnh/ })).toBeNull();
  });

  it("thiếu quyền Xác nhận sản lượng: không có nút, nói rõ cần quyền gì", () => {
    moNhan({ tabDau: "gn", confirm: false });
    expect(screen.queryByRole("button", { name: "Xác nhận" })).toBeNull();
    expect(screen.getByText("Xác nhận nhận hàng cần quyền Xác nhận sản lượng của tổ.")).toBeTruthy();
  });
});

// Routing lệnh (19/09/2026, `dau_vao.py`): chưa nhận hàng từ công đoạn trước thì chưa Bắt đầu được;
// tab Nhận chỉ liệt kê các lần nhận (27/09/2026).
describe("ThsxDrawer · công đoạn trước", () => {
  function moTruoc(thieu: string[], choXacNhan = 0) {
    const base = chiTiet(true, true);
    const ct = {
      ...base,
      cong_viec: { ...base.cong_viec, khuon: null },
      phan_cong: [{ id: 1, employee_id: 100, ho_ten: "Thợ 1", la_luong_khoan: true, trang_thai: "active" }],
      thieu_dau_vao: thieu,
      cong_doan_truoc: [{
        cong_viec_id: 9, ten_cong_doan: "In offset", phan_doan_so: 1, phan_doan_tong: 2, to_ten: "Tổ In",
        trang_thai: "running", ke_hoach: 1200, don_vi: "to", thuc_te: 1150, da_giao: 1000 + choXacNhan,
        da_xac_nhan: thieu.length ? 0 : 1000, cho_xac_nhan: choXacNhan, don_vi_giao: "to",
      }],
    } as unknown as SxWorkItemChiTiet;
    render(
      <ThsxDrawer chiTiet={ct} loading={false} candidates={[]} hoTroUngVien={[]}
        mayOptions={[]} exec={{} as ThsxExec} busy={false} onGiao={vi.fn()} onRut={vi.fn()}
        onBatDau={vi.fn()} onNhanKhuon={vi.fn()} onTraKhuon={vi.fn()} onTamDung={vi.fn()}
        onKetThuc={vi.fn()} onClose={vi.fn()} tabDau="gn" />,
    );
  }

  it("chưa nhận: nút Bắt đầu khoá, cột phải gọi tên công đoạn trước và chỉ tab Giao và nhận", () => {
    moTruoc(["In offset"], 1000);
    expect((screen.getByRole("button", { name: "Bắt đầu" }) as HTMLButtonElement).disabled).toBe(true);
    expect(cotPhai().textContent).toContain(
      "Chưa nhận hàng từ In offset — tổ trước giao sang và tổ mình xác nhận ở tab “Giao và nhận” rồi mới Bắt đầu được.",
    );
    // Tab Nhận CHỈ liệt kê các lần nhận — không còn khối tổng Kế hoạch/Thực tế/Giao sang/Đã nhận.
    expect(document.body.textContent).not.toMatch(/Thực tế1\.150|Giao sang|Kế hoạch1\.200/);
    expect(document.body.textContent).toContain("Chưa nhận lần nào từ công đoạn trước.");
  });

  it("bước trước cùng tổ: danh sách trống nhưng nói rõ vì sao không có lần nhận nào", () => {
    const base = chiTiet(true, true);
    const ct = {
      ...base,
      cong_viec: { ...base.cong_viec, khuon: null },
      thieu_dau_vao: [],
      ban_giao_den: [],
      cong_doan_truoc: [{ cong_viec_id: 9, ten_cong_doan: "Tề giấy", cung_to: true }],
    } as unknown as SxWorkItemChiTiet;
    render(
      <ThsxDrawer chiTiet={ct} loading={false} candidates={[]} hoTroUngVien={[]}
        mayOptions={[]} exec={{} as ThsxExec} busy={false} onGiao={vi.fn()} onRut={vi.fn()}
        onBatDau={vi.fn()} onNhanKhuon={vi.fn()} onTraKhuon={vi.fn()} onTamDung={vi.fn()}
        onKetThuc={vi.fn()} onClose={vi.fn()} tabDau="gn" />,
    );
    expect(document.body.textContent).toContain("Tề giấy cùng tổ — hàng không qua bàn giao");
  });

  it("đã nhận: Bắt đầu mở, không còn câu chưa nhận hàng", () => {
    moTruoc([]);
    expect((screen.getByRole("button", { name: "Bắt đầu" }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Chưa nhận hàng từ");
    expect(document.body.textContent).not.toContain("chờ xác nhận");
  });
});

describe("ThsxDrawer · vật tư chưa sẵn sàng", () => {
  function mo(vatTu: string | null) {
    const base = chiTiet(true, true);
    const ct = {
      ...base,
      cong_viec: { ...base.cong_viec, khuon: null },
      phan_cong: [{ id: 1, employee_id: 100, ho_ten: "Thợ 1", la_luong_khoan: true, trang_thai: "active" }],
      thieu_dau_vao: [],
      vat_tu_chua_san_sang: vatTu,
    } as unknown as SxWorkItemChiTiet;
    render(
      <ThsxDrawer chiTiet={ct} loading={false} candidates={[]} hoTroUngVien={[]}
        mayOptions={[]} exec={{} as ThsxExec} busy={false} onGiao={vi.fn()} onRut={vi.fn()}
        onBatDau={vi.fn()} onNhanKhuon={vi.fn()} onTraKhuon={vi.fn()} onTamDung={vi.fn()}
        onKetThuc={vi.fn()} onClose={vi.fn()} />,
    );
  }

  it("máy chủ báo chưa sẵn sàng: Bắt đầu khoá, cột phải nói đúng câu máy chủ", () => {
    mo("Vật tư chưa sẵn sàng: kho đang soạn. Đợi kho xuất xong mới bắt đầu được.");
    expect((screen.getByRole("button", { name: "Bắt đầu" }) as HTMLButtonElement).disabled).toBe(true);
    expect(cotPhai().textContent).toContain(
      "Vật tư chưa sẵn sàng: kho đang soạn. Đợi kho xuất xong mới bắt đầu được.",
    );
  });

  it("sẵn sàng: Bắt đầu mở, không có câu vật tư", () => {
    mo(null);
    expect((screen.getByRole("button", { name: "Bắt đầu" }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Vật tư chưa sẵn sàng");
  });
});

describe("ThsxDrawer · chân ngăn theo trạng thái", () => {
  function moTrangThai(trangThai: string) {
    const base = chiTiet(true, true);
    const ct = {
      ...base,
      cong_viec: { ...base.cong_viec, trang_thai: trangThai },
      trang_thai: trangThai,
    } as unknown as SxWorkItemChiTiet;
    render(
      <ThsxDrawer chiTiet={ct} loading={false} candidates={[]} hoTroUngVien={[]}
        mayOptions={[]} exec={{} as ThsxExec} busy={false} onGiao={vi.fn()} onRut={vi.fn()}
        onBatDau={vi.fn()} onNhanKhuon={vi.fn()} onTraKhuon={vi.fn()} onTamDung={vi.fn()}
        onKetThuc={vi.fn()} onClose={vi.fn()} />,
    );
  }

  it("việc Hoàn thành: không còn hàng nút chạy máy nào (kể cả nút mờ)", () => {
    moTrangThai("completed");
    for (const ten of ["Bắt đầu", "Tiếp tục", "Tạm dừng", "Kết thúc", "Đổi máy", "Báo sự cố", "Thêm thao tác"]) {
      expect(screen.queryByRole("button", { name: ten })).toBeNull();
    }
    expect(screen.queryByText("Chưa bắt đầu được vì")).toBeNull();
  });

  it("việc chưa làm vẫn có Bắt đầu; tạm dừng có Tiếp tục + Kết thúc; đang chạy có Tạm dừng + Kết thúc", () => {
    moTrangThai("released");
    expect(screen.getByRole("button", { name: "Bắt đầu" })).toBeTruthy();
    document.body.innerHTML = "";
    moTrangThai("paused");
    expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kết thúc" })).toBeTruthy();
    document.body.innerHTML = "";
    moTrangThai("running");
    expect(screen.getByRole("button", { name: "Tạm dừng" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kết thúc" })).toBeTruthy();
  });
});

describe("ThsxDrawer · thẻ Quy cách chạy máy", () => {
  function moQuyCach(quy_cach: Record<string, unknown>) {
    const ct = chiTiet(true, true);
    (ct.cong_viec as unknown as { quy_cach: unknown }).quy_cach = quy_cach;
    render(
      <ThsxDrawer chiTiet={ct} loading={false} candidates={[]} hoTroUngVien={[]}
        mayOptions={[]} exec={{} as ThsxExec} busy={false} onGiao={vi.fn()} onRut={vi.fn()}
        onBatDau={vi.fn()} onNhanKhuon={vi.fn()} onTraKhuon={vi.fn()} onTamDung={vi.fn()}
        onKetThuc={vi.fn()} onClose={vi.fn()} />,
    );
    return screen.getByRole("heading", { name: "Quy cách" }).closest(".thsx-b-qc") as HTMLElement;
  }
  // Ngăn B: nhãn trên, giá trị dưới, không dấu ":" — đọc giá trị ngay sau nhãn.
  const giaTri = (the: HTMLElement, nhan: string) => within(the).getByText(nhan).nextElementSibling?.textContent;

  it("khổ tờ in 0 × 0 (server bỏ khoá): ghi In thẳng khổ giấy nguyên, có khổ nguyên + cách in, mực từng mặt", () => {
    const the = moQuyCach({
      giay: "Giấy C300", kho_nguyen: "860 × 650", kho_tp: "86 × 54", cach_in: "hai_mat",
      so_mat: 2, so_mau: 4, so_kem: 4, muc_a: ["C", "M", "Y"], muc_b: ["K"],
    });
    expect(giaTri(the, "Khổ giấy nguyên")).toBe("860 × 650 mm");
    expect(giaTri(the, "Khổ tờ in")).toBe("In thẳng khổ giấy nguyên");
    expect(giaTri(the, "Cách in")).toBe("2 mặt (AB)");
    expect(the.textContent).not.toContain(":");
    // "2 mặt (AB)" đã nói số mặt — không lặp dòng Số mặt.
    expect(within(the).queryByText("Số mặt")).toBeNull();

    const muc = within(the).getByText("Mực in").closest(".khsx-kv") as HTMLElement;
    const bat = (ten: string) => within(muc).getByRole("button", { name: ten }).getAttribute("aria-pressed");
    expect(bat("Mực C Mặt A")).toBe("true");
    expect(bat("Mực K Mặt A")).toBe("false");
    expect(bat("Mực K Mặt B")).toBe("true");
    expect(bat("Mực C Mặt B")).toBe("false");
    // Chỉ để xem: chip không bấm đổi được.
    expect((within(muc).getByRole("button", { name: "Mực C Mặt A" }) as HTMLButtonElement).disabled).toBe(true);
    expect(muc.textContent).toContain("3 + 1 = 4 kẽm mỗi tay");
  });

  it("có khổ tờ in thì ghi khổ; thẻ cũ không có cách in/mực thì vẫn hiện Số mặt, không có khối mực", () => {
    const the = moQuyCach({ giay: "Giấy C300", kho_in: "790 × 545", so_mat: 1, so_mau: 4 });
    expect(giaTri(the, "Khổ tờ in")).toBe("790 × 545 mm");
    expect(giaTri(the, "Số mặt")).toBe("1");
    expect(within(the).queryByText("Mực in")).toBeNull();
  });

  it("ghi chú kỹ thuật không nằm trong thẻ quy cách mà ở mục riêng sau Kế hoạch", () => {
    const the = moQuyCach({ giay: "Giấy C300", ghi_chu_ky_thuat: "Cắt sát mép trái" });
    expect(within(the).queryByText("Cắt sát mép trái")).toBeNull();
    const muc = screen.getByRole("heading", { name: "Ghi chú kỹ thuật" }).closest("section") as HTMLElement;
    expect(within(muc).getByText("Cắt sát mép trái")).toBeTruthy();
    const keHoach = screen.getByRole("heading", { name: "Kế hoạch" });
    expect(keHoach.compareDocumentPosition(muc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("ThsxDrawer · khung ngăn B", () => {
  function moB(sua: Record<string, unknown> = {}, cv: Record<string, unknown> = {}) {
    const base = chiTiet(true, true);
    const ct = {
      ...base, ...sua,
      cong_viec: { ...base.cong_viec, khuon: null, ...cv },
    } as unknown as SxWorkItemChiTiet;
    render(
      <ThsxDrawer chiTiet={ct} loading={false} candidates={[]} hoTroUngVien={[]}
        mayOptions={[]} exec={{} as ThsxExec} busy={false} onGiao={vi.fn()} onRut={vi.fn()}
        onBatDau={vi.fn()} onNhanKhuon={vi.fn()} onTraKhuon={vi.fn()} onTamDung={vi.fn()}
        onKetThuc={vi.fn()} onClose={vi.fn()} />,
    );
  }

  it("ngăn kéo hẹp trên máy tính VẪN còn thanh kéo để nới ra lại", () => {
    // 10/10/2026: ngăn ≤640px từng bị gỡ thanh kéo ⇒ lỡ kéo hẹp là kẹt luôn.
    vi.stubGlobal("ResizeObserver", class {
      constructor(private cb: ResizeObserverCallback) {}
      observe() { this.cb([{ contentRect: { width: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
      disconnect() {}
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    try {
      moB();
      expect(screen.getByRole("tab", { name: "Tổng quan" })).toBeTruthy();   // bố cục hẹp
      expect(screen.getByRole("separator")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cửa sổ hẹp (không có thanh kéo) vẫn nghe đổi cỡ cửa sổ: nới cửa sổ thì độ rộng chung tính lại", () => {
    // Cửa sổ thu nhỏ đã kẹp ngăn về 480px ⇒ kéo vô ích, thanh kéo bị gỡ.
    vi.stubGlobal("ResizeObserver", class {
      constructor(private cb: ResizeObserverCallback) {}
      observe() { this.cb([{ contentRect: { width: 480 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
      disconnect() {}
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
    try {
      moB();
      expect(screen.queryByRole("separator")).toBeNull();
      document.documentElement.style.setProperty("--kt-ngan-w", "480px");
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
      fireEvent(window, new Event("resize"));
      expect(document.documentElement.style.getPropertyValue("--kt-ngan-w")).toBe("1048px");
      expect(screen.getByRole("separator")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("có đủ 6 tab, máy tính không có tab Tổng quan, mở sẵn tab Quy cách", () => {
    moB();
    const ten = screen.getAllByRole("tab").map((t) => t.textContent?.trim());
    expect(ten).toEqual(["Quy cách", "Sản lượng", "Giao và nhận", "Vật tư", "KCS", "Lịch sử"]);
    expect(screen.getByRole("tab", { name: "Quy cách" }).getAttribute("aria-selected")).toBe("true");
  });

  it("tab Sản lượng ghi số mẻ bằng chữ mờ, không badge", () => {
    moB({ san_luong: { tong_tot: 200, da_giao: 120, batches: [{ id: 1 }, { id: 2 }], don_vi: "to_in" } });
    expect(screen.getByRole("tab", { name: /Sản lượng/ }).textContent).toBe("Sản lượng2 lần");
  });

  it("cột phải có Hàng đang tới đâu khi có routing: câu vị trí, bước m trên N, từng bước có tổ", () => {
    const o = (thu_tu: number, ten: string, to: string, extra: Record<string, unknown> = {}) => ({
      thu_tu, step_key: `s${thu_tu}`, ten_cong_doan: ten, to_id: thu_tu, to_ten: to, la_cua_toi: false,
      la_kcs_cuoi: false, trang_thai: "released", phan_doan_tong: 1, chay_chung: false, ke_hoach: null,
      thuc_te: 0, don_vi: null, da_giao_sang_toi: null, da_nhan: null, cong_viec_id: null, ...extra,
    });
    moB({ routing: [
      o(1, "In offset", "Tổ In", { trang_thai: "completed" }),
      o(2, "Bế", "Tổ bế", { la_cua_toi: true, cong_viec_id: 1, trang_thai: "running" }),
      o(3, "Dán hộp", "Gia công Thành Công", { thue_ngoai: true }),
    ] });
    const cot = within(cotPhai());
    expect(cot.getByText("Hàng đang tới đâu")).toBeTruthy();
    expect(cot.getByText("Hàng đã tới tổ mình")).toBeTruthy();
    expect(cot.getByText("tổ mình ở bước 2 trên 3")).toBeTruthy();
    expect(cot.getByText("Dán hộp")).toBeTruthy();
    expect(cot.getByText("tổ mình")).toBeTruthy();
  });

  it("không có routing thì không có khối Hàng đang tới đâu", () => {
    moB();
    expect(within(cotPhai()).queryByText("Hàng đang tới đâu")).toBeNull();
  });

  it("đang chạy: chip trạng thái kèm giờ phiên cuối; Đổi máy và Báo sự cố nằm trong nút ⋯", () => {
    moB(
      { trang_thai: "running", phan_cong: [{ id: 1, employee_id: 100, ho_ten: "Thợ 1", trang_thai: "active" }],
        phien_chay: [{ id: 1, so_thu_tu: 1, may_id: 3, may_ten: "Máy bế", bat_dau: "2026-10-09T11:41:00",
          ket_thuc: null, loai_dong: null, ly_do_bat_dau_tre: null, ly_do: null }] },
      { loai_buoc: "may", trang_thai: "running", may: "Máy bế", may_id: 3 },
    );
    expect(screen.getByText("Đang chạy từ 11:41")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Đổi máy" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Thêm thao tác" }));
    expect((screen.getByRole("menuitem", { name: "Đổi máy" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("menuitem", { name: "Báo sự cố" })).toBeTruthy();
  });

  it("tạm dừng: cột phải ghi giờ dừng và lý do của phiên", () => {
    moB(
      { trang_thai: "paused", phan_cong: [{ id: 1, employee_id: 100, ho_ten: "Thợ 1", trang_thai: "active" }],
        phien_chay: [{ id: 1, so_thu_tu: 1, may_id: null, may_ten: null, bat_dau: "2026-10-09T11:41:00",
          ket_thuc: "2026-10-09T12:10:00", loai_dong: "tam_dung", ly_do_bat_dau_tre: null, ly_do: "Thay dao cắt" }] },
      { trang_thai: "paused" },
    );
    expect(screen.getByText("Tạm dừng từ 12:10")).toBeTruthy();
    const cot = within(cotPhai());
    expect(cot.getByText("Tạm dừng lúc 12:10")).toBeTruthy();
    expect(cot.getByText("Thay dao cắt")).toBeTruthy();
  });
});

describe("ThsxDrawer · nội dung các tab (ngăn B)", () => {
  function moTab(tab: ThsxDrawerTab, sua: Record<string, unknown> = {}, cv: Record<string, unknown> = {}) {
    const base = chiTiet(true, true);
    const ct = {
      ...base,
      quyen: { run_order: true, confirm_output: true, warehouse: true },
      vat_tu: [],
      vat_tu_cap: { doi_chieu: [], cac_de_nghi: [], de_nghi_co_the_sua_id: null, co_the_tao_bo_sung: false, du_lieu_cu: false },
      ...sua,
      cong_viec: { ...base.cong_viec, khuon: null, ...cv },
    } as unknown as SxWorkItemChiTiet;
    render(
      <ThsxDrawer chiTiet={ct} loading={false} candidates={[]} hoTroUngVien={[]}
        mayOptions={[]} exec={{} as ThsxExec} busy={false} onGiao={vi.fn()} onRut={vi.fn()}
        onBatDau={vi.fn()} onNhanKhuon={vi.fn()} onTraKhuon={vi.fn()} onTamDung={vi.fn()}
        onKetThuc={vi.fn()} onClose={vi.fn()} tabDau={tab} />,
    );
  }
  const chang = [{ cong_viec_id: 9, ten_cong_doan: "Dán hộp", to_ten: "Tổ dán", loai_buoc: "to", nha_cung_cap: null }];

  it("Quy cách: có khối Kế hoạch, không có ghi chú kỹ thuật thì nói Không có", () => {
    moTab("qc");
    expect(screen.getByRole("heading", { name: "Kế hoạch" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ghi chú kỹ thuật" })).toBeTruthy();
    expect(screen.getByText("Không có")).toBeTruthy();
  });

  it("Sản lượng: Các mẻ đã ghi + nút Ghi mẻ, Phiên chạy; số tốt không lặp lại (đã ở cột phải)", () => {
    moTab("sl", { ban_giao_chang_sau: chang });
    expect(screen.getByRole("heading", { name: "Sản lượng đã ghi" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ghi sản lượng/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Phiên chạy/ })).toBeTruthy();
    expect(screen.getByText("Chưa ghi sản lượng lần nào.")).toBeTruthy();
    expect(document.querySelector(".thsx-batch-metric-strip")).toBeNull();
  });

  it("Kết thúc khi còn hàng chưa đề xuất giao: không gọi kết thúc, sang tab Giao và nhận kèm lời nhắc", () => {
    const base = chiTiet(true, true);
    const ketThuc = vi.fn();
    const dung = (giao: number) => ({
      ...base, trang_thai: "running", quyen: { run_order: true, confirm_output: true, warehouse: true },
      vat_tu: [], vat_tu_cap: { doi_chieu: [], cac_de_nghi: [], de_nghi_co_the_sua_id: null, co_the_tao_bo_sung: false, du_lieu_cu: false },
      phan_cong: [{ id: 1, employee_id: 5, ho_ten: "Thợ", trang_thai: "active", la_luong_khoan: true }],
      ban_giao_chang_sau: chang, san_luong: { tong_tot: 340, da_giao: giao, batches: [], don_vi: "to" },
      cong_viec: { ...base.cong_viec, khuon: null, trang_thai: "running", don_vi_ra: "to" },
    } as unknown as SxWorkItemChiTiet);
    const props = {
      loading: false, candidates: [], hoTroUngVien: [], mayOptions: [], exec: {} as ThsxExec, busy: false,
      onGiao: vi.fn(), onRut: vi.fn(), onBatDau: vi.fn(), onNhanKhuon: vi.fn(), onTraKhuon: vi.fn(),
      onTamDung: vi.fn(), onKetThuc: ketThuc, onClose: vi.fn(), tabDau: "qc" as ThsxDrawerTab,
    };
    const { rerender } = render(<ThsxDrawer chiTiet={dung(0)} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Kết thúc/ }));
    expect(ketThuc).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Còn 340 .*chưa đề xuất giao sang Dán hộp\. Đề xuất giao hết rồi mới bấm Kết thúc\./);
    rerender(<ThsxDrawer chiTiet={dung(340)} {...props} />);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Kết thúc/ }));
    expect(ketThuc).toHaveBeenCalledTimes(1);
  });

  it("Sản lượng: việc chưa bắt đầu thì khoá nút Ghi sản lượng và nói lý do", () => {
    moTab("sl", { trang_thai: "released" });
    expect(screen.getByRole("button", { name: /Ghi sản lượng/ })).toBeDisabled();
    expect(screen.getByText(/Bấm Bắt đầu ở đầu ngăn rồi mới ghi sản lượng/)).toBeTruthy();
  });

  it("Sản lượng của bài ghép có câu chia mẻ sang các lệnh trong bài", () => {
    moTab("sl", {}, { nguon_loai: "bai_ghep" });
    expect(screen.getByText(/mỗi lần ghi tự chia sang các lệnh trong bài theo số con trên tờ/)).toBeTruthy();
  });

  it("Giao và nhận: Nhận vào, Giao đi (nút Đề xuất giao, bảng các lần giao), không còn Hỗ trợ chéo", () => {
    moTab("gn", { ban_giao_chang_sau: chang, san_luong: { tong_tot: 80, da_giao: 0, batches: [], don_vi: "to" } });
    for (const h of ["Nhận vào", "Giao đi"]) {
      expect(screen.getByRole("heading", { name: h })).toBeTruthy();
    }
    expect(screen.queryByRole("heading", { name: "Hỗ trợ chéo" })).toBeNull();
    expect(screen.getByText("sang Dán hộp")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Đề xuất giao" })).toBeTruthy();
    expect(screen.getByText(/còn 80 .*tốt chưa giao/)).toBeTruthy();
  });

  it("Giao và nhận ở bước cuối: không có Giao đi thật, câu chỉ sang tab KCS, không có khối Các lần giao", () => {
    moTab("gn");
    expect(screen.getByText("Bước cuối, hàng tốt đề nghị nhập kho ở tab KCS.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Đề xuất giao" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Các lần giao" })).toBeNull();
  });

  it("Vật tư: Vật tư theo kế hoạch, Đề nghị và phiếu kho, nút Yêu cầu cấp vật tư và Yêu cầu nhập kho", () => {
    moTab("vt");
    expect(screen.getByRole("heading", { name: "Vật tư theo kế hoạch" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Đề nghị và phiếu kho" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yêu cầu cấp vật tư" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yêu cầu nhập kho" })).toBeTruthy();
  });
});

describe("ThsxDrawer · Giao người ở cột phải", () => {
  const nguoi = (id: number, ten: string, extra: Record<string, unknown> = {}) => ({
    id, code: `NV${id}`, full_name: ten, la_luong_khoan: true, co_tai_khoan: true,
    ly_do_nghi: null, nghi_phep: [], dang_chay: null, viec_cho: [], ...extra,
  });

  it("chọn một người là giao luôn; người bị chặn mờ, không chọn được; Esc đóng ô chọn", () => {
    const onGiao = vi.fn();
    render(
      <ThsxDrawer chiTiet={chiTiet(true, true)} loading={false}
        candidates={[nguoi(1, "Phạm Văn Long"), nguoi(2, "Đỗ Minh Quân", { ly_do_nghi: "Nghỉ dài hạn" })]}
        hoTroUngVien={[]} mayOptions={[]} exec={{} as ThsxExec} busy={false} onGiao={onGiao} onRut={vi.fn()}
        onBatDau={vi.fn()} onNhanKhuon={vi.fn()} onTraKhuon={vi.fn()} onTamDung={vi.fn()}
        onKetThuc={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.click(within(cotPhai()).getByRole("button", { name: "+ Giao người" }));
    const pop = screen.getByRole("dialog", { name: "Chọn người để giao" });
    expect(within(pop).getByRole("button", { name: /Đỗ Minh Quân/ }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Chọn người để giao" })).toBeNull();
    fireEvent.click(within(cotPhai()).getByRole("button", { name: "+ Giao người" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Chọn người để giao" })).getByRole("button", { name: /Phạm Văn Long/ }));
    expect(onGiao).toHaveBeenCalledWith(1);
  });
});

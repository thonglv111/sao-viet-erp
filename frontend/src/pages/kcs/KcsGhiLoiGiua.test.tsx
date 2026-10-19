import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api, type SxKcsCongDoan, type SxKcsKiemKetQua, type SxKcsLenhDau } from "../../api/client";
import { KcsGhiLoiGiua, daGhiTheoTieuChi, tachMoTa } from "./KcsGhiLoiGiua";

vi.mock("../../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));

const lenh = { id: 3, ma: "LSX26-0003", ten: "Ruột sách", khach: null, nhom_id: null, nhom_ma: null, nhom_trang_thai: null } as SxKcsLenhDau;
const tieuChi = [
  { thu_tu: 0, ma: "MAU", ten: "Màu đúng mẫu" },
  { thu_tu: 1, ma: "MAU2", ten: "Màu đúng mẫu đã ký" },
  { thu_tu: 2, ma: "LEM", ten: "Không lem mực" },
];
const cd = {
  cong_viec_id: 21, ten: "Bài in", phan_doan_so: 1, phan_doan_tong: 1, to_id: 5, to_ten: "Nhóm thợ in",
  trang_thai: "running", tot: 100, hong: 0, don_vi: "con", la_kcs_cuoi: false, checklist: [], tieu_chi: tieuChi,
  so_lan_kiem: 1, tong_dat: 0, tong_loi: 30, loi_tai_cho: 30, da_yeu_cau_kho: 0, con_gui_kho: 0, yeu_cau_kho: [],
  lan_kiem: [{
    id: 9, cong_viec_id: 21, nguoi_kiem: "Nguyễn KCS", luc: "2026-10-08T14:20:00", so_dat: 0, so_loi: 30, don_vi: "con",
    ket_luan: "co_loi", ghi_chu: null, version: 1,
    checklist: [{ cong_viec_id: 21, thu_tu: 2, dat: false, so_luong: 30 }],
    loi: [{ id: 1, mo_ta: "Không lem mực: góc phải tờ", so_luong: 30, don_vi: "con", to_chiu_id: 5, da_xem_luc: null, nguoi_xem: null, anh: [] }],
  }],
  so_luong_ra: null, may: null, ghi_chu_ky_thuat: null, quy_cach: null, me: [],
} as unknown as SxKcsCongDoan;

describe("tachMoTa · daGhiTheoTieuChi", () => {
  it("tách đúng tiêu chí dài nhất trước, câu lạ là Lỗi khác", () => {
    expect(tachMoTa("Màu đúng mẫu đã ký: lệch xanh", tieuChi)).toEqual({ tc: "Màu đúng mẫu đã ký", ghi: "lệch xanh" });
    expect(tachMoTa("Màu đúng mẫu", tieuChi)).toEqual({ tc: "Màu đúng mẫu", ghi: "" });
    expect(tachMoTa("tờ bị nhăn mép", tieuChi)).toEqual({ tc: null, ghi: "tờ bị nhăn mép" });
  });
  it("cộng số đã ghi theo tiêu chí từ kết quả lần ghi", () => {
    expect([...daGhiTheoTieuChi(cd).entries()]).toEqual([[2, 30]]);
  });
});

describe("KcsGhiLoiGiua", () => {
  beforeEach(() => {
    vi.spyOn(api.sanXuat, "kcsTepNhom").mockResolvedValue([]);
    URL.createObjectURL = vi.fn(() => "blob:anh");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("tick → con trỏ vào Số lỗi; Lỗi khác bắt ghi chú; Lưu gửi thu_tu từng dòng", async () => {
    const kiem = vi.spyOn(api.sanXuat, "kiemCongDoan").mockResolvedValue({} as SxKcsKiemKetQua);
    const onSaved = vi.fn();
    render(<KcsGhiLoiGiua lenh={lenh} cd={cd} onClose={vi.fn()} onSaved={onSaved} />);

    expect(screen.getByText("trước đã ghi 30 con")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Tick ít nhất một tiêu chí không đạt");
    const luu = screen.getByRole("button", { name: "Lưu lỗi" }) as HTMLButtonElement;
    expect(luu.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("Màu đúng mẫu"));
    const oSo = screen.getByLabelText("Số lỗi Màu đúng mẫu");
    await waitFor(() => expect(document.activeElement).toBe(oSo));
    expect(screen.getByRole("status").textContent).toBe("Nhập số lỗi cho Màu đúng mẫu");
    fireEvent.change(oSo, { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Ghi chú Màu đúng mẫu"), { target: { value: "lệch xanh" } });

    // Tick dòng khác: dòng trước gọn lại thành thẻ.
    fireEvent.click(screen.getByLabelText("Lỗi khác"));
    expect(screen.queryByLabelText("Số lỗi Màu đúng mẫu")).toBeNull();
    expect(document.querySelector(".kgl-dong__tom")?.textContent).toBe("12 conlệch xanhSửa");
    fireEvent.change(screen.getByLabelText("Số lỗi Lỗi khác"), { target: { value: "5" } });
    expect(screen.getByRole("status").textContent).toBe("Ghi chú Lỗi khác là lỗi gì");
    fireEvent.change(screen.getByLabelText("Ghi chú Lỗi khác"), { target: { value: "nhăn mép" } });

    expect(screen.getByRole("status").textContent).toBe("Lưu được. Lỗi báo ngay về Nhóm thợ in");

    fireEvent.click(luu);
    await waitFor(() => expect(kiem).toHaveBeenCalledTimes(1));
    const body = kiem.mock.calls[0][2];
    expect(body.so_loi).toBe(17);
    expect(body.lsx_id).toBe(3);
    expect(body.loi!.map((d) => [d.thu_tu, d.so_luong, d.mo_ta])).toEqual([[0, 12, "lệch xanh"], [null, 5, "nhăn mép"]]);
    expect(body.loi!.every((d) => d.cong_viec_id === null)).toBe(true);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("bỏ tick thì xoá số đã nhập; lần ghi trước hiện tiêu chí và ghi chú tách riêng", () => {
    render(<KcsGhiLoiGiua lenh={lenh} cd={cd} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText("góc phải tờ")).toBeTruthy();
    expect(screen.getByText("Tổ chưa xem")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Không lem mực"));
    fireEvent.change(screen.getByLabelText("Số lỗi Không lem mực"), { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText("Không lem mực"));
    fireEvent.click(screen.getByLabelText("Không lem mực"));
    expect((screen.getByLabelText("Số lỗi Không lem mực") as HTMLInputElement).value).toBe("");
  });

  it("công đoạn đã xong: số lỗi vượt phần còn ghi được thì chưa cho Lưu (#72)", () => {
    const xong = { ...cd, trang_thai: "completed" } as SxKcsCongDoan;   // tổ làm 100, đã ghi lỗi 30
    render(<KcsGhiLoiGiua lenh={lenh} cd={xong} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Màu đúng mẫu"));
    fireEvent.change(screen.getByLabelText("Số lỗi Màu đúng mẫu"), { target: { value: "71" } });
    expect(screen.getByRole("status").textContent).toBe("Công đoạn đã xong, tổ đã làm 100 con: chỉ còn ghi được 70 con lỗi");
    expect((screen.getByRole("button", { name: "Lưu lỗi" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Số lỗi Màu đúng mẫu"), { target: { value: "70" } });
    expect(screen.getByRole("status").textContent).toMatch(/^Lưu được/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { MOI_NHOM, nhomCua, taoBoGopNhip, taoHoanNap, tickRong, tongTick, type NhomSuKien } from "./suKienNhom";

afterEach(() => {
  vi.useRealTimers();
});

describe("nhomCua", () => {
  it("sự kiện bàn tổ chỉ thuộc nhóm sản xuất — màn Nghỉ phép không phải nạp lại", () => {
    expect(nhomCua("san_xuat_cong_viec_changed")).toEqual(["san_xuat"]);
    expect(nhomCua("leave_pending_changed")).toEqual(["nhan_su"]);
    // Đề nghị vật tư của một bước đổi ⇒ cột Vật tư của lưới bàn tổ phải đổi theo.
    expect(nhomCua("san_xuat_vat_tu_de_nghi_changed")).toEqual(["san_xuat"]);
  });

  it("sự kiện có đường riêng (quyền, nhật ký) không bump nhóm nào", () => {
    expect(nhomCua("quyen_doi")).toEqual([]);
    expect(nhomCua("nhat_ky_moi")).toEqual([]);
  });

  it("loại LẠ ⇒ mọi nhóm (thà nạp thừa còn hơn đứng số cũ)", () => {
    expect(nhomCua("su_kien_moi_chua_khai")).toEqual(MOI_NHOM);
    // Tên trùng thuộc tính của Object không được lọt thành "đã khai".
    expect(nhomCua("toString")).toEqual(MOI_NHOM);
  });

  it("tick của màn = tổng các nhóm nó nghe", () => {
    const t = { ...tickRong(), san_xuat: 3, kho: 2, nhan_su: 7 };
    expect(tongTick(t, ["san_xuat", "kho"])).toBe(5);
    expect(tongTick(t, [])).toBe(0);
  });
});

describe("taoBoGopNhip", () => {
  it("gộp sự kiện dồn trong cửa sổ thành MỘT lần xả, cửa sổ tính từ sự kiện đầu", () => {
    vi.useFakeTimers();
    const xa = vi.fn<(n: NhomSuKien[]) => void>();
    const bo = taoBoGopNhip({ choMs: 400, dangAn: () => false, xa });
    bo.danhDau(["san_xuat"]);
    vi.advanceTimersByTime(300);
    bo.danhDau(["kho"]);
    bo.danhDau(["san_xuat"]);
    vi.advanceTimersByTime(99);
    expect(xa).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(xa).toHaveBeenCalledTimes(1);
    expect(new Set(xa.mock.calls[0][0])).toEqual(new Set(["san_xuat", "kho"]));
  });

  it("tab ẩn ⇒ chỉ đánh dấu; hiện lại thì xả một lần", () => {
    vi.useFakeTimers();
    let an = true;
    const xa = vi.fn<(n: NhomSuKien[]) => void>();
    const bo = taoBoGopNhip({ choMs: 400, dangAn: () => an, xa });
    bo.danhDau(["nhan_su"]);
    bo.danhDau(["ban_hang"]);
    vi.advanceTimersByTime(5_000);
    expect(xa).not.toHaveBeenCalled();
    an = false;
    expect(bo.khiHien()).toBe(true);
    expect(xa).toHaveBeenCalledTimes(1);
    expect(new Set(xa.mock.calls[0][0])).toEqual(new Set(["nhan_su", "ban_hang"]));
    expect(bo.khiHien()).toBe(false);
  });

  it("mảng nhóm rỗng không hẹn giờ gì", () => {
    vi.useFakeTimers();
    const xa = vi.fn();
    const bo = taoBoGopNhip({ choMs: 400, dangAn: () => false, xa });
    bo.danhDau([]);
    vi.advanceTimersByTime(1_000);
    expect(xa).not.toHaveBeenCalled();
  });
});

describe("taoHoanNap", () => {
  it("nhiều lượt cùng khoá trong 800 ms ⇒ một lượt chạy, bằng hàm của lượt CUỐI", () => {
    vi.useFakeTimers();
    const { hoanNap } = taoHoanNap();
    const a = vi.fn();
    const b = vi.fn();
    const khac = vi.fn();
    hoanNap("bao_gia", a);
    hoanNap("bao_gia", b);
    hoanNap("kho", khac);
    vi.advanceTimersByTime(800);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(khac).toHaveBeenCalledTimes(1);
    // Cửa sổ mới sau khi đã chạy.
    hoanNap("bao_gia", a);
    vi.advanceTimersByTime(800);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("huy() bỏ mọi lượt đang chờ", () => {
    vi.useFakeTimers();
    const { hoanNap, huy } = taoHoanNap();
    const a = vi.fn();
    hoanNap("x", a);
    huy();
    vi.advanceTimersByTime(1_000);
    expect(a).not.toHaveBeenCalled();
  });
});

// Bộ gắn nhãn BẢNG → THẺ của điện thoại (luoiThe.ts). Ba lỗi đã gặp khi bày thật trên 375px:
//   · bảng lương tiêu đề 2 tầng ⇒ thẻ lấy nhãn NHÓM ("Công & Lương thời gian") thay vì tên cột;
//   · ô tên có kèm chip ("Trần Văn Hùng [CHƯA KHAI LƯƠNG]") bị coi là ô trạng thái ⇒ mã bị bóp dọc;
//   · công tắc "Đang dùng" giữa dòng bị coi là ô tick chọn dòng ⇒ đè lên tên loại nghỉ.
import { describe, expect, it } from "vitest";
import { ganNhanThe, theHoaTrong } from "./luoiThe";

function bang(html: string): HTMLTableElement {
  const t = document.createElement("table");
  t.innerHTML = html;
  return t;
}

const o = (t: HTMLTableElement, i: number) => t.tBodies[0].rows[0].cells[i];

describe("ganNhanThe", () => {
  it("tiêu đề 2 tầng: nhãn là tên cột ở tầng dưới, cột rowspan vẫn có nhãn", () => {
    const t = bang(`
      <thead>
        <tr><th colspan="2">Thông tin</th><th colspan="2">Thu nhập (+)</th><th rowspan="2">Thực lĩnh</th></tr>
        <tr><th>Mã</th><th>Họ tên</th><th>Phụ cấp</th><th>Thưởng</th></tr>
      </thead>
      <tbody><tr><td>NV01</td><td>An</td><td>100</td><td>—</td><td>9.000</td></tr></tbody>`);
    ganNhanThe(t);
    expect([0, 1, 2, 3, 4].map((i) => o(t, i).dataset.nhan)).toEqual([
      "Mã", "Họ tên", "Phụ cấp", "Thưởng", "Thực lĩnh",
    ]);
    expect(o(t, 0).dataset.vai).toBe("dau");
    expect(o(t, 1).dataset.vai).toBe("ten");
    expect(o(t, 3).dataset.trong).toBe("1");
  });

  it("ô tên kèm chip KHÔNG phải ô trạng thái; ô chỉ có chip mới là trạng thái", () => {
    const t = bang(`
      <thead><tr><th>Mã</th><th>Ghi chú</th><th>Trạng thái</th></tr></thead>
      <tbody><tr>
        <td>NV01</td>
        <td>Trần Văn Hùng <span class="lds-chip">Chưa khai lương</span></td>
        <td><span class="ns-badge">Đã duyệt</span></td>
      </tr></tbody>`);
    ganNhanThe(t);
    expect(o(t, 1).dataset.vai).toBeUndefined();
    expect(o(t, 2).dataset.vai).toBe("tt");
  });

  it("đơn mua: cột \"Hàng\" là trạng thái, chip \"Mua cho\" đứng trước không chiếm góc thẻ", () => {
    const t = bang(`
      <thead><tr><th>Mã đơn</th><th>Mua cho</th><th>Hàng</th></tr></thead>
      <tbody><tr>
        <td>DMH-01</td>
        <td><span class="lds-chip">Theo yêu cầu</span></td>
        <td><span class="lds-chip">Nháp</span></td>
      </tr></tbody>`);
    ganNhanThe(t);
    expect(o(t, 1).dataset.vai).toBeUndefined();
    expect(o(t, 2).dataset.vai).toBe("tt");
  });

  it("checkbox đầu dòng là ô chọn; công tắc giữa dòng là ô thường có nhãn", () => {
    const t = bang(`
      <thead><tr><th></th><th>Tên loại nghỉ</th><th>Đang dùng</th></tr></thead>
      <tbody><tr>
        <td><input type="checkbox"></td>
        <td>Phép năm</td>
        <td><label class="cc-switch"><input type="checkbox"></label></td>
      </tr></tbody>`);
    ganNhanThe(t);
    expect(o(t, 0).dataset.vai).toBe("chon");
    expect(o(t, 2).dataset.vai).toBeUndefined();
    expect(o(t, 2).dataset.nhan).toBe("Đang dùng");
    expect(o(t, 2).dataset.trong).toBeUndefined();
  });

  it("nút-liên kết có chữ trong cột có tên là dữ liệu; nút biểu tượng / cột Thao tác là hàng nút", () => {
    const t = bang(`
      <thead><tr><th>Mã</th><th>Báo giá</th><th>Thao tác</th><th></th></tr></thead>
      <tbody><tr>
        <td>PTG-1</td>
        <td><button>BG26-0004</button></td>
        <td><button>Sửa</button></td>
        <td><button aria-label="Xoá"><svg></svg></button></td>
      </tr></tbody>`);
    ganNhanThe(t);
    expect(o(t, 1).dataset.vai).toBeUndefined();
    expect(o(t, 1).dataset.nhan).toBe("Báo giá");
    expect(o(t, 2).dataset.vai).toBe("nut");
    expect(o(t, 3).dataset.vai).toBe("nut");
  });

  it("màn tự khai vai / cấm ẩn ô trống", () => {
    const t = bang(`
      <thead><tr><th>Mã</th><th>CN/Lễ</th></tr></thead>
      <tbody><tr><td>NV01</td><td data-luon-hien="" data-vai-the="">—</td></tr></tbody>`);
    ganNhanThe(t);
    expect(o(t, 1).dataset.vai).toBeUndefined();
    expect(o(t, 1).dataset.trong).toBeUndefined();
  });

  it("bảng không có hàng tiêu đề (bảng phép tính) KHÔNG thành thẻ, kể cả lớp nằm trong danh sách", () => {
    const goc = document.createElement("div");
    goc.innerHTML = `
      <table class="lds-g"><tbody><tr><td>−</td><td>Sắp xuất</td><td>0</td></tr></tbody></table>
      <table class="lds-g"><thead><tr><th>#</th><th>Phiếu nhập</th></tr></thead>
        <tbody><tr><td>1</td><td>Đầu kỳ</td></tr></tbody></table>`;
    theHoaTrong(goc);
    const [phepTinh, lo] = Array.from(goc.querySelectorAll("table"));
    expect(phepTinh.dataset.the).toBeUndefined();
    expect(lo.dataset.the).toBe("1");
  });

  it("ô chữ dài (lý do chi) được đánh dấu data-dai; ô ngắn và ô có vai thì không", () => {
    const t = bang(`
      <thead><tr><th>Số phiếu</th><th>Lý do chi</th><th>Mục chi</th></tr></thead>
      <tbody><tr>
        <td>PC00076</td>
        <td>Tạm ứng lương tháng 09/2026 — 2 người (theo bảng kê)</td>
        <td>Tạm ứng lương</td>
      </tr></tbody>`);
    ganNhanThe(t);
    expect(o(t, 0).dataset.dai).toBeUndefined();
    expect(o(t, 1).dataset.dai).toBe("1");
    expect(o(t, 2).dataset.dai).toBeUndefined();
  });

  it("hàng nhóm: ô gộp cột đứng đầu là đầu thẻ; ô gộp cả hàng vẫn là toàn hàng", () => {
    const t = bang(`
      <thead><tr><th></th><th>Đợt</th><th>Hạn trả</th><th>Giá trị</th><th>Còn nợ</th></tr></thead>
      <tbody>
        <tr><td><input type="checkbox"></td><td colspan="2">PMH-01 · 5 đợt</td><td>500</td><td>40</td></tr>
        <tr><td colspan="5">Chưa có đợt nào</td></tr>
      </tbody>`);
    ganNhanThe(t);
    const r0 = t.tBodies[0].rows[0].cells;
    expect(r0[1].dataset.vai).toBe("dau");
    expect(r0[2].dataset.vai).not.toBe("dau");
    expect(t.tBodies[0].rows[1].cells[0].dataset.vai).toBe("toan");
  });
});

// Quy trình kinh doanh (làm lại 05/10/2026): sơ đồ làn — cột là bộ phận, ô là bước, mũi tên là luồng.
// Trên sơ đồ chỉ có tên bước; bấm ô mới hiện mô tả + nút mở màn (thiếu quyền thì khoá, nói rõ);
// bấm tên bộ phận để làm mờ việc của bộ phận khác.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUOC, NOI, QuyTrinhKinhDoanhPage, SO_DO_TM, soDo } from "./QuyTrinhKinhDoanhPage";
import { PermissionsProvider, buildCapabilities, type PhanHe } from "../auth/permissions";
import { NAV } from "../components/Sidebar";

const MOI_MAN_MENU = new Set(NAV.flatMap((s) => s.items.flatMap((i) => [i.id, ...(i.children ?? []).map((c) => c.id)])));

describe("Quy trình kinh doanh", () => {
  beforeEach(() => localStorage.clear());

  it("luồng liền mạch từ mốc đầu tới mốc cuối, mọi mũi tên nối hai bước có thật", () => {
    const id = new Set(BUOC.map((b) => b.id));
    expect(NOI.every((n) => id.has(n.tu) && id.has(n.toi))).toBe(true);
    // Mọi bước (trừ mốc đầu) đều có mũi tên đi vào; mọi bước (trừ mốc cuối) đều có mũi tên đi ra.
    expect(BUOC.filter((b) => b.loai !== "dau" && !NOI.some((n) => n.toi === b.id))).toEqual([]);
    expect(BUOC.filter((b) => b.loai !== "cuoi" && !NOI.some((n) => n.tu === b.id))).toEqual([]);
  });

  it("không có hai ô chồng nhau trên sơ đồ", () => {
    const o = BUOC.map((b) => `${b.boPhan}@${b.hang}`);
    expect(new Set(o).size).toBe(o.length);
  });

  it("mọi bước trỏ tới màn có thật trên menu", () => {
    const man = BUOC.map((b) => b.man).filter(Boolean) as string[];
    expect(man.filter((m) => !MOI_MAN_MENU.has(m))).toEqual([]);
  });

  it("trên sơ đồ không có mô tả; bấm ô mới hiện chi tiết và nút mở đúng màn", async () => {
    const navigate = vi.fn();
    render(<QuyTrinhKinhDoanhPage navigate={navigate} />);
    expect(screen.queryByText(/phần mềm tính ra giá vốn/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Bước 2: Lập phiếu tính giá" }));
    expect(screen.getByRole("dialog", { name: "Bước 2: Lập phiếu tính giá" })).toBeTruthy();
    expect(screen.getByText(/phần mềm tính ra giá vốn/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Mở Tính giá/ }));
    expect(navigate).toHaveBeenCalledWith("tinh-gia");
  });

  it("thiếu quyền màn thì thẻ chi tiết không có nút mở mà ghi rõ chưa có quyền", async () => {
    render(<QuyTrinhKinhDoanhPage navigate={() => {}} moDuoc={(id) => id !== "kcs"} />);
    await userEvent.click(screen.getByRole("button", { name: "Bước 11: Kiểm hàng, gửi kho" }));
    expect(screen.queryByRole("button", { name: /Mở KCS/ })).toBeNull();
    expect(screen.getByText("KCS: chưa có quyền")).toBeTruthy();
  });

  it("bấm tên bộ phận Kho: chỉ ô của Kho còn rõ, bấm lần nữa thì bỏ lọc", async () => {
    render(<QuyTrinhKinhDoanhPage navigate={() => {}} />);
    const kho = screen.getByRole("button", { name: "Kho" });
    await userEvent.click(kho);
    const ro = [...document.querySelectorAll(".qtkd__nut:not(.is-nhat)")].map((e) => e.getAttribute("aria-label"));
    expect(ro).toEqual(["Bước 12: Nhận thành phẩm", "Bước 15: Soạn hàng, xuất kho"]);
    expect(localStorage.getItem("qtkd:bo-phan")).toBe("kho");
    await userEvent.click(kho);
    expect(document.querySelectorAll(".qtkd__nut.is-nhat").length).toBe(0);
  });

  it("tắt giao hàng: không còn làn Giao hàng, sơ đồ vẫn liền mạch và không chồng ô", () => {
    const s = soDo(true);
    expect(s.BO_PHAN.some((b) => b.key === "gh")).toBe(false);
    expect(s.BUOC.some((b) => b.boPhan === "gh" || b.man === "giao-hang")).toBe(false);
    const id = new Set(s.BUOC.map((b) => b.id));
    expect(s.NOI.every((n) => id.has(n.tu) && id.has(n.toi))).toBe(true);
    expect(s.BUOC.filter((b) => b.loai !== "dau" && !s.NOI.some((n) => n.toi === b.id))).toEqual([]);
    expect(s.BUOC.filter((b) => b.loai !== "cuoi" && !s.NOI.some((n) => n.tu === b.id))).toEqual([]);
    const o = s.BUOC.map((b) => `${b.boPhan}@${b.hang}`);
    expect(new Set(o).size).toBe(o.length);
    expect(s.BUOC.filter((b) => b.stt).map((b) => b.stt)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it("hàng thương mại: mọi mũi tên nối bước có thật, không chồng ô, màn có thật, đánh số liền 1..11", () => {
    const s = SO_DO_TM;
    const id = new Set(s.BUOC.map((b) => b.id));
    expect(s.NOI.every((n) => id.has(n.tu) && id.has(n.toi))).toBe(true);
    expect(s.BUOC.filter((b) => b.loai !== "dau" && !s.NOI.some((n) => n.toi === b.id))).toEqual([]);
    expect(s.BUOC.every((b) => s.BO_PHAN.some((x) => x.key === b.boPhan))).toBe(true);
    const o = s.BUOC.map((b) => `${b.boPhan}@${b.hang}`);
    expect(new Set(o).size).toBe(o.length);
    const man = s.BUOC.map((b) => b.man).filter(Boolean) as string[];
    expect(man.filter((m) => !MOI_MAN_MENU.has(m))).toEqual([]);
    expect(s.BUOC.filter((b) => b.stt).map((b) => b.stt)).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
    // Tên dải nằm ở làn cuối của hàng đầu dải: ô đó phải trống.
    const lanCuoi = s.BO_PHAN[s.BO_PHAN.length - 1].key;
    expect(s.NHOM.filter((n) => s.BUOC.some((b) => b.hang === n.hang && b.boPhan === lanCuoi))).toEqual([]);
  });

  it("bật phân hệ thương mại: bấm Hàng thương mại thì ra sơ đồ thương mại và nhớ lựa chọn", async () => {
    render(<QuyTrinhKinhDoanhPage navigate={() => {}} />);
    await userEvent.click(screen.getByRole("radio", { name: "Hàng thương mại" }));
    expect(screen.getByRole("button", { name: "Bước 6: Lập đơn thương mại" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Bước 2: Lập phiếu tính giá" })).toBeNull();
    expect(localStorage.getItem("qtkd:loai")).toBe("tm");
    await userEvent.click(screen.getByRole("radio", { name: "Đơn sản xuất" }));
    expect(screen.getByRole("button", { name: "Bước 2: Lập phiếu tính giá" })).toBeTruthy();
  });

  it("bản cài tắt phân hệ thương mại (SVN): không có nút chuyển, dù lần trước nhớ chọn thương mại", () => {
    localStorage.setItem("qtkd:loai", "tm");
    render(
      <PermissionsProvider caps={buildCapabilities([])} phanHeTat={new Set<PhanHe>(["thuong_mai"])}>
        <QuyTrinhKinhDoanhPage navigate={() => {}} />
      </PermissionsProvider>,
    );
    expect(screen.queryByRole("radio", { name: "Hàng thương mại" })).toBeNull();
    expect(screen.getByRole("button", { name: "Bước 2: Lập phiếu tính giá" })).toBeTruthy();
  });
});

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LsxCongDoan } from "../api/client";
import { LsxRoutingTable } from "./LsxRoutingTable";

vi.mock("./tenDonVi", async (goc) => ({
  ...(await goc<typeof import("./tenDonVi")>()), useNapTenDonVi: () => undefined,
}));

const buoc = (p: Partial<LsxCongDoan> & { step_key: string; ten: string }): LsxCongDoan => ({
  id: null, cong_doan_id: null, nhom: "finishing", loai_buoc: "may", department_id: null,
  may_id: null, so_luong_vao: 1500, so_luong_ra: 1500, don_vi_vao: "to", don_vi_ra: "to",
  phu_thuoc_step_keys: [], vat_tus: [], ...p,
} as unknown as LsxCongDoan);

const giay = (id: number) => ({ hang_loai: "giay", vat_tu_id: id, vat_tu_ten: "Giấy", so_luong: 1 });

function ve(congDoans: LsxCongDoan[], songId: number | null) {
  return render(
    <LsxRoutingTable
      congDoans={congDoans} soLuongDat={1500} leadTime={null} baiGhep={null}
      congDoanRefs={[{ id: 7, ten: "Tề sóng", ma: "TS" }, { id: 8, ten: "In", ma: "IN" }]}
      toRefs={[]} mayRefs={[]} khuonRefs={[]} tenSanPham="Hộp" tenKhach="" onTaoKhuon={vi.fn()}
      vatTuRefs={[]} giayRefs={[]} phuThuocRefs={[]} canUpdate giuCho={false} saving={false}
      onSave={vi.fn()} onPatchLsx={vi.fn()} onMacDinhBuoc={vi.fn()} onXemTruocBuoc={vi.fn()}
      onXemTruocRouting={vi.fn()} onDirtyChange={vi.fn()}
      dvChuoi={{ to: "tờ", tp: "con" } as never}
      giayId={1} songId={songId}
    />,
  );
}

describe("LsxRoutingTable — bảng Các bước theo mockup", () => {
  const rows = [
    buoc({ step_key: "in", ten: "In", cong_doan_id: 8, department_ten: "Tổ in",
      so_luong_vao: 1560, so_luong_ra: 1500, vat_tus: [giay(1)] as never }),
    buoc({ step_key: "ts", ten: "Tề sóng", cong_doan_id: 7, vat_tus: [giay(2)] as never }),
    buoc({ step_key: "boi", ten: "Bồi", phu_thuoc_step_keys: ["in", "ts"] }),
    buoc({ step_key: "be", ten: "Bế", phu_thuoc_step_keys: ["boi"], don_vi_ra: "con" }),
    buoc({ step_key: "kp", ten: "Kiểm phẩm", phu_thuoc_step_keys: ["be"], loai_buoc: "thue_ngoai",
      nha_cung_cap: "Bao bì Minh Phát", don_vi_vao: "con", don_vi_ra: "con" }),
  ];

  it("có cột Nhánh, vạch theo nhánh, Làm sau ghi Bắt đầu và tên bước gộp", () => {
    const { container } = ve(rows, 2);
    expect(screen.getByRole("columnheader", { name: "Nhánh" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Loại" })).toBeNull();
    const tr = container.querySelectorAll("tbody tr");
    expect(tr[0].className).toContain("khsx-rt__row--n-giay");
    expect(tr[1].className).toContain("khsx-rt__row--n-song");
    expect(tr[2].className).toContain("khsx-rt__row--n-gop");
    expect(within(tr[0] as HTMLElement).getByText("Bắt đầu")).toBeInTheDocument();
    expect(within(tr[1] as HTMLElement).getByText("Bắt đầu")).toBeInTheDocument();
    expect(within(tr[2] as HTMLElement).getByText("In và Tề sóng")).toBeInTheDocument();
    // Bước nối thẳng dòng trên thì ô Làm sau trống.
    expect((tr[3] as HTMLElement).querySelector(".khsx-rt__sau")?.textContent).toBe("");
    expect(screen.getByText("Ô Làm sau để trống là làm ngay sau bước ở dòng trên.")).toBeInTheDocument();
  });

  it("chip Chuẩn bị cho Tề sóng, chip Gia công ngoài kèm nhà gia công, không chữ Nội bộ", () => {
    const { container } = ve(rows, 2);
    const tr = container.querySelectorAll("tbody tr");
    expect(within(tr[1] as HTMLElement).getByText("Chuẩn bị")).toBeInTheDocument();
    expect(within(tr[0] as HTMLElement).queryByText("Chuẩn bị")).toBeNull();
    expect(within(tr[4] as HTMLElement).getByText("Gia công ngoài")).toBeInTheDocument();
    expect(within(tr[4] as HTMLElement).getByText("Bao bì Minh Phát")).toBeInTheDocument();
    expect(within(tr[0] as HTMLElement).getByText("Tổ in")).toBeInTheDocument();
    expect(container.querySelector("tbody")?.textContent).not.toContain("Nội bộ");
    expect(within(tr[0] as HTMLElement).getByText("1 vật tư")).toBeInTheDocument();
  });

  it("số lượng một dòng: vào bằng ra thì chỉ ghi một số", () => {
    const { container } = ve(rows, 2);
    const tr = container.querySelectorAll("tbody tr");
    expect((tr[0] as HTMLElement).querySelector(".khsx-rt__vr")?.textContent).toContain("→");
    expect((tr[2] as HTMLElement).querySelector(".khsx-rt__vr")?.textContent).not.toContain("→");
  });

  it("lệnh không sóng thì không có cột Nhánh và không vạch", () => {
    const { container } = ve(rows.filter((r) => r.step_key !== "ts"), null);
    expect(screen.queryByRole("columnheader", { name: "Nhánh" })).toBeNull();
    expect(container.querySelector(".khsx-rt__row--n-giay")).toBeNull();
  });
});

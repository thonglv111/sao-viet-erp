// Mục "Giấy nguyên" của phiếu tính giá: Giấy + Sóng chọn MỘT lần cho sản phẩm (spec 2026-10-24-chuan-bi-giay §4).
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OGiaySong } from "./OGiaySong";
import { fromComponent, toThanhPhanIn } from "./PhieuTinhGiaDetailView";
import type { ThanhPhanOut } from "../api/client";

vi.mock("./tenDonVi", async (goc) => ({
  ...(await goc<typeof import("./tenDonVi")>()),
  useNapTenDonVi: () => 1,
  tenDonVi: (ma?: string | null) => ({ to: "tờ", kg: "kg" } as Record<string, string>)[ma ?? ""],
}));

const GIAY = [
  { id: 1, ma: "GL-0001", ten: "Duplex 350", loai: "giay", don_gia: 29700, don_vi_gia: "to" },
  { id: 2, ma: "GL-0002", ten: "Sóng E", loai: "song", don_gia: 12000, don_vi_gia: "kg" },
  { id: 3, ma: "GL-0003", ten: "Ivory ngừng", loai: "giay", active: false },
];

const moO = (nhan: string) => {
  fireEvent.click(screen.getByRole("button", { name: nhan }));
  return screen.getAllByRole("option").map((o) => o.textContent ?? "");
};

describe("OGiaySong", () => {
  it("ô Giấy chỉ mời mã loại Giấy (tên, không mã), ô Sóng chỉ mời mã loại Sóng và bỏ trống được", () => {
    const o = <OGiaySong giays={GIAY as never} giayId={null} songId={null} onGiay={vi.fn()} onSong={vi.fn()} />;
    const { unmount } = render(o);
    const giay = moO("Giấy");
    expect(giay.some((t) => t.includes("Duplex 350"))).toBe(true);
    expect(giay.some((t) => t.includes("Sóng E") || t.includes("GL-0001") || t.includes("Ivory ngừng"))).toBe(false);
    unmount();
    render(o);
    const song = moO("Sóng");
    expect(song.some((t) => t.includes("Sóng E"))).toBe(true);
    expect(song.some((t) => t.includes("Duplex 350"))).toBe(false);
    expect(song[0]).toMatch(/Không sóng/);
  });

  it("chọn báo id ra ngoài; giá của mã hiện ngay dưới ô", () => {
    const onGiay = vi.fn();
    const onSong = vi.fn();
    const { rerender } = render(<OGiaySong giays={GIAY as never} giayId={null} songId={null} onGiay={onGiay} onSong={onSong} />);
    moO("Giấy");
    fireEvent.mouseDown(screen.getByRole("option", { name: /Duplex 350/ }));
    expect(onGiay).toHaveBeenLastCalledWith(1);
    rerender(<OGiaySong giays={GIAY as never} giayId={1} songId={2} onGiay={onGiay} onSong={onSong} />);
    expect(screen.getByText("29.700 đ / tờ")).toBeTruthy();
    expect(screen.getByText("12.000 đ / kg")).toBeTruthy();
  });
});

describe("Phiếu tính giá — payload giấy/sóng", () => {
  it("gửi lên giay_id và song_id; vật tư của bước không còn dòng giấy", () => {
    const tp = {
      id: 9, ten: "Hộp", giay_id: 1, song_id: 2,
      thanh_phams: [{ id: 5, ten: "In", cong_doan_id: 7, vat_tus: [
        { id: 1, thu_tu: 0, hang_loai: "giay", vat_tu_id: 1, gia_tri_chip: {} },
        { id: 2, thu_tu: 1, hang_loai: "vat_tu", vat_tu_id: 4, gia_tri_chip: {} }] }],
    } as unknown as ThanhPhanOut;
    const out = toThanhPhanIn(fromComponent(tp));
    expect(out.giay_id).toBe(1);
    expect(out.song_id).toBe(2);
    const vt = (out.thanh_phams ?? []).flatMap((f) => f.vat_tus ?? []);
    expect(vt.map((v) => [v.hang_loai, v.vat_tu_id])).toEqual([["vat_tu", 4]]);
  });
});

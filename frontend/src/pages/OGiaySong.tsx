import { useMemo } from "react";
import type { Row } from "../api/rebuildCatalog";
import { Select, type SelectOption } from "../components/Select";
import { tenDonVi, useNapTenDonVi } from "./tenDonVi";

/** Giấy + Sóng của MỘT sản phẩm tính giá (spec 2026-10-24-chuan-bi-giay §4) — chọn một lần, cạnh khổ
 *  nguyên. Ô Giấy chỉ mời mã loại Giấy, ô Sóng chỉ mời mã loại Sóng (bỏ trống được). Mỗi ô hiện TÊN,
 *  không mã (mã giấy tự sinh, không nói lên gì về tờ giấy). Mã ngừng dùng chỉ còn hiện khi đang chọn. */
interface Props {
  giays: Row[];
  giayId: number | null;
  songId: number | null;
  onGiay: (id: number | null) => void;
  onSong: (id: number | null) => void;
}

const laSong = (g: Row) => g.loai === "song";

function luaChon(rows: Row[], dangDung: number | null, rong: string): SelectOption<string>[] {
  return [
    { value: "", label: rong },
    ...rows.filter((r) => r.active !== false || r.id === dangDung).map((r) => ({
      value: String(r.id),
      label: r.active === false ? `${String(r.ten)} (ngừng dùng)` : String(r.ten),
    })),
  ];
}

/** "29.700 đ / tờ" — đơn giá theo danh mục, tên đơn vị đọc từ danh mục Đơn vị. */
function nhanGia(g: Row | undefined): string {
  // Máy chủ che giá (`don_gia` null) khi người xem không có ô Xem giá của Giấy (L-SX-39).
  if (!g || g.don_gia == null) return "";
  const dv = tenDonVi(String(g.don_vi_gia ?? "")) ?? String(g.don_vi_gia ?? "");
  return `${(Number(g.don_gia) || 0).toLocaleString("vi-VN")} đ / ${dv || "—"}`;
}

export function OGiaySong({ giays, giayId, songId, onGiay, onSong }: Props) {
  useNapTenDonVi();
  const giayOpts = useMemo(() => luaChon(giays.filter((g) => !laSong(g)), giayId, "— Chọn giấy —"),
    [giays, giayId]);
  const songOpts = useMemo(() => luaChon(giays.filter(laSong), songId, "— Không sóng —"), [giays, songId]);
  const o = (nhan: string, opts: SelectOption<string>[], id: number | null, doi: (id: number | null) => void) => (
    <label className="tg-field tg-span-3">
      <span className="tg-microlabel">{nhan}</span>
      <Select
        options={opts}
        value={id == null ? "" : String(id)}
        onChange={(v) => doi(v === "" ? null : Number(v))}
        ariaLabel={nhan}
        searchable
        portal
        className="tg-input"
        listClassName="tg-pop"
      />
      {id != null && <span className="tg-hint">{nhanGia(giays.find((g) => g.id === id))}</span>}
    </label>
  );
  return (
    <>
      {o("Giấy", giayOpts, giayId, onGiay)}
      {o("Sóng", songOpts, songId, onSong)}
    </>
  );
}

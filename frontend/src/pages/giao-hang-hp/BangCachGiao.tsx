// Cách giao từng lần xuất của một đơn — ngăn chi tiết Đơn hàng bán, chỉ bản cài bật `giao_hang_hp`
// (docs/design-giao-hang-ha-phuong.md). Tiền cước máy chủ chỉ trả cho người có ô Xem của Phiếu chi.
import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { useCan } from "../../auth/permissions";
import { soVN } from "../../components/LuoiDs";
import { giaoHangHpApi, NHAN_CACH_GIAO, type CachGiaoRow } from "../../api/giaoHangHp";
import { fmtDate } from "../../utils/format";
import "./chon-cach-giao.css";

/** Một ô "Giao hàng" ở danh sách đơn: cách giao của lần xuất gần nhất, kèm người giao hoặc đơn vị. */
export function nhanCachGiao(r: CachGiaoRow): { chinh: string; phu: string | null } {
  const phu = r.loai === "noi_bo" ? r.nguoi_giao_ten : r.loai === "dich_vu" ? r.don_vi_vc_ten : null;
  return { chinh: NHAN_CACH_GIAO[r.loai] ?? r.loai, phu: phu ?? null };
}

export function BangCachGiao({ orderId, tick }: {
  orderId: number;
  /** Đổi giá trị này là nạp lại (sau một lần xuất mới, hoặc sự kiện máy chủ). */
  tick?: unknown;
}) {
  const { token } = useAuth();
  const xemTien = useCan()("phieu_chi", "read");
  const [ds, setDs] = useState<CachGiaoRow[] | null>(null);
  const [loi, setLoi] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let bo = false;
    giaoHangHpApi.cuaDon(token, orderId)
      .then((r) => { if (!bo) { setDs(r.items); setLoi(null); } })
      .catch((e: unknown) => { if (!bo) setLoi(e instanceof Error ? e.message : "Không tải được cách giao"); });
    return () => { bo = true; };
  }, [token, orderId, tick]);

  if (loi) return <div className="banner banner--error" role="alert">{loi}</div>;
  if (!ds || ds.length === 0) return null;
  return (
    <div className="bcg">
      <h5 className="bcg__ten">Cách giao</h5>
      <table className="dhb__g">
        <thead>
          <tr>
            <th>Lần xuất</th>
            <th>Cách giao</th>
            <th>Người giao / đơn vị</th>
            <th>Xe / mã vận đơn</th>
            {xemTien && <th className="dhb__text-right">Tiền cước</th>}
          </tr>
        </thead>
        <tbody>
          {ds.map((r) => (
            <tr key={r.id}>
              <td>
                <span className="dhb__mono">{r.ma_lan_xuat ?? "—"}</span>
                <small className="dhb__muted dhb__ben-phu">{fmtDate(r.created_at)}</small>
              </td>
              <td>{NHAN_CACH_GIAO[r.loai] ?? r.loai}</td>
              <td>{r.loai === "noi_bo" ? r.nguoi_giao_ten ?? "—" : r.loai === "dich_vu" ? r.don_vi_vc_ten ?? "—" : "—"}</td>
              <td>
                {r.loai === "noi_bo" ? (r.xe_bien_so ? <span className="dhb__mono">{r.xe_bien_so}</span> : "—")
                  : r.loai === "dich_vu" ? (r.ma_van_don ? <span className="dhb__mono">{r.ma_van_don}</span> : "—") : "—"}
              </td>
              {xemTien && (
                <td className="dhb__mono dhb__text-right">
                  {r.loai === "dich_vu" && r.tien_cuoc != null ? soVN(r.tien_cuoc) : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Xếp lịch — bản ĐIỆN THOẠI (14/10/2026, docs/thiet-ke-mobile.md §4.5).
//
// Lưới Gantt (XlLuoi) cần bề ngang ≥ 1100px và kéo-thả bằng chuột ⇒ trên điện thoại thay bằng danh
// sách lệnh THEO NGÀY BẮT ĐẦU: mỗi lệnh một thẻ (mã · tên · khách · máy · giờ bắt đầu → kết thúc ·
// giờ chạy · hạn SX). Chạm thẻ = chọn lệnh ⇒ mở đúng ngăn chi tiết (XlNgan) như trên máy tính. Cùng
// dữ liệu `/lich`, không đổi luật xếp; dời giờ bằng kéo-thả vẫn chỉ ở máy lớn.
import type { XlDong, XlVatTu } from "../api/client";
import { IconTT } from "./XlLuoi";
import { gioChu, ngayGio, thuNgay, treHan, veDen, veTu } from "./xlShared";

/** Đúng ba trạng thái của chân màn Gantt (IconTT): phát hành · đã đóng · còn lại = chưa phát hành. */
const tenTT = (tt: string) =>
  tt === "da_phat_hanh" ? "Đã phát hành" : tt === "da_dong" ? "Đã đóng" : "Chưa phát hành";

export function XlDanhSachDT({
  dong,
  vatTu,
  hienXong,
  chonId,
  trong,
  onChon,
}: {
  dong: XlDong[];
  vatTu: Map<number, XlVatTu>;
  hienXong: boolean;
  chonId: number | null;
  trong?: string;
  onChon: (id: number) => void;
}) {
  const ds = dong
    .filter((d) => hienXong || d.trang_thai !== "da_dong")
    .slice()
    .sort((a, b) => (veTu(a) ?? "9999").localeCompare(veTu(b) ?? "9999"));

  if (!ds.length) {
    return <p className="xl-dt__trong">{trong ?? "Trong khoảng này chưa có lệnh nào được xếp lịch."}</p>;
  }

  // Gom theo NGÀY bắt đầu; lệnh chưa có giờ xuống nhóm cuối.
  const nhom = new Map<string, XlDong[]>();
  for (const d of ds) {
    const tu = veTu(d);
    const k = tu ? tu.slice(0, 10) : "";
    (nhom.get(k) ?? nhom.set(k, []).get(k)!).push(d);
  }

  return (
    <div className="xl-dt">
      {[...nhom.entries()].map(([ngay, cac]) => (
        <section key={ngay || "chua"} className="xl-dt__ngay">
          <h3 className="xl-dt__ngay-ten">
            {ngay ? thuNgay(ngay) : "Chưa xếp giờ"}
            <span>{cac.length} lệnh</span>
          </h3>
          {cac.map((d) => {
            const tre = treHan(d);
            const vt = vatTu.get(d.lsx_id);
            return (
              <button
                key={d.lsx_id}
                type="button"
                className={`xl-dt__the${chonId === d.lsx_id ? " is-chon" : ""}${d.is_rush ? " is-gap" : ""}`}
                onClick={() => onChon(d.lsx_id)}
              >
                <span className="xl-dt__dau">
                  <span className="xl-dt__ma">{d.ma}</span>
                  {d.is_rush && <span className="xl-dt__gap">Gấp</span>}
                  <span className="xl-dt__tt">
                    <IconTT tt={d.trang_thai} />
                    {tenTT(d.trang_thai)}
                  </span>
                </span>
                <strong className="xl-dt__ten">{d.ten}</strong>
                {d.customer_name && <span className="xl-dt__phu">{d.customer_name}</span>}
                <span className="xl-dt__gio">
                  {veTu(d) ? ngayGio(veTu(d)) : "—"} → {veDen(d) ? ngayGio(veDen(d)) : "—"}
                </span>
                <span className="xl-dt__dong">
                  <span>Máy</span>
                  <b>{d.may_ten ?? "—"}</b>
                </span>
                <span className="xl-dt__dong">
                  <span>Giờ chạy</span>
                  <b>{gioChu(d.chay_phut)}</b>
                </span>
                {d.han_hoan_thanh_sx && (
                  <span className="xl-dt__dong">
                    <span>Hạn xong SX</span>
                    <b className={tre != null && tre > 0 ? "is-tre" : undefined}>
                      {thuNgay(d.han_hoan_thanh_sx)}
                      {tre != null && tre > 0 ? ` · trễ ${tre} ngày` : ""}
                    </b>
                  </span>
                )}
                {vt && vt.muc !== "ok" && (
                  <span className={`xl-dt__vt is-${vt.muc}`}>{vt.chu}</span>
                )}
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}

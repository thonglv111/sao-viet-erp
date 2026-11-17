// Nhắc ở tab Nhận của Việc của tổ (spec Thuê gia công 2026-11-13 §5.1 bước 5): bước trước đang ở nhà gia
// công ⇒ "Hàng <bước> ở <nhà> hẹn về dd/mm" và nút Nhận hàng gia công mở hộp phiếu nhận đúng dòng đơn.
// Máy chủ quyết ai nhận được: tổ bước sau có quyền xác nhận sản lượng thì nhận về xưởng không cần quyền
// màn Thuê gia công.
import { useState } from "react";
import type { SxCongDoanTruoc } from "../../api/client";
import { ngayDayDu } from "../loc-san-xuat/ngay";
import { nhanChang } from "../lsxBuoc";
import { PhieuNhanForm } from "./PhieuNhanForm";
import { so } from "./tgc";

export function GiaCongChoVe({ truoc }: { truoc: SxCongDoanTruoc[] }) {
  const ds = truoc.filter((c) => c.gia_cong);
  const [mo, setMo] = useState<{ donId: number; dongId: number } | null>(null);
  if (ds.length === 0) return null;
  return (
    <>
      {ds.map((c) => {
        const g = c.gia_cong!;
        return (
          <div key={c.cong_viec_id} className="thsx-b-trong tgc-cho-ve">
            <span>
              {`Hàng ${c.ten_cong_doan.toLowerCase()} ở ${g.nha_cung_cap_ten}`}
              {g.ngay_hen_ve ? ` hẹn về ${ngayDayDu(g.ngay_hen_ve)}` : ", chưa hẹn ngày về"}
              {g.con_ngoai > 0 && <span className="tgc-u">{`Còn ở ngoài ${so(g.con_ngoai)} ${nhanChang(g.don_vi)}`}</span>}
            </span>
            <button type="button" className="btn btn--ghost" onClick={() => setMo({ donId: g.don_id, dongId: g.don_dong_id })}>
              Nhận hàng gia công
            </button>
          </div>
        );
      })}
      {mo && (
        <PhieuNhanForm donId={mo.donId} chiDongDon={mo.dongId} onClose={() => setMo(null)} onDone={() => setMo(null)} />
      )}
    </>
  );
}

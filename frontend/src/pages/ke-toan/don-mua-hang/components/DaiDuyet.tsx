// Dải "CHỜ DUYỆT" đầu ngăn đơn mua ở màn Kế toán (15/10/2026) — CÙNG khuôn `.mh-tiep` với dải
// "Tiếp theo: gửi duyệt" bên Mua hàng (user: "nó không cùng một ui/ux à"). Người duyệt thấy đúng
// thứ mình đang đồng ý (cọc, hạn trả) + chip nợ NCC, nút Duyệt / Từ chối nằm cuối dải thay cho
// đầu ngăn. Từ chối mở bong bóng gõ lý do ngay dưới nút — thay hộp ngăn kéo cũ cao hết màn mà chỉ
// có một ô chữ.
import { useState } from "react";
import type { PurchaseRequestRow, SupplierCredit } from "../../../../api/client";
import { Button } from "../../../../components/Button";
import { money } from "../../../../utils/format";
import { moTaHanTra } from "../../../mua-hang/don-mua-chung/hanTra";
import "../../../mua-hang/trang-thai-mua.css";

export function DaiDuyet({
  row,
  credit,
  duyetBusy,
  onDuyet,
  onTuChoi,
}: {
  row: PurchaseRequestRow;
  credit?: SupplierCredit | null;
  duyetBusy: boolean;
  onDuyet: () => void;
  /** Trả về câu lỗi, hoặc null khi đã từ chối xong. */
  onTuChoi: (lyDo: string) => Promise<string | null>;
}) {
  const [moTuChoi, setMoTuChoi] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [busy, setBusy] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const han = moTaHanTra(row.supplier_credit_days, row.supplier_debt_cutoff_day);

  async function tuChoi() {
    if (!lyDo.trim()) {
      setLoi("Ghi lý do để người lập biết phải sửa gì.");
      return;
    }
    setBusy(true);
    setLoi(await onTuChoi(lyDo.trim()));
    setBusy(false);
  }

  return (
    <section className="mh-tiep" aria-label="Đơn đang chờ duyệt">
      <span className="mh-tiep__nhan">Chờ duyệt</span>
      <span className="mh-tiep__o">
        Cọc <span className="mh-tiep__gt">{row.deposit_expected ? money(row.deposit_expected) : "Không cọc"}</span>
      </span>
      <span className="mh-tiep__o" title={han.phu}>
        Hạn trả <span className="mh-tiep__gt">{han.chinh}</span>
      </span>
      {credit?.vuot_han_muc && (
        <span
          className="mh-tiep__no"
          title={`Đang nợ nhà cung cấp ${money(credit.no_hien_tai)}, vượt hạn mức ${money(credit.vuot_bao_nhieu)}. Chỉ nhắc, không chặn.`}
        >
          Vượt hạn mức nợ {money(credit.vuot_bao_nhieu)}
        </span>
      )}
      <span className="mh-gian" />
      <span className="mh-tiep__nut">
        <Button variant="ghost" aria-expanded={moTuChoi} disabled={duyetBusy}
          onClick={() => { setMoTuChoi(!moTuChoi); setLoi(null); }}>
          Từ chối
        </Button>
        <Button variant="accent" loading={duyetBusy} disabled={moTuChoi} onClick={onDuyet}>
          Duyệt
        </Button>
        {moTuChoi && (
          <div className="mh-tiep__pop mh-tiep__pop--phai" role="dialog" aria-label="Từ chối đơn">
            <label className="mh-tiep__lydo">
              Lý do từ chối
              <textarea
                autoFocus
                className="input"
                rows={3}
                value={lyDo}
                onChange={(e) => setLyDo(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setMoTuChoi(false)}
              />
            </label>
            {loi && <small className="mh-tiep__loi" role="alert">{loi}</small>}
            <div className="mh-tiep__luu">
              <span className="mh-gian" />
              <button type="button" className="mh-nut" disabled={busy} onClick={() => setMoTuChoi(false)}>Huỷ</button>
              <button type="button" className="mh-nut mh-nut--do" disabled={busy} onClick={() => void tuChoi()}>
                Từ chối đơn
              </button>
            </div>
          </div>
        )}
      </span>
    </section>
  );
}

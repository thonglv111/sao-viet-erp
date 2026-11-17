// Khối "Thuê gia công" CHỈ ĐỌC trên màn lệnh và bài ghép (spec 2026-11-13 §2, §5.3): mỗi việc một
// dòng với chip trạng thái, nhà gia công, số đã giao / đã về, và đường sang đơn ở màn Thuê gia công.
// Việc trọn gói CHƯA đặt huỷ được từ đây (lệnh về Nháp) — đã vào đơn thì huỷ dòng đơn trước.
import { useState } from "react";
import { ApiError } from "../../api/client";
import { tgcApi, type TgcTrangThaiViec } from "../../api/thueGiaCong";
import { useAuth } from "../../auth/useAuth";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ChipTT } from "../../components/LuoiDs";
import { nhanChang } from "../lsxBuoc";
import { MAU_TRANG_THAI_VIEC, so } from "./tgc";
import "./thue-gia-cong.css";

export function KhoiThueGiaCong({
  ds,
  canHuyTronGoi = false,
  onMoDon,
  onMoHangCho,
  onChanged,
}: {
  ds: TgcTrangThaiViec[];
  canHuyTronGoi?: boolean;
  /** Sang màn Thuê gia công mở đúng đơn. Không truyền = người xem không vào được màn đó. */
  onMoDon?: (donId: number) => void;
  /** Sang màn Thuê gia công, tab Hàng chờ (việc chưa đặt). */
  onMoHangCho?: () => void;
  onChanged?: () => void;
}) {
  const { token } = useAuth();
  const [huy, setHuy] = useState<TgcTrangThaiViec | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (ds.length === 0) return null;

  async function xacNhanHuy() {
    if (!token || !huy) return;
    setBusy(true);
    setErr(null);
    try {
      await tgcApi.huyTronGoi(token, huy.viec_id, { version: huy.version, ly_do: lyDo.trim() });
      setHuy(null);
      setLyDo("");
      onChanged?.();
    } catch (e: unknown) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tgc-khoi" aria-label="Thuê gia công">
      <div className="tgc-khoi__dau">
        <span className="tgc-khoi__tieu-de">Thuê gia công</span>
        <span className="tgc-khoi__phu">Đặt, giao, nhận và trả tiền làm ở màn Thuê gia công</span>
      </div>
      {ds.map((v) => {
        const dv = nhanChang(v.don_vi);
        return (
          <div className="tgc-khoi__dong" key={v.viec_id}>
            <span className="tgc-khoi__viec">
              {v.ten_viec}
              {v.bai_ghep_ma ? <span className="tgc-u">Đi chung bài ghép {v.bai_ghep_ma}</span> : null}
            </span>
            <ChipTT mau={MAU_TRANG_THAI_VIEC[v.trang_thai]}>{v.nhan}</ChipTT>
            {v.nha_cung_cap_ten ? <span className="tgc-khoi__nha">{v.nha_cung_cap_ten}</span> : null}
            {v.sl_can != null ? (
              <span className="tgc-khoi__so">Cần {so(v.sl_can)} {dv}</span>
            ) : null}
            <span className="tgc-khoi__nut">
              {v.don_id != null && v.ma_don ? (
                onMoDon ? (
                  <button type="button" className="tgc-lien-ket" onClick={() => onMoDon(v.don_id as number)}>
                    Đơn {v.ma_don}
                  </button>
                ) : (
                  <span className="tgc-khoi__so">Đơn {v.ma_don}</span>
                )
              ) : onMoHangCho ? (
                <button type="button" className="tgc-lien-ket" onClick={onMoHangCho}>
                  Xem ở Hàng chờ
                </button>
              ) : null}
              {canHuyTronGoi && v.kieu === "tron_goi" && v.trang_thai === "chua_dat" && (
                <Button variant="ghost" onClick={() => { setErr(null); setLyDo(""); setHuy(v); }}>
                  Huỷ trọn gói
                </Button>
              )}
            </span>
          </div>
        );
      })}
      <ConfirmDialog
        open={huy != null}
        title="Huỷ thuê gia công trọn gói?"
        confirmLabel="Huỷ trọn gói"
        danger
        busy={busy}
        error={err}
        confirmDisabled={lyDo.trim().length < 3}
        onConfirm={xacNhanHuy}
        onCancel={() => setHuy(null)}
      >
        <div className="tgc-f">
          <p className="tgc-f__dan">
            Lệnh về Nháp, việc “Gia công trọn gói” rời Hàng chờ. Muốn làm lại thì phát hành lại
            hoặc đặt trọn gói lần nữa.
          </p>
          <label className="tgc-f__o">
            <span className="tgc-f__nhan">Lý do</span>
            <textarea
              rows={2}
              value={lyDo}
              onChange={(e) => setLyDo(e.target.value)}
              placeholder="Ít nhất 3 ký tự"
              aria-label="Lý do huỷ trọn gói"
            />
          </label>
        </div>
      </ConfirmDialog>
    </section>
  );
}

// Ngăn PHIẾU NHẬN gia công (spec 2026-11-13 §4.4): hàng nhận về (đạt, hỏng, nơi về, tạm tính) và đề
// nghị nhập kho đi kèm. Huỷ được khi máy chủ không báo lý do chặn (đã chi tiền, tổ sau đã xác nhận hay
// đã ghi sản lượng, kho đã lập phiếu, dòng đơn đã hoàn tất).
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { tgcApi, type TgcPhieuNhan } from "../../api/thueGiaCong";
import { useAuth } from "../../auth/useAuth";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ChipTT } from "../../components/LuoiDs";
import { NganPhai } from "../ke-toan/shared/NganPhai";
import { ngayDayDu, ngayGioDayDu } from "../loc-san-xuat/ngay";
import { nhanChang } from "../lsxBuoc";
import { NHAN_NOI_VE } from "./PhieuNhanForm";
import { so, tien } from "./tgc";
import "../ke-toan/ke-toan.css";
import "./thue-gia-cong.css";

const NHAN_DE_NGHI: Record<string, string> = {
  draft: "Nháp", pending: "Chờ duyệt", approved: "Chờ kho", received: "Kho đã tiếp nhận",
  preparing: "Kho đang chuẩn bị", partial: "Đã nhập một phần", done: "Đã nhập đủ", cancelled: "Đã huỷ",
  rejected: "Kho từ chối",
};
const NHAN_BAN_GIAO: Record<string, string> = {
  proposed: "Chờ tổ nhận", confirmed: "Tổ đã nhận",
};

type TabPn = "dong" | "de_nghi";

export function PhieuNhanNgan({
  phieuId,
  eventTick,
  canHuy,
  onDong,
  onDoi,
  onMoDon,
  onMoLenh,
  len,
  xuong,
}: {
  phieuId: number;
  eventTick?: number;
  canHuy: boolean;
  onDong: () => void;
  onDoi?: () => void;
  onMoDon?: (donId: number) => void;
  onMoLenh?: (lsxId: number) => void;
  len?: () => void;
  xuong?: () => void;
}) {
  const { token } = useAuth();
  const [pn, setPn] = useState<TgcPhieuNhan | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [tab, setTab] = useState<TabPn>("dong");
  const [hoiHuy, setHoiHuy] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [busy, setBusy] = useState(false);
  const [loiHd, setLoiHd] = useState<string | null>(null);

  const nap = useCallback(() => {
    if (!token) return;
    tgcApi.phieuNhan(token, phieuId).then((p) => { setPn(p); setLoi(null); })
      .catch((e) => setLoi(e instanceof ApiError ? e.message : String(e)));
  }, [token, phieuId]);
  useEffect(() => { nap(); }, [nap, eventTick]);

  if (pn == null) {
    return (
      <NganPhai tieuDe={loi ? "Không mở được phiếu nhận" : "Đang tải phiếu nhận…"} onDong={onDong} len={len} xuong={xuong}>
        {loi ? <p className="lds-do" role="alert">{loi}</p> : null}
      </NganPhai>
    );
  }

  const huy = pn.huy_luc != null;

  async function xacNhanHuy() {
    if (!token || !pn) return;
    setBusy(true);
    setLoiHd(null);
    try {
      setPn(await tgcApi.huyPhieuNhan(token, pn.id, { version: pn.version, ly_do: lyDo.trim() }));
      setHoiHuy(false);
      onDoi?.();
    } catch (e) {
      setLoiHd(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <NganPhai
        duongDan={<>Phiếu nhận</>}
        tieuDe={pn.ma}
        the={huy ? <ChipTT mau="do">Đã huỷ</ChipTT>
          : pn.phieu_chi_ma ? <ChipTT mau="xanh">Đã chi</ChipTT> : <ChipTT mau="la">Còn hiệu lực</ChipTT>}
        phuDe={<span>{pn.nha_cung_cap_ten}</span>}
        hanhDong={canHuy && !huy ? (
          <button type="button" className="kt-btn" disabled={!!pn.ly_do_khong_huy} title={pn.ly_do_khong_huy ?? undefined}
            onClick={() => { setLoiHd(null); setLyDo(""); setHoiHuy(true); }}>Huỷ phiếu</button>
        ) : undefined}
        tomTat={[
          { nhan: "Đơn", giaTri: onMoDon ? <button type="button" className="tgc-lien-ket" onClick={() => onMoDon(pn.don_id)}>{pn.ma_don}</button> : pn.ma_don },
          { nhan: "Nhận lúc", giaTri: ngayGioDayDu(pn.nhan_luc) },
          { nhan: "Người nhận", giaTri: pn.nguoi_nhan_ten ?? "—" },
          { nhan: "Tạm tính", giaTri: tien(pn.tam_tinh) },
          ...(pn.phieu_chi_ma ? [{ nhan: "Phiếu chi", giaTri: pn.phieu_chi_ma }] : []),
          {
            nhan: "Lệnh",
            giaTri: pn.lenh.length === 0 ? "—" : (
              <span className="tgc-dong-lenh">
                {pn.lenh.map((l) => onMoLenh
                  ? <button key={l.lsx_id} type="button" className="tgc-lien-ket" onClick={() => onMoLenh(l.lsx_id)}>{l.lsx_ma}</button>
                  : <span key={l.lsx_id}>{l.lsx_ma}</span>)}
              </span>
            ),
          },
        ]}
        canhBao={huy ? (
          <p className="kt-canh">{`Đã huỷ ${ngayGioDayDu(pn.huy_luc)}${pn.nguoi_huy_ten ? ` bởi ${pn.nguoi_huy_ten}` : ""}. Lý do: ${pn.ly_do_huy ?? ""}`}</p>
        ) : canHuy && pn.ly_do_khong_huy ? (
          <p className="kt-canh">{pn.ly_do_khong_huy}</p>
        ) : undefined}
        tabs={[{ id: "dong", nhan: "Hàng nhận", dem: pn.dong.length }, { id: "de_nghi", nhan: "Đề nghị nhập kho", dem: pn.de_nghi.length }]}
        tab={tab}
        onTab={(t) => setTab(t as TabPn)}
        onDong={onDong}
        len={len}
        xuong={xuong}
      >
        {tab === "dong" && (
          <div className="tgc-ngan-than">
            <table className="tgc-bang">
              <thead>
                <tr><th>Việc</th><th className="n">Đạt</th><th className="n">Hỏng</th><th>Nơi về</th><th className="n">Thành tiền</th></tr>
              </thead>
              <tbody>
                {pn.dong.map((x) => (
                  <tr key={x.id}>
                    <td>{x.ten_viec}</td>
                    <td className="n">{so(x.sl_dat)}<span className="tgc-u">{nhanChang(x.don_vi)}</span></td>
                    <td className="n">{x.sl_hong > 0 ? so(x.sl_hong) : <span className="lds-mu3">—</span>}</td>
                    <td>
                      {x.dich_ten ?? NHAN_NOI_VE[x.noi_ve]}
                      {x.ngay_khach_nhan && <span className="tgc-u">Khách nhận {ngayDayDu(x.ngay_khach_nhan)}</span>}
                      {x.ban_giao_trang_thai && <span className="tgc-u">{NHAN_BAN_GIAO[x.ban_giao_trang_thai] ?? x.ban_giao_trang_thai}</span>}
                    </td>
                    <td className="n">{tien(x.thanh_tien)}<span className="tgc-u">{so(x.don_gia)} đ/{nhanChang(x.don_vi)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pn.ghi_chu && <dl className="tgc-the-dong tgc-ngan-the"><dt>Ghi chú</dt><dd>{pn.ghi_chu}</dd></dl>}
          </div>
        )}
        {tab === "de_nghi" && (
          <div className="tgc-ngan-than">
            {pn.de_nghi.length === 0 ? <p className="tgc-trong">Phiếu này không có hàng về kho.</p> : (
              <table className="tgc-bang">
                <thead><tr><th>Mã đề nghị</th><th>Tình trạng</th></tr></thead>
                <tbody>
                  {pn.de_nghi.map((r) => (
                    <tr key={r.id}>
                      <td>{r.ma}</td>
                      <td>
                        {NHAN_DE_NGHI[r.trang_thai] ?? r.trang_thai}
                        {r.da_lap_phieu && r.trang_thai !== "cancelled" && <span className="tgc-u">Kho đã lập phiếu nhập</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </NganPhai>

      <ConfirmDialog
        open={hoiHuy}
        title={`Huỷ phiếu nhận ${pn.ma}?`}
        confirmLabel="Huỷ phiếu"
        danger
        busy={busy}
        error={loiHd}
        confirmDisabled={lyDo.trim().length < 3}
        onConfirm={xacNhanHuy}
        onCancel={() => setHoiHuy(false)}
      >
        <div className="tgc-f">
          <p className="tgc-f__dan">Số đạt, số hỏng ghi trên công việc bị gỡ; bàn giao sang bước sau và đề nghị nhập kho bị huỷ.</p>
          <label className="tgc-f__o">
            <span className="tgc-f__nhan">Lý do</span>
            <textarea rows={2} value={lyDo} onChange={(e) => setLyDo(e.target.value)} placeholder="Ít nhất 3 ký tự" aria-label="Lý do huỷ phiếu nhận" />
          </label>
        </div>
      </ConfirmDialog>
    </>
  );
}

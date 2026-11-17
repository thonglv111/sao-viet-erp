// Ngăn PHIẾU GIAO gia công (spec 2026-11-13 §4.3): hàng đã giao (bán thành phẩm, vật tư, giấy) và đề
// nghị xuất kho đi kèm. Huỷ được khi kho chưa lập phiếu xuất và chưa nhận hàng về sau phiếu này.
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { tgcApi, type TgcPhieuGiao } from "../../api/thueGiaCong";
import { useAuth } from "../../auth/useAuth";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ChipTT } from "../../components/LuoiDs";
import { nhanKho } from "../../lib/khoGiay";
import { NganPhai } from "../ke-toan/shared/NganPhai";
import { ngayGioDayDu } from "../loc-san-xuat/ngay";
import { nhanChang, nhanDonVi } from "../lsxBuoc";
import { so } from "./tgc";
import "../ke-toan/ke-toan.css";
import "./thue-gia-cong.css";

const NHAN_DE_NGHI: Record<string, string> = {
  draft: "Nháp", pending: "Chờ duyệt", approved: "Chờ kho", received: "Kho đã tiếp nhận",
  preparing: "Kho đang chuẩn bị", partial: "Đã xuất một phần", done: "Đã xuất đủ", cancelled: "Đã huỷ",
  rejected: "Kho từ chối",
};

type TabPg = "dong" | "de_nghi";

export function PhieuGiaoNgan({
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
  const [pg, setPg] = useState<TgcPhieuGiao | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [tab, setTab] = useState<TabPg>("dong");
  const [hoiHuy, setHoiHuy] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [busy, setBusy] = useState(false);
  const [loiHd, setLoiHd] = useState<string | null>(null);

  const nap = useCallback(() => {
    if (!token) return;
    tgcApi.phieuGiao(token, phieuId).then((p) => { setPg(p); setLoi(null); })
      .catch((e) => setLoi(e instanceof ApiError ? e.message : String(e)));
  }, [token, phieuId]);
  useEffect(() => { nap(); }, [nap, eventTick]);

  if (pg == null) {
    return (
      <NganPhai tieuDe={loi ? "Không mở được phiếu giao" : "Đang tải phiếu giao…"} onDong={onDong} len={len} xuong={xuong}>
        {loi ? <p className="lds-do" role="alert">{loi}</p> : null}
      </NganPhai>
    );
  }

  const huy = pg.huy_luc != null;
  const kd = pg.de_nghi.some((r) => r.da_lap_phieu && r.trang_thai !== "cancelled");
  const btp = pg.dong.filter((x) => x.loai === "ban_thanh_pham");
  const vt = pg.dong.filter((x) => x.loai === "vat_tu");

  async function xacNhanHuy() {
    if (!token || !pg) return;
    setBusy(true);
    setLoiHd(null);
    try {
      setPg(await tgcApi.huyPhieuGiao(token, pg.id, { version: pg.version, ly_do: lyDo.trim() }));
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
        duongDan={<>Phiếu giao</>}
        tieuDe={pg.ma}
        the={huy ? <ChipTT mau="do">Đã huỷ</ChipTT> : <ChipTT mau="la">Còn hiệu lực</ChipTT>}
        phuDe={<span>{pg.nha_cung_cap_ten}</span>}
        hanhDong={canHuy && !huy && !kd ? (
          <button type="button" className="kt-btn" onClick={() => { setLoiHd(null); setLyDo(""); setHoiHuy(true); }}>Huỷ phiếu</button>
        ) : undefined}
        tomTat={[
          { nhan: "Đơn", giaTri: onMoDon ? <button type="button" className="tgc-lien-ket" onClick={() => onMoDon(pg.don_id)}>{pg.ma_don}</button> : pg.ma_don },
          { nhan: "Giao lúc", giaTri: ngayGioDayDu(pg.giao_luc) },
          { nhan: "Người giao", giaTri: pg.nguoi_giao_ten ?? "—" },
          {
            nhan: "Lệnh",
            giaTri: pg.lenh.length === 0 ? "—" : (
              <span className="tgc-dong-lenh">
                {pg.lenh.map((l) => onMoLenh
                  ? <button key={l.lsx_id} type="button" className="tgc-lien-ket" onClick={() => onMoLenh(l.lsx_id)}>{l.lsx_ma}</button>
                  : <span key={l.lsx_id}>{l.lsx_ma}</span>)}
              </span>
            ),
          },
        ]}
        canhBao={huy ? (
          <p className="kt-canh">{`Đã huỷ ${ngayGioDayDu(pg.huy_luc)}${pg.nguoi_huy_ten ? ` bởi ${pg.nguoi_huy_ten}` : ""}. Lý do: ${pg.ly_do_huy ?? ""}`}</p>
        ) : kd ? (
          <p className="kt-canh">Kho đã lập phiếu xuất nên không huỷ phiếu giao được. Vật tư dư trả kho lúc hoàn tất dòng đơn.</p>
        ) : undefined}
        tabs={[{ id: "dong", nhan: "Hàng giao", dem: pg.dong.length }, { id: "de_nghi", nhan: "Đề nghị xuất kho", dem: pg.de_nghi.length }]}
        tab={tab}
        onTab={(t) => setTab(t as TabPg)}
        onDong={onDong}
        len={len}
        xuong={xuong}
      >
        {tab === "dong" && (
          <div className="tgc-ngan-than">
            {btp.length > 0 && (
              <table className="tgc-bang">
                <thead><tr><th>Bán thành phẩm</th><th className="n">Số lượng</th><th>Nguồn</th></tr></thead>
                <tbody>
                  {btp.map((x) => (
                    <tr key={x.id}>
                      <td>{x.ten_viec}</td>
                      <td className="n">{so(x.so_luong)}<span className="tgc-u">{nhanChang(x.don_vi)}</span></td>
                      <td>{x.tu_ban_giao ? "Bàn giao của tổ bước trước" : "Gõ tay (đầu lệnh)"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {vt.length > 0 && (
              <table className="tgc-bang">
                <thead><tr><th>Vật tư, giấy</th><th>Cho việc</th><th className="n">Số lượng</th></tr></thead>
                <tbody>
                  {vt.map((x) => (
                    <tr key={x.id}>
                      <td>{x.ten_hang ?? "—"}{x.kho_rong > 0 && <span className="tgc-u">Khổ {nhanKho(x.kho_rong, x.kho_dai)}</span>}</td>
                      <td>{x.ten_viec}</td>
                      <td className="n">{so(x.so_luong)}<span className="tgc-u">{nhanDonVi(x.don_vi)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pg.ghi_chu && <dl className="tgc-the-dong tgc-ngan-the"><dt>Ghi chú</dt><dd>{pg.ghi_chu}</dd></dl>}
          </div>
        )}
        {tab === "de_nghi" && (
          <div className="tgc-ngan-than">
            {pg.de_nghi.length === 0 ? <p className="tgc-trong">Phiếu này không xin xuất vật tư nào.</p> : (
              <table className="tgc-bang">
                <thead><tr><th>Mã đề nghị</th><th>Tình trạng</th></tr></thead>
                <tbody>
                  {pg.de_nghi.map((r) => (
                    <tr key={r.id}>
                      <td>{r.ma}</td>
                      <td>
                        {NHAN_DE_NGHI[r.trang_thai] ?? r.trang_thai}
                        {r.da_lap_phieu && r.trang_thai !== "cancelled" && <span className="tgc-u">Kho đã lập phiếu xuất</span>}
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
        title={`Huỷ phiếu giao ${pg.ma}?`}
        confirmLabel="Huỷ phiếu"
        danger
        busy={busy}
        error={loiHd}
        confirmDisabled={lyDo.trim().length < 3}
        onConfirm={xacNhanHuy}
        onCancel={() => setHoiHuy(false)}
      >
        <div className="tgc-f">
          <p className="tgc-f__dan">Bàn giao của tổ bước trước quay về chờ giao, đề nghị xuất kho bị huỷ.</p>
          <label className="tgc-f__o">
            <span className="tgc-f__nhan">Lý do</span>
            <textarea rows={2} value={lyDo} onChange={(e) => setLyDo(e.target.value)} placeholder="Ít nhất 3 ký tự" aria-label="Lý do huỷ phiếu giao" />
          </label>
        </div>
      </ConfirmDialog>
    </>
  );
}

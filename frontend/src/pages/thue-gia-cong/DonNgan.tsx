// Ngăn ĐƠN GIA CÔNG (spec 2026-11-13 §4.2): đầu ngăn mã, nhà gia công, trạng thái; bốn tab Dòng đơn /
// Phiếu giao / Phiếu nhận / Lịch sử. Kéo mép trái đổi độ rộng (vỏ NganPhai). Nút theo trạng thái:
// Nháp ⇒ Sửa, Đặt hàng; Đã đặt ⇒ Sửa (hẹn về, ghi chú, số, giá), Giao hàng, Nhận hàng, Hoàn tất từng
// dòng; Huỷ đơn khi chưa có phiếu sống.
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { tgcApi, type TgcDon, type TgcDonDong } from "../../api/thueGiaCong";
import { useAuth } from "../../auth/useAuth";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ChipTT } from "../../components/LuoiDs";
import { NganPhai } from "../ke-toan/shared/NganPhai";
import { ngayDayDu, ngayGioDayDu } from "../loc-san-xuat/ngay";
import { nhanChang } from "../lsxBuoc";
import { DonForm } from "./DonForm";
import { HoanTatDialog } from "./HoanTatDialog";
import { PhieuGiaoForm } from "./PhieuGiaoForm";
import { PhieuNhanForm } from "./PhieuNhanForm";
import { MAU_TRANG_THAI_DON, NHAN_TRANG_THAI_DON, so, tien } from "./tgc";
import "../ke-toan/ke-toan.css";
import "./thue-gia-cong.css";

type TabDon = "dong" | "giao" | "nhan" | "lich_su";

export function DonNgan({
  donId,
  eventTick,
  canSua,
  canDat,
  canHuy,
  canGiao,
  onDong,
  onDoi,
  onMoLenh,
  onMoPhieuGiao,
  onMoPhieuNhan,
  len,
  xuong,
}: {
  donId: number;
  eventTick?: number;
  canSua: boolean;
  canDat: boolean;
  canHuy: boolean;
  /** Quyền lập phiếu giao (`thue_gia_cong:create`). */
  canGiao: boolean;
  onDong: () => void;
  /** Đơn vừa đổi (đặt, sửa, huỷ) — danh sách nạp lại. */
  onDoi?: () => void;
  onMoLenh?: (lsxId: number) => void;
  onMoPhieuGiao?: (id: number) => void;
  onMoPhieuNhan?: (id: number) => void;
  len?: () => void;
  xuong?: () => void;
}) {
  const { token } = useAuth();
  const [don, setDon] = useState<TgcDon | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [tab, setTab] = useState<TabDon>("dong");
  const [moSua, setMoSua] = useState(false);
  const [moGiao, setMoGiao] = useState(false);
  const [moNhan, setMoNhan] = useState(false);
  const [hoanTat, setHoanTat] = useState<TgcDonDong | null>(null);
  const [moLai, setMoLai] = useState<TgcDonDong | null>(null);
  const [hoiDat, setHoiDat] = useState(false);
  const [hoiHuy, setHoiHuy] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [busy, setBusy] = useState(false);
  const [loiHd, setLoiHd] = useState<string | null>(null);

  const nap = useCallback(() => {
    if (!token) return;
    tgcApi.don(token, donId).then((d) => { setDon(d); setLoi(null); })
      .catch((e) => setLoi(e instanceof ApiError ? e.message : String(e)));
  }, [token, donId]);
  useEffect(() => { nap(); }, [nap, eventTick]);

  async function chay(fn: () => Promise<TgcDon>, dong: () => void) {
    setBusy(true);
    setLoiHd(null);
    try {
      setDon(await fn());
      dong();
      onDoi?.();
    } catch (e) {
      setLoiHd(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (don == null) {
    return (
      <NganPhai tieuDe={loi ? "Không mở được đơn" : "Đang tải đơn…"} onDong={onDong} len={len} xuong={xuong}>
        {loi ? <p className="lds-do" role="alert">{loi}</p> : null}
      </NganPhai>
    );
  }

  const huy = don.trang_thai === "huy";
  const dongSong = don.dong.filter((d) => d.huy_luc == null || huy);
  const giaoDuoc = ["da_dat", "giao_mot_phan", "giao_du", "ve_mot_phan"].includes(don.trang_thai);
  // Nhận hàng: ai mở được đơn cũng thử được — máy chủ lọc dòng theo quyền (tổ bước sau tự nhận về xưởng).
  const nhanDuoc = giaoDuoc && dongSong.some((d) => d.hoan_tat_luc == null);
  // Có dòng nào nhận về được chưa: trọn gói nhận lúc nào cũng được, gia công một phần phải giao rồi
  // (cùng luật `ly_do_khong_nhan` của phieu_nhan.du_lieu_moi). Chưa thì nút mờ kèm lý do (16/11/2026).
  const coGiDeNhan = dongSong.some((d) => d.hoan_tat_luc == null && (d.kieu === "tron_goi" || d.co_giao));
  const moPhieu = tab === "giao" ? onMoPhieuGiao : onMoPhieuNhan;
  const coPhieuSong = don.phieu_giao.some((p) => p.huy_luc == null) || don.phieu_nhan.some((p) => p.huy_luc == null);
  const tabs = [
    { id: "dong", nhan: "Dòng đơn", dem: dongSong.length },
    { id: "giao", nhan: "Phiếu giao", dem: don.phieu_giao.length },
    { id: "nhan", nhan: "Phiếu nhận", dem: don.phieu_nhan.length },
    { id: "lich_su", nhan: "Lịch sử" },
  ];

  return (
    <>
      <NganPhai
        duongDan={<>Đơn gia công</>}
        tieuDe={don.ma}
        the={<ChipTT mau={MAU_TRANG_THAI_DON[don.trang_thai]}>{NHAN_TRANG_THAI_DON[don.trang_thai]}</ChipTT>}
        phuDe={<span>{don.nha_cung_cap_ten}</span>}
        hanhDong={
          <>
            {/* Không còn gì phải mang sang (trọn gói nhà gia công tự lo giấy, không vật tư xưởng cấp):
                nút mờ kèm lý do, thay vì mở một hộp trống (16/11/2026). */}
            {canGiao && giaoDuoc && (
              <button type="button" className="kt-btn kt-btn--chinh" disabled={don.co_gi_de_giao === false}
                title={don.co_gi_de_giao === false
                  ? "Nhà gia công tự lo hết, xưởng không phải giao gì cho đơn này" : undefined}
                onClick={() => setMoGiao(true)}>Giao hàng</button>
            )}
            {nhanDuoc && (
              <button type="button" className="kt-btn kt-btn--chinh" disabled={!coGiDeNhan}
                title={!coGiDeNhan ? "Chưa giao hàng cho nhà gia công nên chưa có gì để nhận về" : undefined}
                onClick={() => setMoNhan(true)}>Nhận hàng</button>
            )}
            {canSua && !huy && don.trang_thai !== "hoan_tat" && (
              <button type="button" className="kt-btn" onClick={() => setMoSua(true)}>Sửa</button>
            )}
            {canDat && don.trang_thai === "nhap" && (
              <button type="button" className="kt-btn kt-btn--chinh" onClick={() => { setLoiHd(null); setHoiDat(true); }}>
                Đặt hàng
              </button>
            )}
            {canHuy && !huy && !coPhieuSong && (
              <button type="button" className="kt-btn" onClick={() => { setLoiHd(null); setLyDo(""); setHoiHuy(true); }}>
                Huỷ đơn
              </button>
            )}
          </>
        }
        tomTat={[
          { nhan: "Ngày đặt", giaTri: ngayDayDu(don.ngay_dat) },
          { nhan: "Hẹn về", giaTri: don.ngay_hen_ve ? ngayDayDu(don.ngay_hen_ve) : "Chưa hẹn" },
          { nhan: "Tổng tạm tính", giaTri: tien(don.tong_tien_dat) },
          { nhan: "Đã nhận tạm tính", giaTri: tien(don.tam_tinh_da_nhan) },
        ]}
        canhBao={huy ? (
          <p className="kt-canh">{`Đã huỷ ${ngayGioDayDu(don.huy_luc)}${don.nguoi_huy_ten ? ` bởi ${don.nguoi_huy_ten}` : ""}. Lý do: ${don.ly_do_huy ?? ""}`}</p>
        ) : undefined}
        tabs={tabs}
        tab={tab}
        onTab={(t) => setTab(t as TabDon)}
        onDong={onDong}
        len={len}
        xuong={xuong}
      >
        {tab === "dong" && (
          <div className="tgc-ngan-than">
            {/* Mỗi dòng đơn một khối thay cho bảng 8 cột (16/11/2026): ngăn hẹp nên bảng cũ phải cuộn ngang,
                cuộn rồi thì mất cột Việc, Lệnh. Đầu khối: việc, kiểu, lệnh, nút Hoàn tất. Thân: các số, mỗi số
                có nhãn riêng và đơn vị. Trọn gói không có bán thành phẩm đi về nên bỏ Đã giao, Còn ở ngoài. */}
            {dongSong.map((d) => {
              const dv = nhanChang(d.don_vi);
              const tronGoi = d.kieu === "tron_goi";
              return (
                <section key={d.id} className="tgc-pg-khoi tgc-dd" aria-label={d.ten_viec}>
                  <header className="tgc-dd__dau">
                    <div className="tgc-dd__viec">
                      <span className="tgc-dd__ten">
                        {d.ten_viec}
                        <span className="tgc-the">
                          {tronGoi ? "Trọn gói" : d.bai_ghep_ma ? `Bài ghép ${d.bai_ghep_ma}` : "Một phần"}
                        </span>
                        {d.hoan_tat_luc && <span className="tgc-u tgc-dd__xong">Hoàn tất {ngayDayDu(d.hoan_tat_luc)}</span>}
                      </span>
                      {d.lenh.map((l) => (
                        <span key={l.lsx_id} className="tgc-dd__lenh">
                          {onMoLenh ? (
                            <button type="button" className="tgc-lien-ket" onClick={() => onMoLenh(l.lsx_id)}>{l.lsx_ma}</button>
                          ) : l.lsx_ma}
                          {l.han_giao && <span className="tgc-u tgc-dd__han">Hạn {ngayDayDu(l.han_giao)}</span>}
                          <span className="tgc-u tgc-dd__khach" title={`${l.khach_hang}\n${l.mat_hang}\nĐơn hàng ${l.don_hang_ma}`}>
                            {l.khach_hang || l.mat_hang}
                          </span>
                        </span>
                      ))}
                    </div>
                    {canSua && don.dat_luc && !huy && (
                      <div className="tgc-dd__nut">
                        {d.hoan_tat_luc == null ? (
                          <button type="button" className="kt-btn" disabled={!!d.ly_do_khong_hoan_tat}
                            title={d.ly_do_khong_hoan_tat ?? "Không chờ thêm hàng: chốt hao hụt, trả vật tư dư, bước chuyển Hoàn thành"}
                            onClick={() => setHoanTat(d)}>Hoàn tất</button>
                        ) : (
                          <button type="button" className="kt-btn" disabled={!!d.ly_do_khong_mo_lai}
                            title={d.ly_do_khong_mo_lai ?? "Mở lại để nhận thêm hàng"}
                            onClick={() => { setLoiHd(null); setMoLai(d); }}>Mở lại</button>
                        )}
                      </div>
                    )}
                  </header>
                  <dl className="tgc-dd__so">
                    <div>
                      <dt>Số đặt</dt>
                      <dd>{so(d.sl_dat)} <span className="tgc-dd__dv">{dv}</span></dd>
                    </div>
                    <div>
                      <dt>Đơn giá</dt>
                      <dd>{tien(d.don_gia)}<span className="tgc-u">Thành tiền {tien(d.thanh_tien_dat)}</span></dd>
                    </div>
                    {!tronGoi && (
                      <div>
                        <dt>Đã giao</dt>
                        <dd>
                          {d.da_giao > 0
                            ? <>{so(d.da_giao)} <span className="tgc-dd__dv">{nhanChang(d.don_vi_giao)}</span></>
                            : <span className="lds-mu3">Chưa giao</span>}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Đã nhận</dt>
                      <dd>
                        {d.dat + d.hong > 0
                          ? <>{so(d.dat)} <span className="tgc-dd__dv">{dv}</span></>
                          : <span className="lds-mu3">Chưa nhận</span>}
                        {d.hong > 0 && <span className="tgc-u">Hỏng {so(d.hong)} {dv}</span>}
                        {d.hao_hut != null && d.hao_hut > 0 && <span className="tgc-u">Hụt {so(d.hao_hut)} {dv}</span>}
                      </dd>
                    </div>
                    {!tronGoi && (
                      <div>
                        <dt>Còn ở ngoài</dt>
                        <dd>
                          {d.con_ngoai > 0
                            ? <>{so(d.con_ngoai)} <span className="tgc-dd__dv">{dv}</span></>
                            : <span className="lds-mu3">Không còn</span>}
                        </dd>
                      </div>
                    )}
                  </dl>
                </section>
              );
            })}
            <dl className="tgc-the-dong tgc-ngan-the">
              <dt>Người lập</dt>
              <dd>{don.nguoi_tao_ten ?? "—"}<span className="tgc-u">{ngayGioDayDu(don.created_at)}</span></dd>
              <dt>Người đặt</dt>
              <dd>
                {don.dat_luc ? <>{don.nguoi_dat_ten ?? "—"}<span className="tgc-u">{ngayGioDayDu(don.dat_luc)}</span></> : "Chưa đặt"}
              </dd>
              {don.ghi_chu && (<><dt>Ghi chú</dt><dd>{don.ghi_chu}</dd></>)}
            </dl>
          </div>
        )}
        {(tab === "giao" || tab === "nhan") && (
          <div className="tgc-ngan-than">
            {(tab === "giao" ? don.phieu_giao : don.phieu_nhan).length === 0 ? (
              <p className="tgc-trong">
                {tab === "giao" ? "Chưa có phiếu giao nào cho đơn này." : "Chưa nhận hàng về lần nào."}
              </p>
            ) : (
              <table className="tgc-bang">
                <thead>
                  <tr><th>Mã phiếu</th><th>{tab === "giao" ? "Giao lúc" : "Nhận lúc"}</th><th>Người lập</th><th>Tình trạng</th></tr>
                </thead>
                <tbody>
                  {(tab === "giao" ? don.phieu_giao : don.phieu_nhan).map((p) => (
                    <tr key={p.id}
                      className={moPhieu ? "lds-dong lds-dong--bam" : undefined}
                      tabIndex={moPhieu ? 0 : undefined}
                      onClick={moPhieu ? () => moPhieu(p.id) : undefined}
                      onKeyDown={moPhieu ? (e) => { if (e.key === "Enter") moPhieu(p.id); } : undefined}>
                      <td>{p.ma}</td>
                      <td>{ngayGioDayDu(p.luc)}</td>
                      <td>{p.nguoi_ten ?? "—"}</td>
                      <td>{p.huy_luc ? <ChipTT mau="do">Đã huỷ</ChipTT> : <ChipTT mau="la">Còn hiệu lực</ChipTT>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {tab === "lich_su" && (
          <div className="tgc-ngan-than">
            {don.lich_su.length === 0 ? <p className="tgc-trong">Chưa có nhật ký.</p> : (
              <ol className="tgc-lich-su">
                {don.lich_su.map((x) => (
                  <li key={x.id}>
                    <span className="tgc-lich-su__dau">
                      <span>{x.hanh_dong}</span>
                      <span className="tgc-u">{ngayGioDayDu(x.luc)}</span>
                      {x.nguoi_ten && <span className="tgc-u">{x.nguoi_ten}</span>}
                    </span>
                    {x.chi_tiet && <span className="tgc-lich-su__ct">{x.chi_tiet}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </NganPhai>

      {moGiao && (
        <PhieuGiaoForm donId={don.id} onClose={() => setMoGiao(false)}
          onDone={(pg) => { setMoGiao(false); nap(); onDoi?.(); onMoPhieuGiao?.(pg.id); }} />
      )}
      {moNhan && (
        <PhieuNhanForm donId={don.id} onClose={() => setMoNhan(false)}
          onDone={(pn) => { setMoNhan(false); nap(); onDoi?.(); onMoPhieuNhan?.(pn.id); }} />
      )}
      {hoanTat && (
        <HoanTatDialog don={don} dong={hoanTat} onClose={() => setHoanTat(null)}
          onDone={() => { setHoanTat(null); nap(); onDoi?.(); }} />
      )}
      <ConfirmDialog
        open={moLai != null}
        title={`Mở lại ${moLai?.ten_viec ?? ""}?`}
        message="Bước quay về đang làm để nhận thêm hàng; đề nghị nhập vật tư trả kho (nếu có) bị huỷ."
        confirmLabel="Mở lại"
        busy={busy}
        error={loiHd}
        onConfirm={async () => {
          if (!token || !moLai) return;
          setBusy(true);
          setLoiHd(null);
          try {
            await tgcApi.moHoanTat(token, moLai.id, don.version);
            setMoLai(null);
            nap();
            onDoi?.();
          } catch (e) {
            setLoiHd(e instanceof ApiError ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
        onCancel={() => setMoLai(null)}
      />
      {moSua && (
        <DonForm don={don} onClose={() => setMoSua(false)}
          onDone={(d) => { setDon(d); setMoSua(false); onDoi?.(); }} />
      )}
      <ConfirmDialog
        open={hoiDat}
        title={`Đặt đơn ${don.ma} với ${don.nha_cung_cap_ten}?`}
        message="Đặt xong thì không đổi nhà gia công hay ngày đặt; vẫn sửa được hẹn về, số đặt và đơn giá."
        confirmLabel="Đặt hàng"
        busy={busy}
        error={loiHd}
        onConfirm={() => token && chay(() => tgcApi.datDon(token, don.id, don.version), () => setHoiDat(false))}
        onCancel={() => setHoiDat(false)}
      />
      <ConfirmDialog
        open={hoiHuy}
        title={`Huỷ đơn ${don.ma}?`}
        confirmLabel="Huỷ đơn"
        danger
        busy={busy}
        error={loiHd}
        confirmDisabled={lyDo.trim().length < 3}
        onConfirm={() => token && chay(() => tgcApi.huyDon(token, don.id, { version: don.version, ly_do: lyDo.trim() }), () => setHoiHuy(false))}
        onCancel={() => setHoiHuy(false)}
      >
        <div className="tgc-f">
          <p className="tgc-f__dan">Các việc trong đơn quay lại Hàng chờ để đặt nhà khác.</p>
          <label className="tgc-f__o">
            <span className="tgc-f__nhan">Lý do</span>
            <textarea rows={2} value={lyDo} onChange={(e) => setLyDo(e.target.value)}
              placeholder="Ít nhất 3 ký tự" aria-label="Lý do huỷ đơn" />
          </label>
        </div>
      </ConfirmDialog>
    </>
  );
}

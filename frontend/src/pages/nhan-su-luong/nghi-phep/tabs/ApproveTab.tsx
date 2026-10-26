// Tab "Duyệt đơn" (HR) (tách từ pages/NghiPhepPage.tsx).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type LeaveRequest, type XinHuyChoDuyet } from "../../../../api/client";
import { trangHopLe } from "../../../../components/Pager";
import { PhanTrangDayDu } from "../../../../components/PhanTrangDayDu";
import { ThanhLoc } from "../../../thanh-loc/ThanhLoc";
import { thamSoKy } from "../../../thanh-loc/ky-danh-sach";
import { soDaAp } from "../../../thanh-loc/thanh-loc";
import { dkTabDon, mucLocNhanh, tabTrangThai, useLocTab } from "../../dieu-kien-don";
import { ChonCot, LocNhanhTrangThai, useCauHinhLuoi } from "../../../../components/LuoiDs";
import {
  LOC_NP_TRONG,
  MAN_NGHI_PHEP,
  MOC_NP,
  locNghiPhepLenUrl,
  locNghiPhepTuUrl,
  thamSoLocNghiPhep,
  useDieuKienDuyetNghi,
  type LocNghiPhep,
} from "../dieu-kien-nghi-phep";
import { fmtDate } from "../../../../utils/format";
import { cotDonNghi, LeaveTable } from "../components/LeaveTable";
import { PAGE_SIZE } from "../shared/constants";
import { errMsg } from "../shared/helpers";
import { LyDoDialog, XinHuyHangDoi } from "../../xin-huy/XinHuy";

/** Tóm tắt một đơn nghỉ cho hàng đợi xin hủy / hộp thoại. */
const tomTat = (r: LeaveRequest) =>
  `${r.leave_type_name ?? "Nghỉ"} · ${fmtDate(r.start_date)}–${fmtDate(r.end_date)} (${r.days} ngày)`;

// --- Tab: Duyệt đơn (HR) ----------------------------------------------------

export function ApproveTab({ token, dau, onChanged, focusEmployeeId, eventTick }: {
  token: string; onChanged?: () => void; focusEmployeeId?: number;
  /** Hàng đầu màn do trang dựng; phần này chỉ gài nút chính vào bên phải. */
  dau: (phai?: ReactNode) => ReactNode;
  /** Nhích theo mỗi sự kiện real-time — thợ gửi đơn / xin hủy là hàng đợi tự tươi (23/09/2026). */
  eventTick?: number;
}) {
  const [items, setItems] = useState<LeaveRequest[]>([]);
  const [total, setTotal] = useState(0);
  const luoi = useCauHinhLuoi("nghi-phep-duyet");
  const [dem, setDem] = useState<Record<string, number> | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(PAGE_SIZE);
  // Kỳ (Ngày tạo / Ngày nghỉ) + trạng thái (thanh tab có số) + Loại nghỉ, Nhân viên, Phòng ban —
  // lọc, đếm, phân trang ở MÁY CHỦ (06/10/2026). ĐỔI LỌC ⇒ VỀ TRANG 1 ngay trong `setLocTab`
  // (không qua effect): làm ở effect thì lượt tải cũ bắn đi với số trang cũ rồi mới tới lượt mới.
  const [locTab, setLocTabGoc] = useLocTab<LocNghiPhep>({
    man: MAN_NGHI_PHEP, tienToUrl: "dy", moc: MOC_NP, mocMacDinh: "tao", ttMacDinh: "pending",
    locTrong: LOC_NP_TRONG, locTuUrl: locNghiPhepTuUrl, locLenUrl: locNghiPhepLenUrl,
  });
  const setLocTab = (t: typeof locTab) => { setLocTabGoc(t); setPage(1); };
  const dieuKien = useDieuKienDuyetNghi();
  // Liên thông từ Hồ sơ NV: áp điều kiện Nhân viên + xem TẤT CẢ trạng thái (không chỉ chờ duyệt).
  useEffect(() => {
    if (focusEmployeeId) setLocTab({ ...locTab, tt: "", loc: { ...locTab.loc, nv: focusEmployeeId } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEmployeeId]);
  const status = locTab.tt;
  const coLoc = locTab.ky.loai !== "tat_ca" || soDaAp(dieuKien, locTab.loc) > 0;
  const khoaLoc = JSON.stringify({
    ...thamSoKy(locTab.ky),
    ...thamSoLocNghiPhep(locTab.loc),
    status: status || undefined,
  });
  const luotTai = useRef(0);
  const [sel, setSel] = useState<Set<number>>(new Set());
  // Từ chối: đơn lẻ (LeaveRequest) HOẶC hàng loạt ("bulk") — cùng 1 modal, 1 lý do.
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | "bulk" | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [busy, setBusy] = useState(false);
  /** Lỗi THAO TÁC (duyệt / từ chối) — hiện trong hộp thoại từ chối. */
  const [error, setError] = useState<string | null>(null);
  /** Lỗi TẢI hàng đợi — ô nhớ RIÊNG, chỉ nó mới được thay chỗ của bảng. */
  const [listError, setListError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  // Yêu cầu HỦY đơn đã duyệt đang chờ trong phạm vi (23/09/2026) — tải riêng, lỗi thì chỉ khối này trống.
  const [xinHuy, setXinHuy] = useState<XinHuyChoDuyet<LeaveRequest>[]>([]);
  // Người duyệt hủy thẳng đơn ĐÃ DUYỆT — bắt buộc ghi lý do để người lao động biết.
  const [huyDon, setHuyDon] = useState<LeaveRequest | null>(null);
  const [huyBusy, setHuyBusy] = useState(false);
  const [huyErr, setHuyErr] = useState<string | null>(null);
  const loadXinHuy = useCallback(() => {
    api.leaves.xinHuyChoDuyet(token).then((r) => setXinHuy(r.items)).catch(() => setXinHuy([]));
  }, [token]);
  useEffect(() => { loadXinHuy(); }, [loadXinHuy, eventTick]);
  const load = useCallback(() => {
    const luot = ++luotTai.current;
    setLoadingList(true);
    setListError(null);
    // MỌI điều kiện (kể cả 1 nhân viên liên thông từ Hồ sơ NV) lọc Ở MÁY CHỦ — lọc trên mảng đã
    // tải + phân trang thì đơn nằm ở trang khác là màn báo "chưa có đơn" sai sự thật.
    api.leaves.list(token, { ...JSON.parse(khoaLoc), page, size })
      .then((r) => {
        if (luot !== luotTai.current) return;
        setItems(r.items);
        setTotal(r.total);
        setDem(r.dem_theo_tab ?? null);
        setSel(new Set());
        const trangCanVe = trangHopLe(page, r.total, size);
        if (trangCanVe !== null) setPage(trangCanVe);
      })
      .catch((e) => { if (luot === luotTai.current) { setItems([]); setTotal(0); setListError(errMsg(e)); } })
      .finally(() => { if (luot === luotTai.current) setLoadingList(false); });
  }, [token, khoaLoc, page, size]);
  useEffect(() => { load(); }, [load, eventTick]);

  const shown = items;
  // ⚠ CHỈ id chờ duyệt CỦA TRANG ĐANG XEM. "Chọn tất cả" và các nút hàng loạt vì thế cũng chỉ
  // tác động trong phạm vi trang này — chân bảng nói rõ điều đó cho người duyệt biết.
  const pendingIds = shown.filter((i) => i.status === "pending" && i.duyet_duoc !== false).map((i) => i.id);
  const selArr = [...sel];
  function toggle(id: number) { setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleAll() { setSel((s) => (s.size === pendingIds.length && pendingIds.length > 0 ? new Set() : new Set(pendingIds))); }

  /** Lỗi của nút Duyệt trên từng dòng — trước đây lỗi rơi im lặng (promise không ai bắt), người
   *  duyệt tưởng đã duyệt xong. Nút cũng chặn bấm đúp trong lúc đang gửi. */
  const [loiDuyet, setLoiDuyet] = useState<string | null>(null);
  async function approve(id: number) {
    if (busy) return;
    setBusy(true); setLoiDuyet(null);
    try { await api.leaves.approve(token, id); load(); onChanged?.(); }
    catch (e) { setLoiDuyet(errMsg(e)); load(); }
    finally { setBusy(false); }
  }
  async function quyetXinHuy(ycId: number, dongY: boolean, ghiChu: string) {
    await api.leaves.quyetXinHuy(token, ycId, dongY, ghiChu || undefined);
    loadXinHuy(); load(); onChanged?.();
  }
  async function huyThang(lyDo: string) {
    if (!huyDon) return;
    setHuyBusy(true); setHuyErr(null);
    try {
      await api.leaves.cancel(token, huyDon.id, lyDo);
      setHuyDon(null); loadXinHuy(); load(); onChanged?.();
    } catch (e) { setHuyErr(errMsg(e)); } finally { setHuyBusy(false); }
  }
  async function bulkApprove() {
    setBusy(true);
    setLoiDuyet(null);
    // Lỗi duyệt hàng loạt hiện ở băng trên bảng — `error` chỉ hiện trong hộp thoại Từ chối (đang đóng).
    try { await api.leaves.bulkApprove(token, selArr); load(); onChanged?.(); }
    catch (e) { setLoiDuyet(errMsg(e)); load(); } finally { setBusy(false); }
  }
  async function confirmReject() {
    if (!rejectNote.trim()) return;
    setBusy(true); setError(null);
    try {
      if (rejectTarget === "bulk") await api.leaves.bulkReject(token, selArr, rejectNote.trim());
      else if (rejectTarget) await api.leaves.reject(token, rejectTarget.id, rejectNote.trim());
      setRejectTarget(null); setRejectNote(""); load(); onChanged?.();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <>
      {dau()}
      <section className="lds-loc">
        <LocNhanhTrangThai dang={status} onChon={(tt) => setLocTab({ ...locTab, tt })} muc={mucLocNhanh(dem)} />
        <div className="lds-loc__thanh tl-thanh">
          <ThanhLoc
            ky={locTab.ky}
            moc={MOC_NP}
            onKy={(ky) => setLocTab({ ...locTab, ky })}
            dieuKien={dkTabDon(dieuKien, tabTrangThai(dem))}
            loc={locTab}
            onLoc={setLocTab}
          />
          <ChonCot cot={cotDonNghi({ selectable: true, showEmployee: true, nguoiDuyet: true })} {...luoi.chonCot} />
        </div>
      </section>
      {sel.size > 0 && (
        <div className="cc-bulk-actions-floating">
          <span className="cc-bulk-label">{sel.size} đơn đã chọn</span>
          <div className="cc-bulk-btn-group">
            <button className="btn btn--primary cc-btn-approve" onClick={bulkApprove} disabled={busy}>✓ Duyệt {sel.size}</button>
            <button className="btn btn--ghost cc-btn-reject" onClick={() => { setRejectTarget("bulk"); setRejectNote(""); setError(null); }} disabled={busy}>✕ Từ chối {sel.size}</button>
            <button className="btn btn--ghost" onClick={() => setSel(new Set())} disabled={busy}>Bỏ chọn</button>
          </div>
        </div>
      )}
      {/* Xin hủy đơn đã duyệt (23/09/2026): đứng TRÊN bảng — đơn vẫn hiệu lực tới khi quyết, để lâu
          là tổ trưởng xếp người theo một kế hoạch có thể đã đổi. */}
      <XinHuyHangDoi
        donVi="đơn"
        dong={xinHuy.map((x) => ({
          yc: x.yeu_cau,
          ten: x.don.employee_name ?? `NV#${x.don.employee_id}`,
          don: tomTat(x.don),
        }))}
        onQuyet={(yc, dongY, ghiChu) => quyetXinHuy(yc.id, dongY, ghiChu)}
      />
      {loiDuyet && (
        <div className="banner banner--error cc-ts-msg-banner" role="alert">
          <span>{loiDuyet}</span>
          <button type="button" className="btn btn--ghost" onClick={() => setLoiDuyet(null)}>Đóng</button>
        </div>
      )}
      <LeaveTable items={shown} showEmployee onApprove={approve} luoi={luoi}
        onHuyDaDuyet={(r) => { setHuyErr(null); setHuyDon(r); }}
        onReject={(r) => { setRejectTarget(r); setRejectNote(""); setError(null); }}
        selectable selected={sel} onToggle={toggle} onToggleAll={toggleAll} allPendingCount={pendingIds.length}
        loading={loadingList} listError={listError} onRetry={load}
        emptyTitle={coLoc ? "Không có đơn nào khớp bộ lọc" : "Chưa có đơn xin nghỉ nào"}
        emptySub={coLoc ? "Đổi kỳ hoặc bỏ bớt điều kiện lọc ở trên." : status === "pending" ? "Không còn đơn nào chờ duyệt. Chọn tab Tất cả để xem đơn đã xử lý." : "Thử chọn tab trạng thái khác."}
        // Giữ chân trong lúc tải trang kế (nút đã khoá qua `loading`) — ẩn đi rồi hiện lại thì
        // dãy số trang nhảy khỏi chỗ con trỏ.
        chan={!listError && total > 0 && (
          <PhanTrangDayDu
            trang={page} size={size} tong={total} soDong={shown.length}
            loading={loadingList}
            donVi="đơn"
            onTrang={setPage}
            onSize={(n) => { setSize(n); setPage(1); }}
            // Nói THẲNG giới hạn của nút hàng loạt: ô tick "chọn tất cả" chỉ quét trang đang xem.
            // Không nói thì người duyệt bấm "Duyệt 25" rồi tưởng đã dọn sạch hàng đợi.
            ghiChu={total > size ? "chọn hàng loạt chỉ áp cho trang đang xem" : undefined}
            ariaLabel="Phân trang đơn cần duyệt"
          />
        )} />
      <LyDoDialog
        open={huyDon !== null}
        title="Hủy đơn đã duyệt"
        message={huyDon ? `${huyDon.employee_name ?? `NV#${huyDon.employee_id}`} · ${tomTat(huyDon)}. Người lao động được báo ngay kèm lý do.` : undefined}
        label="Lý do hủy"
        placeholder="vd: tổ cần người, đã báo trực tiếp"
        confirmLabel="Hủy đơn"
        danger
        busy={huyBusy}
        error={huyErr}
        onConfirm={huyThang}
        onCancel={() => setHuyDon(null)}
      />
      {rejectTarget && (
        <div className="ns-modal" role="dialog" aria-modal="true">
          <div className="ns-modal__box cc-day-detail-modal-box">
            <header className="ns-modal__head">
              <div className="cc-modal-title-group">
                <h2>{rejectTarget === "bulk" ? `Từ chối ${sel.size} đơn` : "Từ chối đơn nghỉ"}</h2>
                <p className="cc-modal-subtitle">
                  {rejectTarget === "bulk"
                    ? `Áp 1 lý do chung cho ${sel.size} đơn đã chọn.`
                    : `${rejectTarget.employee_name ?? `NV#${rejectTarget.employee_id}`} · ${rejectTarget.leave_type_name ?? "—"}`}
                </p>
              </div>
              <button className="ns-modal__x" onClick={() => setRejectTarget(null)}>×</button>
            </header>
            <div className="ns-modal__body cc-day-detail-modal-body">
              {error && <div className="banner banner--error cc-ts-msg-banner" style={{ marginBottom: "16px" }}>{error}</div>}
              {rejectTarget !== "bulk" && (
                <div className="cc-info-card-note" style={{ margin: "0 0 14px 0" }}>
                  <span>Ngày: <b>{fmtDate(rejectTarget.start_date)}–{fmtDate(rejectTarget.end_date)}</b> ({rejectTarget.days} ngày)</span>
                </div>
              )}
              <label className="ns-field">
                <span className="cc-field-label">Lý do từ chối *</span>
                <input autoFocus className="cc-input-text" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Nêu rõ lý do để NV biết…" />
              </label>
            </div>
            <footer className="ns-modal__foot">
              <button className="btn btn--ghost" onClick={() => setRejectTarget(null)} disabled={busy}>Hủy</button>
              <button className="btn btn--primary ns-danger" onClick={confirmReject} disabled={busy || !rejectNote.trim()}>{busy ? "Đang gửi…" : "Từ chối"}</button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

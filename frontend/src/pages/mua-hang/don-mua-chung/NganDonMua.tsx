// NGĂN ĐƠN MUA dùng CHUNG cho Mua hàng và Kế toán — phương án 3 sắp lại (07/10/2026,
// docs/mockups/mua-hang-phuong-an-3-chi-tiet.html).
//
// Hai phần cố định: TRÁI là tab (Mặt hàng | Đợt giao | Thanh toán | Chứng từ | Lịch sử), dài bao nhiêu
// cuộn bấy nhiêu, đầu bảng dính trên cùng; PHẢI là cột 250px đứng yên ở mọi tab: Tiền | Điều khoản |
// Người. Đơn 1 món hay 30 món thì tiền vẫn nằm đúng chỗ. Đầu ngăn KHÔNG lặp Tổng đơn hay Còn nợ.
//
// Hai màn chỉ khác: tab mở sẵn (Thu mua: Mặt hàng, Kế toán: Thanh toán), nút ở đầu ngăn (cha truyền
// vào) và các việc trên đợt (Thu mua: ghi/sửa/xoá đợt, nhập kho; Kế toán: lập phiếu chi theo đợt).
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  api,
  assetUrl,
  type MuaChoLenh,
  type PaymentVoucherRow,
  type PurchaseAttachmentKind,
  type PurchaseDeliveryRow,
  type PurchaseRequestLineOut,
  type PurchaseRequestRow,
  type SupplierCredit,
} from "../../../api/client";
import { useAuth } from "../../../auth/useAuth";
import { useCan } from "../../../auth/permissions";
import { fmtDate, fmtDateTime } from "../../../utils/format";
import { NganPhai } from "../../ke-toan/shared/NganPhai";
import { tenDonVi } from "../../tenDonVi";
import { lineTotal } from "../phieu-mua-hang/shared/helpers";
import { OMuaCho, khoaMuaCho } from "../mua-cho/OMuaCho";
import { ChipTT, TT_DON, TT_KHO, TT_TIEN, nhanHangDon } from "../trang-thai-mua";
import { Icon } from "../../../components/Icons";
import { hanGanNhat } from "./BangDonMua";
import { moTaHanTra } from "./hanTra";
import { khoanPhieuChiCuaDon, type KhoanPhieuChi } from "../../ke-toan/shared/phieuGop";
import "../../ke-toan/ke-toan.css";
import "../trang-thai-mua.css";

export type TabDon = "mh" | "dg" | "tt" | "ct" | "ls";

const so = (n: number) => Math.round(n).toLocaleString("vi-VN");
const dv = (u: string) => tenDonVi(u) ?? u;

/** Khổ của một dòng giấy bằng chữ; hàng khác không theo khổ. */
function khoChu(hangLoai: string | null, rong: number, dai: number): ReactNode {
  if (hangLoai !== "giay") return <span className="mh-mo3">Không theo khổ</span>;
  if (rong > 0 && dai > 0) return `${rong} × ${dai} mm`;
  if (rong > 0) return `khổ ${rong} mm`;
  return <span className="mh-mo3">Không ghi khổ</span>;
}

function conNgay(ngay: string): number {
  const d = new Date(`${ngay.slice(0, 10)}T00:00:00`);
  const h = new Date();
  h.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - h.getTime()) / 86_400_000);
}

function OHan({ dot }: { dot: PurchaseDeliveryRow }) {
  if (dot.chua_dat_han) return <span className="mh-tag mh-tag--canh" style={{ marginLeft: 0 }}>Chưa đặt hạn</span>;
  if (!dot.due_date) return null;
  const n = conNgay(dot.due_date);
  const lop = dot.con_no <= 0 ? undefined : n < 0 ? "mh-do" : n <= 5 ? "mh-vang" : undefined;
  return (
    <span className={lop} title={dot.con_no > 0 ? (n < 0 ? `Quá ${-n} ngày` : n === 0 ? "Đến hạn hôm nay" : `Còn ${n} ngày`) : undefined}>
      {fmtDate(dot.due_date)}
    </span>
  );
}

const LOAI_TEP: Record<PurchaseAttachmentKind, string> = {
  hop_dong: "Hợp đồng",
  hoa_don: "Hoá đơn",
  bien_ban_giao: "Biên bản giao",
  khac: "Khác",
};

/** Các việc của Thu mua trên đợt giao — thiếu cả khối ⇒ ngăn chỉ xem (Kế toán). */
export type ViecDot = {
  ghiDuoc: boolean;
  nhapKhoDuoc: boolean;
  onSua: (dot: PurchaseDeliveryRow) => void;
  onXoa: (dot: PurchaseDeliveryRow) => void;
  onNhapKho: (dot: PurchaseDeliveryRow) => void;
  onXemNhap: (dot: PurchaseDeliveryRow) => void;
  onGanHoaDon: () => void;
};

export function NganDonMua({
  row,
  duongDan,
  tabDau,
  hanhDong,
  canhBao,
  tiepTheo,
  openYcmh,
  credit,
  viecDot,
  onMoChoChi,
  suaDuoc,
  onDoi,
  onLoi,
  onDong,
  phieuChiTick = 0,
  onMoLenh,
}: {
  row: PurchaseRequestRow;
  duongDan: string;
  tabDau: TabDon;
  /** Nút ở đầu ngăn — mỗi màn một bộ (Thu mua: Ghi đợt giao, Đóng đơn…). */
  hanhDong?: ReactNode;
  /** Dải cảnh báo thêm dưới đầu ngăn (vd vượt hạn mức nợ NCC). */
  canhBao?: ReactNode;
  /** Dải việc tiếp theo dưới đầu ngăn — Mua hàng: "Tiếp theo: gửi duyệt" kèm ô cọc. */
  tiepTheo?: ReactNode;
  openYcmh?: (code: string) => void;
  credit?: SupplierCredit | null;
  viecDot?: ViecDot;
  /** Kế toán: nhảy sang Phiếu chi → "Mua hàng chờ chi" đúng đơn này. Ngăn đơn KHÔNG lập phiếu chi
   *  (chủ 17/10/2026: Đơn mua hàng chỉ để duyệt, chi tiền ở màn Phiếu chi). Thiếu = không hiện link. */
  onMoChoChi?: () => void;
  /** Gõ số hợp đồng ở cột phải + tải/xoá tệp hợp đồng. */
  suaDuoc: boolean;
  onDoi: (next: PurchaseRequestRow) => void;
  onLoi: (msg: string | null) => void;
  onDong: () => void;
  /** Tăng lên khi vừa lập phiếu chi — nạp lại danh sách phiếu chi của đơn. */
  phieuChiTick?: number;
  onMoLenh?: (l: MuaChoLenh) => void;
}) {
  const { token } = useAuth();
  const can = useCan();
  const xemPhieuChi = can("phieu_chi", "read");
  const huy = row.status === "cancelled" || row.status === "rejected";
  const chiXem = huy && row.deliveries.length === 0;
  const coHangVe = row.deliveries.length > 0 || ["purchased", "partially_received", "received"].includes(row.status);

  // Phiếu chi của đơn — chỉ người có ô Xem màn Phiếu chi mới nạp (máy chủ cũng chặn).
  const [phieuChi, setPhieuChi] = useState<PaymentVoucherRow[] | null>(null);
  // Khoá theo số phiếu + số tiền chứ không theo cả `row`: danh sách nạp lại (mỗi thao tác, mỗi tin
  // SSE) đẻ object mới dù phiếu chi không đổi gì, và trước đây mỗi lần như vậy lại gọi API một lượt.
  const khoaPhieuChi = `${row.id}:${row.payment_voucher_count}:${row.paid_amount}:${row.receipt_received_amount}`;
  useEffect(() => {
    if (!token || !xemPhieuChi || chiXem) {
      setPhieuChi(null);
      return;
    }
    let bo = false;
    api.accounting
      .vouchers(token, { purchase_request_id: row.id, sort: "-created_at", page: 1, size: 100 })
      .then((d) => !bo && setPhieuChi(d.items))
      .catch(() => !bo && setPhieuChi(null));
    return () => {
      bo = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- row.id nằm trong khoaPhieuChi
  }, [token, xemPhieuChi, chiXem, khoaPhieuChi, phieuChiTick]);

  const tabs = useMemo(() => {
    const ds: { id: TabDon; nhan: string; dem?: number }[] = [{ id: "mh", nhan: "Mặt hàng", dem: row.lines.length }];
    if (!chiXem) {
      ds.push({ id: "dg", nhan: "Đợt giao", dem: row.deliveries.length });
      ds.push({ id: "tt", nhan: "Thanh toán", dem: phieuChi ? phieuChi.filter((v) => v.status !== "cancelled").length : undefined });
    }
    if (!chiXem || row.attachments.length > 0) ds.push({ id: "ct", nhan: "Chứng từ", dem: row.attachments.length });
    ds.push({ id: "ls", nhan: "Lịch sử", dem: row.activity_history.length });
    return ds;
  }, [row, chiXem, phieuChi]);
  const [tab, setTab] = useState<TabDon>(tabDau);
  const tabDung = tabs.some((t) => t.id === tab) ? tab : "mh";

  const nd = row.content?.trim() || row.purpose?.trim() || "";
  const moc = huy
    ? row.activity_history.find((a) => a.event_type === "status" && a.to_status === row.status)
    : undefined;

  return (
    <>
      <NganPhai
        duongDan={duongDan}
        tieuDe={row.code}
        the={
          <span className="mh-hai-chip">
            <ChipTT nhan={nhanHangDon(row)} />
            {row.nhom_tien && <ChipTT nhan={TT_TIEN[row.nhom_tien]} />}
          </span>
        }
        hanhDong={hanhDong}
        phuDe={
          <div style={{ display: "block", width: "100%" }}>
            {nd && <div className="mh-mo" style={{ marginBottom: 8 }}>{nd}</div>}
            {huy && row.reject_reason && (
              <div className="mh-canh" style={{ marginBottom: 8 }}>
                <span className="mh-canh__nhan">{row.status === "cancelled" ? "Lý do huỷ" : "Lý do trả lại"}</span>
                <span>{row.reject_reason}</span>
              </div>
            )}
            <div className="mh-kv">
              <span>Nhà cung cấp<b>{row.supplier_name || "Chưa chọn"}</b></span>
              <span>
                Yêu cầu
                <b>
                  {row.sources.length === 0 ? (
                    <span className="mh-mo3">Không gắn</span>
                  ) : (
                    <button type="button" className="mh-lk" disabled={!openYcmh} onClick={() => openYcmh?.(row.sources[0].code)}>
                      {row.sources[0].code}
                    </button>
                  )}
                </b>
                {row.sources.length > 1 && (
                  <span className="mh-tag mh-tag--vien" title={row.sources.slice(1).map((s) => s.code).join("\n")}>
                    +{row.sources.length - 1}
                  </span>
                )}
              </span>
              <span>Mua cho<b><OMuaCho loai={row.loai_mua_cac} lenh={row.mua_cho} onMoLenh={onMoLenh} /></b></span>
              <span>Ngày cần<b>{fmtDate(row.needed_date)}</b></span>
              <span>Ngày tạo<b title={fmtDateTime(row.created_at)}>{fmtDate(row.created_at)}</b></span>
            </div>
          </div>
        }
        canhBao={
          credit?.vuot_han_muc || canhBao || tiepTheo ? (
            <>
              {tiepTheo}
              {/* Vượt hạn mức nợ NCC: chỉ nhắc, không chặn. Đặt ở đây để ngăn Mua hàng lẫn Kế toán
                  cùng thấy (trước 15/10/2026 chỉ ngăn Kế toán có). */}
              {/* Có dải gửi duyệt thì dải tự nói một dòng nợ NCC — hai dải chồng nhau làm đầu ngăn dày. */}
              {credit?.vuot_han_muc && !tiepTheo && (
                <div className="mh-canh mh-canh--vang" role="status">
                  <span>
                    Đang nợ {row.supplier_name || "nhà cung cấp"} {so(credit.no_hien_tai)} đ, vượt hạn mức{" "}
                    {so(credit.credit_limit)} đ là {so(credit.vuot_bao_nhieu)} đ. Chỉ nhắc, không chặn lập đơn.
                  </span>
                </div>
              )}
              {canhBao}
            </>
          ) : undefined
        }
        tabs={tabs}
        tab={tabDung}
        onTab={(id) => setTab(id as TabDon)}
        onDong={onDong}
      >
        <div className="mh-ngan">
          <div className="mh-ngan__trai">
            {tabDung === "mh" && <TabMatHang row={row} coHangVe={coHangVe} onMoLenh={onMoLenh} />}
            {tabDung === "dg" && <TabDotGiao row={row} viecDot={viecDot} />}
            {tabDung === "tt" && (
              <TabThanhToan row={row} phieuChi={phieuChi} xemPhieuChi={xemPhieuChi} onMoChoChi={onMoChoChi} />
            )}
            {tabDung === "ct" && <TabChungTu row={row} suaDuoc={suaDuoc} onDoi={onDoi} onLoi={onLoi} />}
            {tabDung === "ls" && <TabLichSu row={row} />}
          </div>
          <CotPhai row={row} credit={credit} huy={huy} moc={moc} suaDuoc={suaDuoc} onDoi={onDoi} onLoi={onLoi} />
        </div>
      </NganPhai>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- //

/** Ngày ngắn "21/10" cho dòng đợt — năm đã nằm ở cột hạn bên phải. */
const ngayNgan = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

/** Hạn thật của từng đợt ngay dưới dòng Hạn trả (15/10/2026) — đổi cách tính là thấy đợt nào dời hạn
 *  mà không phải sang tab Đợt giao. Trên 4 đợt thì gọn lại một dòng, chi tiết ở tab đó. */
function HanTungDot({ row }: { row: PurchaseRequestRow }) {
  const dots = [...row.deliveries].sort((a, b) => a.seq_no - b.seq_no);
  if (dots.length > 4) {
    const han = hanGanNhat(row);
    return (
      <div className="mh-r">
        <span />
        <span className="mh-mo3">{dots.length} đợt{han ? `, hạn gần nhất ${fmtDate(han)}` : ""}</span>
      </div>
    );
  }
  return (
    <div className="mh-han-dot" aria-label="Hạn trả từng đợt">
      {dots.map((d) => (
        <div key={d.id}>
          <span className="n">Đợt {d.seq_no}</span>
          <span className="m">{d.invoice_date ? `hoá đơn ${ngayNgan(d.invoice_date)}` : `nhận ${ngayNgan(d.delivery_date)}`}</span>
          <OHan dot={d} />
        </div>
      ))}
    </div>
  );
}

/** Số hợp đồng gõ thẳng ở cột phải: rời ô hoặc Enter là lưu, Esc trả lại số cũ. */
function OSoHopDong({
  row,
  onDoi,
  onLoi,
}: {
  row: PurchaseRequestRow;
  onDoi: (next: PurchaseRequestRow) => void;
  onLoi: (msg: string | null) => void;
}) {
  const { token } = useAuth();
  const [chu, setChu] = useState(row.contract_number ?? "");
  const [busy, setBusy] = useState(false);
  async function luu() {
    const moi = chu.trim();
    if (!token || busy || moi === (row.contract_number ?? "")) return;
    setBusy(true);
    try {
      onDoi(
        await api.purchaseRequests.updateContract(token, row.id, {
          contract_number: moi || null,
          // Gửi lại ĐÚNG cọc đang có — ô này chỉ đổi số hợp đồng.
          deposit_expected: row.deposit_expected || 0,
        }),
      );
      onLoi(null);
    } catch (err) {
      setChu(row.contract_number ?? "");
      onLoi(err instanceof ApiError ? err.message : "Không lưu được số hợp đồng.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <input
      className={`mh-o-hd${chu ? " co" : ""}`}
      maxLength={64}
      value={chu}
      disabled={busy}
      placeholder="Gõ số hợp đồng"
      aria-label="Số hợp đồng"
      onChange={(e) => setChu(e.target.value)}
      onBlur={() => void luu()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setChu(row.contract_number ?? "");
          e.stopPropagation();
        }
      }}
    />
  );
}

function CotPhai({
  row,
  credit,
  huy,
  moc,
  suaDuoc,
  onDoi,
  onLoi,
}: {
  row: PurchaseRequestRow;
  credit?: SupplierCredit | null;
  huy: boolean;
  moc?: { actor_name: string | null; created_at: string };
  suaDuoc: boolean;
  onDoi: (next: PurchaseRequestRow) => void;
  onLoi: (msg: string | null) => void;
}) {
  const tienHang = row.lines.reduce((t, l) => t + l.quantity * l.expected_unit_price, 0);
  const tienGiam = row.lines.reduce(
    (t, l) => t + Math.round((l.quantity * l.expected_unit_price * (l.discount_percent || 0)) / 100),
    0,
  );
  const tienVat = Math.max(0, row.total_estimate - (tienHang - tienGiam));
  const coNo = !huy && (row.gia_tri_da_giao > 0 || row.coc_da_chi > 0);
  const pt = row.total_estimate > 0 ? Math.min(100, Math.round((row.gia_tri_da_giao / row.total_estimate) * 100)) : 0;
  const han = hanGanNhat(row);
  const hanTra = moTaHanTra(row.supplier_credit_days, row.supplier_debt_cutoff_day);
  const henGiao = ["approved", "purchased", "partially_received"].includes(row.status);
  return (
    <aside className="mh-ngan__phai" aria-label="Tiền, điều khoản và người">
      <div className="mh-sb">
        <h4>Tiền</h4>
        <div className="mh-r"><span>Tiền hàng</span><span>{so(tienHang)}</span></div>
        {tienGiam > 0 && <div className="mh-r"><span>Chiết khấu</span><span>{so(-tienGiam)}</span></div>}
        <div className="mh-r"><span>Thuế GTGT</span><span>{so(tienVat)}</span></div>
        <div className="mh-r mh-r--lon mh-r--tong">
          <span>Tổng đơn</span>
          <span className={huy ? "mh-gach" : undefined}>{so(row.total_estimate)} đ</span>
        </div>
        {coNo && (
          <>
            <div className="mh-r" style={{ marginTop: 6 }}><span>Hàng đã về</span><span>{so(row.gia_tri_da_giao)}</span></div>
            <span className="mh-vach" aria-hidden><i className={pt >= 100 ? "du" : undefined} style={{ width: `${pt}%` }} /></span>
            <div className="mh-r">
              <span>Đã chi</span>
              <span title={row.receipt_received_amount > 0 ? `Đã trừ ${so(row.receipt_received_amount)} thu về` : undefined}>
                {so(row.net_paid)}
              </span>
            </div>
            <div className="mh-r mh-r--lon mh-r--tong">
              <span>Còn nợ</span>
              <span>{row.outstanding_amount > 0 ? `${so(row.outstanding_amount)} đ` : <span className="mh-la">Đã trả đủ</span>}</span>
            </div>
            {han && row.outstanding_amount > 0 && (
              <div className="mh-r">
                <span>Hạn gần nhất</span>
                <span className={conNgay(han) < 0 ? "mh-do" : conNgay(han) <= 5 ? "mh-vang" : undefined}>{fmtDate(han)}</span>
              </div>
            )}
          </>
        )}
        {!huy && row.deposit_expected > 0 && row.gia_tri_da_giao <= 0 && (
          <div className="mh-r"><span>Đã cọc</span><span>{so(row.coc_da_chi)} trên {so(row.deposit_expected)}</span></div>
        )}
      </div>

      {/* ĐIỀU KHOẢN CHỈ ĐỂ XEM (15/10/2026): cọc chốt ở dải "Tiếp theo: gửi duyệt", cách tính hạn
          đổi ở dải đó hoặc trong hộp Ghi đợt giao. Riêng số hợp đồng không gắn nút nào — gõ thẳng. */}
      <div className="mh-sb">
        <h4>Điều khoản</h4>
        {row.status !== "cancelled" && (
          <div className="mh-r">
            <span>Cọc</span>
            <span>
              {row.deposit_expected > 0 ? (
                `${so(row.deposit_expected)} đ`
              ) : ["draft", "rejected"].includes(row.status) ? (
                <span className="mh-mo3">Ghi lúc gửi duyệt</span>
              ) : (
                <span className="mh-mo3">Không cọc</span>
              )}
              {row.status === "pending_approval" && <small className="mh-r__phu">chờ người duyệt đồng ý</small>}
              {row.approved_at && !["draft", "pending_approval", "rejected"].includes(row.status) && (
                <span
                  className="mh-khoa-coc"
                  title={`Chốt khi duyệt${row.approved_by_name ? `: ${row.approved_by_name}` : ""} lúc ${fmtDateTime(row.approved_at)}. Không đổi được nữa.`}
                >
                  <Icon name="lock" size={12} /> đã duyệt
                </span>
              )}
            </span>
          </div>
        )}
        <div className="mh-r">
          <span>Hạn trả</span>
          <span className={hanTra.chuaRo ? "mh-mo3" : undefined}>
            {hanTra.chinh}
            {hanTra.phu && <small className="mh-r__phu">{hanTra.phu}</small>}
          </span>
        </div>
        {row.deliveries.length > 0 && <HanTungDot row={row} />}
        {credit && (
          <>
            <div className="mh-r">
              <span>Hạn mức</span>
              <span>{credit.credit_limit > 0 ? so(credit.credit_limit) : <span className="mh-mo3">Không đặt</span>}</span>
            </div>
            <div className="mh-r"><span>Đang nợ nhà cung cấp</span><span>{so(credit.no_hien_tai)}</span></div>
            {credit.payment_terms?.trim() && <div className="mh-r"><span>Cách trả</span><span>{credit.payment_terms}</span></div>}
          </>
        )}
        {row.status !== "cancelled" && (
          <div className="mh-r">
            <span>Số hợp đồng</span>
            <span>
              {suaDuoc ? (
                <OSoHopDong key={`${row.id}:${row.contract_number ?? ""}`} row={row} onDoi={onDoi} onLoi={onLoi} />
              ) : (
                row.contract_number || <span className="mh-mo3">Chưa có</span>
              )}
            </span>
          </div>
        )}
        {henGiao && (
          <div className="mh-r">
            <span>Hẹn giao</span>
            <span>{row.expected_receipt_date ? fmtDate(row.expected_receipt_date) : <span className="mh-mo3">Chưa hẹn</span>}</span>
          </div>
        )}
      </div>

      <div className="mh-sb">
        <h4>Người</h4>
        <div className="mh-r"><span>NV mua hàng</span><span>{row.created_by_name || <span className="mh-mo3">Không rõ</span>}</span></div>
        <div className="mh-r">
          <span>Gửi duyệt</span>
          <span>{row.submitted_at ? fmtDate(row.submitted_at) : <span className="mh-mo3">Chưa gửi</span>}</span>
        </div>
        {row.approved_by_name && (
          <>
            <div className="mh-r"><span>NV duyệt</span><span>{row.approved_by_name}</span></div>
            {row.approved_at && <div className="mh-r"><span>Duyệt lúc</span><span>{fmtDateTime(row.approved_at)}</span></div>}
          </>
        )}
        {huy && moc && (
          <>
            <div className="mh-r">
              <span>{row.status === "cancelled" ? "Huỷ bởi" : "Trả lại bởi"}</span>
              <span>{moc.actor_name || <span className="mh-mo3">Không rõ</span>}</span>
            </div>
            <div className="mh-r">
              <span>{row.status === "cancelled" ? "Huỷ lúc" : "Trả lại lúc"}</span>
              <span>{fmtDateTime(moc.created_at)}</span>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------------------------- //

/** Số đã về của từng dòng đặt, cộng từ các đợt. */
function daVeTheoDong(row: PurchaseRequestRow): Map<number, number> {
  const m = new Map<number, number>();
  for (const d of row.deliveries) for (const l of d.lines) m.set(l.purchase_request_line_id, (m.get(l.purchase_request_line_id) ?? 0) + l.quantity);
  return m;
}

function TabMatHang({ row, coHangVe, onMoLenh }: { row: PurchaseRequestRow; coHangVe: boolean; onMoLenh?: (l: MuaChoLenh) => void }) {
  const daVe = useMemo(() => daVeTheoDong(row), [row]);
  const [loc, setLoc] = useState<"all" | "thieu" | "du">("all");
  const [tim, setTim] = useState("");
  const [mo, setMo] = useState<Set<number>>(new Set());
  const thieu = (l: PurchaseRequestLineOut) => Math.max(0, l.quantity - (daVe.get(l.id) ?? 0));
  const soThieu = row.lines.filter((l) => thieu(l) > 0).length;
  const dong = row.lines
    .filter((l) => !coHangVe || loc === "all" || (loc === "thieu" ? thieu(l) > 0 : thieu(l) <= 0))
    .filter((l) => !tim.trim() || l.item_name.toLowerCase().includes(tim.trim().toLowerCase()))
    // Món còn thiếu lên đầu (giữ thứ tự gốc trong từng nhóm) — việc còn phải theo nằm trên cùng.
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (coHangVe ? Number(thieu(b.l) > 0) - Number(thieu(a.l) > 0) : 0) || a.i - b.i)
    .map((x) => x.l);
  const dotCuaMon = (lineId: number) =>
    row.deliveries.flatMap((d) => d.lines.filter((x) => x.purchase_request_line_id === lineId).map((x) => ({ d, x })));
  const doiMo = (id: number) =>
    setMo((cu) => {
      const moi = new Set(cu);
      if (moi.has(id)) moi.delete(id);
      else moi.add(id);
      return moi;
    });
  // Cột "Mua cho" từng dòng chỉ khi các dòng NÓI KHÁC NHAU (loại hoặc lệnh). Cả đơn cùng một ý thì
  // đầu ngăn đã nói (mỗi thông tin nói một lần).
  const cotMuaCho = new Set(row.lines.map((l) => khoaMuaCho(l.loai_mua ? [l.loai_mua] : [], l.mua_cho))).size > 1;
  const soCot = (coHangVe ? 8 : 6) + (cotMuaCho ? 1 : 0);

  return (
    <>
      {(coHangVe || row.lines.length > 6) && (
        <div className="mh-thanh">
          {coHangVe && (
            <div className="mh-flt" role="group" aria-label="Lọc món">
              <button type="button" aria-pressed={loc === "all"} onClick={() => setLoc("all")}>
                Tất cả <span className="mh-so">{row.lines.length}</span>
              </button>
              <button type="button" aria-pressed={loc === "thieu"} onClick={() => setLoc("thieu")}>
                <i style={{ background: "var(--tt-cam-dot)" }} />Còn thiếu <span className="mh-so">{soThieu}</span>
              </button>
              <button type="button" aria-pressed={loc === "du"} onClick={() => setLoc("du")}>
                <i style={{ background: "var(--tt-la-dot)" }} />Đã đủ <span className="mh-so">{row.lines.length - soThieu}</span>
              </button>
            </div>
          )}
          <span className="mh-gian" />
          {row.lines.length > 6 && (
            <input className="mh-tim" value={tim} onChange={(e) => setTim(e.target.value)} placeholder="Tìm món trong đơn…" aria-label="Tìm món trong đơn" />
          )}
        </div>
      )}
      <div className="lds-bang">
        <table className="lds-g">
          <colgroup>
            <col />
            {cotMuaCho && <col style={{ width: 150 }} />}
            <col style={{ width: 122 }} />
            <col style={{ width: 96 }} />
            {coHangVe && <col style={{ width: 76 }} />}
            {coHangVe && <col style={{ width: 84 }} />}
            <col style={{ width: 86 }} />
            <col style={{ width: 50 }} />
            <col style={{ width: 104 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Vật tư</th>
              {cotMuaCho && <th>Mua cho</th>}
              <th>Khổ đặt</th>
              <th className="n">Đặt</th>
              {coHangVe && <th className="n">Đã về</th>}
              {coHangVe && <th className="n">Còn thiếu</th>}
              <th className="n">Đơn giá</th>
              <th className="n">VAT</th>
              <th className="n">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {dong.length === 0 && (
              <tr><td colSpan={soCot} className="lds-trong">Không có món nào khớp.</td></tr>
            )}
            {dong.map((l) => {
              const ve = daVe.get(l.id) ?? 0;
              const t = thieu(l);
              const dot = coHangVe ? dotCuaMon(l.id) : [];
              const moRa = mo.has(l.id);
              // Máy chủ ghi sẵn "Từ <mã yêu cầu>" vào ghi chú dòng. Đơn chỉ gắn một yêu cầu thì đầu ngăn
              // đã nói rồi — lặp lại trên từng dòng chỉ chiếm chỗ tên vật tư.
              const ghiChu =
                l.note && !(row.sources.length === 1 && l.note.trim() === `Từ ${row.sources[0].code}`) ? l.note : null;
              return (
                <Fragment key={l.id}>
                  <tr className={`${dot.length ? "lds-dong" : ""}${moRa ? " is-tick" : ""}${row.status === "cancelled" ? " mh-cu" : ""}`}
                    onClick={dot.length ? () => doiMo(l.id) : undefined}>
                    <td title={[l.item_name, ghiChu].filter(Boolean).join("\n")}>
                      {coHangVe && (
                        <span className="mh-chev" aria-hidden>{dot.length ? (moRa ? "▾" : "▸") : ""}</span>
                      )}
                      {l.item_name}
                      {ghiChu && <span className="mh-mo" style={{ marginLeft: 8 }}>{ghiChu}</span>}
                    </td>
                    {cotMuaCho && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <OMuaCho loai={l.loai_mua ? [l.loai_mua] : []} lenh={l.mua_cho} donVi={dv(l.unit)} onMoLenh={onMoLenh} />
                      </td>
                    )}
                    <td>
                      {khoChu(l.hang_loai, l.kho_rong, l.kho_dai)}
                      {dot.some(({ x }) => x.khac_kho_dat) && <span className="mh-tag mh-tag--canh">khác khổ</span>}
                    </td>
                    <td className="n">{so(l.quantity)}<span className="mh-u">{dv(l.unit)}</span></td>
                    {coHangVe && <td className="n">{ve > 0 ? so(ve) : <span className="mh-mo3">0</span>}</td>}
                    {coHangVe && (
                      <td className="n">
                        {t > 0 ? <span className="mh-cam">{so(t)}</span>
                          : ve > l.quantity ? <span className="mh-la" title="Phần vượt số đặt tính 0 đ">Dư {so(ve - l.quantity)}</span>
                          : <span className="mh-la">Đủ</span>}
                      </td>
                    )}
                    <td className="n">
                      {so(l.expected_unit_price)}
                      {l.discount_percent > 0 && <span className="mh-tag">CK {l.discount_percent}%</span>}
                    </td>
                    <td className="n">{l.vat_percent}%</td>
                    <td className="n">{so(l.line_total)}</td>
                  </tr>
                  {moRa && dot.map(({ d, x }) => (
                    <tr key={`${l.id}-${x.id}`} className="mh-con">
                      <td style={{ paddingLeft: 36 }}>Đợt {d.seq_no}<span className="mh-tag mh-tag--vien">nhận {fmtDate(d.delivery_date)}</span></td>
                      {cotMuaCho && <td />}
                      <td>{khoChu(l.hang_loai, x.kho_rong, x.kho_dai)}</td>
                      <td />
                      <td className="n">{so(x.quantity)}</td>
                      <td colSpan={4} className="lds-mu">
                        {x.khac_kho_dat ? "Vào tồn theo khổ nhận" : d.da_nhap_kho ? `${TT_KHO[d.kho].label} ${d.stock_request_ma ?? ""}` : "Chưa gửi kho"}
                        {x.quantity_du > 0 && <span style={{ marginLeft: 8 }}>dư {so(x.quantity_du)} giá 0 đ</span>}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TabDotGiao({ row, viecDot }: { row: PurchaseRequestRow; viecDot?: ViecDot }) {
  const [mo, setMo] = useState<number | null>(row.deliveries.find((d) => !d.da_nhap_kho)?.id ?? null);
  const dongTheoId = new Map(row.lines.map((pl) => [pl.id, pl]));
  // Đợt mới nhất lên đầu — đợt vừa về là đợt cần làm (nhập kho, hoá đơn).
  const dots = [...row.deliveries].sort((a, b) => b.seq_no - a.seq_no);
  if (dots.length === 0) {
    return (
      <p className="mh-ghi" style={{ marginTop: 0 }}>
        {viecDot?.ghiDuoc
          ? "Chưa ghi đợt giao nào. Hàng về đợt nào thì bấm Ghi đợt giao ở đầu ngăn; công nợ chỉ phát sinh theo số đã ghi."
          : row.status === "received"
            ? "Đơn này chốt nhận hàng theo cách cũ, không theo dõi theo đợt."
            : "Đơn phải ở Chờ hàng về thì mới ghi được đợt giao."}
      </p>
    );
  }
  return (
    <>
      {viecDot?.ghiDuoc && dots.length > 1 && (
        <div className="mh-thanh">
          <span className="mh-gian" />
          <button type="button" className="mh-nut" onClick={viecDot.onGanHoaDon}>Gán một hoá đơn cho nhiều đợt</button>
        </div>
      )}
      <div className="lds-bang">
        <table className="lds-g">
          <colgroup>
            <col style={{ width: 96 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 92 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 104 }} />
            <col style={{ width: 66 }} />
            <col style={{ width: 112 }} />
            {/* Kho phải có độ rộng riêng: để `<col />` trống thì ngăn hẹp (bảng cố định cột) co cột này
                về 0px và mất luôn nút Gửi kho — thà bảng cuộn ngang. */}
            <col style={{ width: 300 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Đợt</th>
              <th>Ngày nhận hàng</th>
              <th>Số hoá đơn</th>
              <th>Ký hiệu</th>
              <th>Ngày hoá đơn</th>
              <th>Hạn trả</th>
              <th className="n">Số món</th>
              <th className="n">Giá trị</th>
              <th>Kho</th>
            </tr>
          </thead>
          <tbody>
            {dots.map((d) => {
              const moRa = mo === d.id;
              const anh = row.attachments.filter((a) => a.delivery_id === d.id && a.kind === "hoa_don");
              const khoa = d.paid_amount > 0;
              return (
                <Fragment key={d.id}>
                  <tr className={`lds-dong${moRa ? " is-tick" : ""}`} onClick={() => setMo(moRa ? null : d.id)}
                    title={d.created_by_name ? `${d.created_by_name} ghi lúc ${fmtDateTime(d.created_at)}` : undefined}>
                    <td><span className="mh-chev" aria-hidden>{moRa ? "▾" : "▸"}</span>Đợt {d.seq_no}</td>
                    <td>{fmtDate(d.delivery_date)}</td>
                    <td>
                      {d.invoice_number || <span className="mh-mo3">Chưa có</span>}
                      {anh.length > 0 && (
                        <a className="mh-lk" style={{ marginLeft: 8 }} href={assetUrl(anh[0].file_url) ?? "#"} target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()} title={anh.map((a) => a.file_name).join("\n")}>
                          {anh.length} tệp
                        </a>
                      )}
                    </td>
                    <td className="lds-mu">{d.invoice_symbol ?? ""}</td>
                    <td>{d.invoice_date ? fmtDate(d.invoice_date) : ""}</td>
                    <td><OHan dot={d} /></td>
                    <td className="n">{d.lines.length}</td>
                    <td className="n">{so(d.amount)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {d.da_nhap_kho ? (
                        <>
                          {/* Gửi rồi thì nói KHO đã nhập xong chưa — trước 11/10/2026 chỉ ghi "Đã gửi kho"
                              dù phiếu nhập đã ghi sổ, nhìn tưởng kho chưa làm gì. */}
                          <ChipTT nhan={TT_KHO[d.kho]} />
                          {d.stock_request_ma && (
                            <button type="button" className="mh-lk" style={{ marginLeft: 8 }} disabled={!viecDot}
                              onClick={() => viecDot?.onXemNhap(d)}>
                              {d.stock_request_ma}
                            </button>
                          )}
                        </>
                      ) : (
                        /* Chưa gửi: chip cùng chữ với đầu ngăn + nút việc tiếp theo tô màu — trước
                           11/10/2026 chỉ là nút viền mờ cỡ chữ 12, nhìn không ra là việc phải làm. */
                        <span className="mh-kho-cho">
                          <ChipTT nhan={TT_KHO.cho_gui_kho} />
                          {viecDot?.nhapKhoDuoc && (
                            <button type="button" className="mh-nut mh-nut--chinh" onClick={() => viecDot.onNhapKho(d)}>
                              <Icon name="warehouse" size={13} /> Gửi kho
                            </button>
                          )}
                        </span>
                      )}
                      {viecDot?.ghiDuoc && !khoa && (
                        <>
                          <button type="button" className="mh-lk" style={{ marginLeft: 12 }} onClick={() => viecDot.onSua(d)}>Sửa</button>
                          <button type="button" className="mh-lk" style={{ marginLeft: 10 }} onClick={() => viecDot.onXoa(d)}>Xoá</button>
                        </>
                      )}
                      {viecDot?.ghiDuoc && khoa && (
                        <span className="mh-mo3" style={{ marginLeft: 12 }}
                          title="Đợt đã có phiếu chi, huỷ phiếu chi trước rồi mới sửa hoặc xoá được.">
                          Đã chi, khoá sửa
                        </span>
                      )}
                    </td>
                  </tr>
                  {moRa && (
                    <tr>
                      <td colSpan={9}>
                        <div className="lds-bang lds-bang--long">
                          <table className="lds-g">
                            <colgroup>
                              <col />
                              <col style={{ width: 190 }} />
                              <col style={{ width: 130 }} />
                              <col style={{ width: 120 }} />
                            </colgroup>
                            <thead>
                              <tr><th>Vật tư</th><th>Khổ nhận</th><th className="n">Số lượng</th><th className="n">Giá trị</th></tr>
                            </thead>
                            <tbody>
                              {d.lines.map((x) => {
                                const pl = dongTheoId.get(x.purchase_request_line_id);
                                const gt = pl ? lineTotal({ ...pl, quantity: x.quantity_tinh_tien }) : null;
                                return (
                                  <tr key={x.id}>
                                    <td title={x.note ?? undefined}>{x.item_name}</td>
                                    <td>
                                      {khoChu(pl?.hang_loai ?? null, x.kho_rong, x.kho_dai)}
                                      {x.khac_kho_dat && <span className="mh-tag mh-tag--canh">khác khổ</span>}
                                    </td>
                                    <td className="n" title={x.quantity_du > 0 ? `${so(x.quantity_tinh_tien)} tính tiền, ${so(x.quantity_du)} vượt số đặt giá 0 đ` : undefined}>
                                      {so(x.quantity)}<span className="mh-u">{dv(x.unit)}</span>
                                      {x.quantity_du > 0 && <span className="mh-tag">dư {so(x.quantity_du)}</span>}
                                    </td>
                                    <td className="n">{gt != null ? so(gt) : ""}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

const LOAI_PHIEU: Record<string, string> = { cash: "Phiếu chi", bank_transfer: "UNC" };

function TabThanhToan({
  row,
  phieuChi,
  xemPhieuChi,
  onMoChoChi,
}: {
  row: PurchaseRequestRow;
  phieuChi: PaymentVoucherRow[] | null;
  xemPhieuChi: boolean;
  onMoChoChi?: () => void;
}) {
  const dots = [...row.deliveries].sort((a, b) => a.seq_no - b.seq_no);
  // Phiếu gộp nhiều chứng từ tách theo dòng của đơn này: mỗi đợt/cọc chỉ thấy phần của nó.
  const khoan = khoanPhieuChiCuaDon(row.id, phieuChi ?? []);
  const cuaDot = (id: number | null) => khoan.filter((k) => k.deliveryId === id);
  const coc = cuaDot(null);
  // Đơn đã duyệt còn đợt còn nợ, hoặc còn cọc chưa chi cho PHẦN HÀNG CHƯA VỀ ⇒ chỉ đường sang chỗ chi
  // (cùng luật `khoan_cho_chi` của tab "Mua hàng chờ chi").
  const noDot = row.deliveries.reduce((t, d) => t + Math.max(0, d.con_no), 0);
  const cocTreo = Math.min(row.tran_dat_coc, Math.max(0, row.total_estimate - row.net_paid - noDot));
  const conPhaiChi =
    ["approved", "purchased", "partially_received", "received"].includes(row.status) && (noDot > 0 || cocTreo > 0);
  const chiODau = onMoChoChi && conPhaiChi && (
    <p className="mh-ghi">
      Chi tiền cho đơn này ở{" "}
      <button type="button" className="lds-lk" onClick={onMoChoChi}>Phiếu chi → Mua hàng chờ chi</button>.
    </p>
  );
  const DongPhieu = ({ k: { v, amount, gop } }: { k: KhoanPhieuChi }) => (
    <tr className="mh-con">
      <td style={{ paddingLeft: 28 }} title={v.content ?? undefined}>
        <span className={v.status === "cancelled" ? "mh-gach" : undefined}>{v.code}</span>
        <span className="mh-mo" style={{ marginLeft: 8 }}>{LOAI_PHIEU[v.voucher_type] ?? v.voucher_type}</span>
        {v.created_by_name && <span className="mh-mo3" style={{ marginLeft: 8 }}>{v.created_by_name}</span>}
        {v.status === "cancelled" && <span className="mh-tag">Đã huỷ</span>}
        {gop && (
          <span className="mh-mo3" style={{ marginLeft: 8 }} title="Một phiếu chi trả nhiều khoản, số bên phải là phần của khoản này">
            {`phiếu gộp ${so(v.amount_vnd)}`}
          </span>
        )}
      </td>
      <td>{fmtDate(v.voucher_date)}</td>
      <td />
      <td />
      <td />
      <td />
      <td className="n"><span className={v.status === "cancelled" ? "mh-gach" : undefined}>{so(amount)}</span></td>
      <td />
    </tr>
  );
  if (dots.length === 0 && coc.length === 0 && row.coc_da_chi <= 0) {
    return (
      <>
        <p className="mh-ghi" style={{ marginTop: 0 }}>Chưa có hàng về nên chưa phát sinh nợ.</p>
        {chiODau}
      </>
    );
  }
  return (
    <>
      <div className="lds-bang">
        <table className="lds-g">
          <colgroup>
            <col />
            <col style={{ width: 100 }} />
            <col style={{ width: 104 }} />
            <col style={{ width: 88 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 110 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Đợt và phiếu chi</th>
              {/* Dòng đợt: ngày nhận hàng; dòng phiếu chi: ngày chi. */}
              <th>Ngày</th>
              <th>Số hoá đơn</th>
              <th>Ký hiệu</th>
              <th>Hạn trả</th>
              <th className="n">Giá trị</th>
              <th className="n">Đã chi</th>
              <th className="n">Còn nợ</th>
            </tr>
          </thead>
          <tbody>
            {(coc.length > 0 || row.coc_da_chi > 0) && (
              <>
                <tr>
                  <td>Tiền cọc</td>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td className="n">{row.deposit_expected > 0 ? so(row.deposit_expected) : ""}</td>
                  <td className="n">{so(row.coc_da_chi)}</td>
                  <td className="n lds-mu" title="Cọc tự trừ vào các đợt giao, giao trước trừ trước">trừ dần</td>
                </tr>
                {coc.map((k) => <DongPhieu key={k.v.id} k={k} />)}
              </>
            )}
            {dots.map((d) => (
              <Fragment key={d.id}>
                <tr>
                  <td>Đợt {d.seq_no}</td>
                  <td title="Ngày nhận hàng">{fmtDate(d.delivery_date)}</td>
                  <td title={d.invoice_date ? `Ngày hoá đơn ${fmtDate(d.invoice_date)}` : undefined}>
                    {d.invoice_number || <span className="mh-mo3">Chưa có</span>}
                  </td>
                  <td className="lds-mu">{d.invoice_symbol ?? ""}</td>
                  <td><OHan dot={d} /></td>
                  <td className="n">{so(d.amount)}</td>
                  <td className="n" title={d.coc_bu > 0 ? `Gồm ${so(d.coc_bu)} trừ từ cọc` : undefined}>
                    {so(d.paid_amount + d.coc_bu)}
                  </td>
                  <td className="n">{d.con_no > 0 ? so(d.con_no) : <span className="mh-la">Đã trả</span>}</td>
                </tr>
                {cuaDot(d.id).map((k) => <DongPhieu key={k.v.id} k={k} />)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {chiODau}
      {!xemPhieuChi && (
        <p className="mh-ghi">Bạn không có quyền xem màn Phiếu chi nên bảng không liệt kê từng phiếu; số Đã chi vẫn đúng.</p>
      )}
    </>
  );
}

function TabChungTu({
  row,
  suaDuoc,
  onDoi,
  onLoi,
}: {
  row: PurchaseRequestRow;
  suaDuoc: boolean;
  onDoi: (next: PurchaseRequestRow) => void;
  onLoi: (msg: string | null) => void;
}) {
  const { token } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dangTai, setDangTai] = useState(false);
  const seqTheoDot = new Map(row.deliveries.map((d) => [d.id, d.seq_no]));
  async function tai(list: FileList | null) {
    if (!token || !list?.length) return;
    setDangTai(true);
    onLoi(null);
    try {
      let moi = row;
      for (const file of Array.from(list)) moi = await api.purchaseRequests.uploadAttachment(token, row.id, file, "hop_dong");
      onDoi(moi);
    } catch (err) {
      onLoi(err instanceof ApiError ? err.message : "Không tải được tệp lên.");
    } finally {
      setDangTai(false);
    }
  }
  async function xoa(id: number) {
    if (!token) return;
    setDangTai(true);
    onLoi(null);
    try {
      onDoi(await api.purchaseRequests.deleteAttachment(token, row.id, id));
    } catch (err) {
      onLoi(err instanceof ApiError ? err.message : "Không xoá được tệp.");
    } finally {
      setDangTai(false);
    }
  }
  return (
    <div className="lds-bang">
      <table className="lds-g">
        <colgroup>
          <col />
          <col style={{ width: 120 }} />
          <col style={{ width: 100 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: suaDuoc ? 56 : 8 }} />
        </colgroup>
        <thead>
          <tr><th>Tệp</th><th>Loại</th><th>Gắn vào</th><th>Người tải</th><th>Lúc</th><th /></tr>
        </thead>
        <tbody>
          {row.attachments.map((a) => (
            <tr key={a.id}>
              <td title={a.file_name}>
                <a className="mh-lk" href={assetUrl(a.file_url) ?? "#"} target="_blank" rel="noreferrer">{a.file_name}</a>
              </td>
              <td>{LOAI_TEP[a.kind] ?? a.kind}</td>
              <td>{a.delivery_id ? `Đợt ${seqTheoDot.get(a.delivery_id) ?? ""}` : "Cả đơn"}</td>
              <td>{a.uploaded_by_name || <span className="mh-mo3">Không rõ</span>}</td>
              <td>{fmtDateTime(a.uploaded_at)}</td>
              <td>
                {suaDuoc && a.kind === "hop_dong" && (
                  <button type="button" className="mh-lk" disabled={dangTai} onClick={() => xoa(a.id)}>Xoá</button>
                )}
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={6} className="lds-mu3">
              {suaDuoc ? (
                <>
                  <input type="file" hidden multiple accept="image/*,application/pdf" ref={fileRef}
                    onChange={(e) => {
                      tai(e.target.files);
                      e.target.value = "";
                    }} />
                  <button type="button" className="mh-lk" disabled={dangTai} onClick={() => fileRef.current?.click()}>
                    {dangTai ? "Đang tải tệp lên…" : "Tải hợp đồng lên"}
                  </button>
                  <span style={{ marginLeft: 8 }}>ảnh hoặc PDF, tối đa 10 MB mỗi tệp. Hoá đơn gắn ở hộp Ghi đợt giao.</span>
                </>
              ) : row.attachments.length === 0 ? (
                "Chưa có tệp nào."
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function TabLichSu({ row }: { row: PurchaseRequestRow }) {
  const ten = (s: string | null) => (s ? TT_DON[s as keyof typeof TT_DON]?.label ?? s : "");
  return (
    <div className="lds-bang">
      <table className="lds-g">
        <colgroup>
          <col style={{ width: 140 }} />
          <col style={{ width: 130 }} />
          <col />
        </colgroup>
        <thead>
          <tr><th>Lúc</th><th>Người</th><th>Việc</th></tr>
        </thead>
        <tbody>
          {row.activity_history.length === 0 && (
            <tr><td colSpan={3} className="lds-trong">Chưa ghi nhận hoạt động nào của đơn.</td></tr>
          )}
          {row.activity_history.map((a) => {
            const viec =
              a.event_type === "status"
                ? a.from_status ? `${ten(a.from_status)} sang ${ten(a.to_status)}` : `Lập đơn, ${ten(a.to_status)}`
                : a.title;
            const them = [a.detail, a.reason ? `Lý do: ${a.reason}` : null].filter(Boolean).join(". ");
            return (
              <tr key={a.id}>
                <td className="lds-mu">{fmtDateTime(a.created_at)}</td>
                <td>{a.source === "may" ? "Máy tự cập nhật" : a.actor_name || <span className="mh-mo3">Không rõ</span>}</td>
                <td title={them || undefined}>
                  {viec}
                  {them && <span className="mh-mo" style={{ marginLeft: 8 }}>{them}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

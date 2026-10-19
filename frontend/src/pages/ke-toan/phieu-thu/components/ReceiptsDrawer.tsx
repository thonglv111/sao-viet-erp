/** Ngăn CHI TIẾT một phiếu thu (đặc tả A.5, PT-2) — vỏ chung `NganPhai`, ngăn kiểu 3 của phương án A
 *  (docs/mockups/ke-toan-gon-3-phuong-an.html, 07/10/2026), đối xứng ngăn Phiếu chi.
 *
 *  Đầu ngăn: đường dẫn "Phiếu thu > số phiếu" + chép số — SỐ TIỀN làm tiêu đề + pill + bằng chữ —
 *  "Xác nhận đã thu" (phiếu cũ chờ thu), "Sửa" (phiếu cũ chờ thu từ phiếu chi), "In phiếu", "⋯" — tab
 *  Chi tiết / Chứng từ gốc / Lịch sử. Thân chia hai: bên trái lý do nộp và bảng "Áp vào hoá đơn", bên
 *  phải cột thuộc tính xếp dọc (người nộp, tài khoản nhận, đơn bán, người lập…).
 *  Mỗi thông tin nói một lần: "Xác nhận đã thu" chỉ hiện khi khác người hoặc khác lúc với Người lập.
 *  Ngăn tự nạp lại phiếu (route đọc MỘT phiếu — có Thu trước đó / Còn nợ) và tệp khi có sự kiện đẩy.
 *  Hủy phiếu và Xác nhận đã thu là KHUNG tại chỗ ở đầu tab Chi tiết, lỗi nằm ngay trong khung.
 *  Phiếu cọc ĐÃ THU hủy được ngay tại đây (06/10/2026) — màn Đơn hàng không có nút hủy cọc.
 */
import { CircleAlert, ExternalLink, Pencil, Printer } from "lucide-react";
import { useEffect, useState } from "react";

import {
  api,
  type PaymentReceiptAttachment,
  type PaymentReceiptRow,
  type SalesInvoiceRow,
} from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import { Cum, TheNho } from "../../shared/Cum";
import { ngay, ngayGio, tien, vietSo } from "../../shared/dinhDang";
import { RayThuocTinh, soPhieu } from "../../shared/LuoiGon";
import { NganPhai } from "../../shared/NganPhai";
import {
  BangDaHuy,
  ChuSoTien,
  DuongDanPhieu,
  KhungHuyPhieu,
  MenuThaoTac,
  useHuyPhieu,
  useTabNho,
} from "../../shared/NganPhieu";
import { laGop } from "../../shared/phieuGop";
import { NguoiLapO, OSo, TaiKhoanO, tabChungTuGoc } from "../../shared/PhieuGon";
import { TabChungTu } from "../../shared/TabChungTu";
import { TabLichSu, tenTheoId, viecHuy, viecLap, viecThemTep, xepMoiNhat, type ViecLs } from "../../shared/TabLichSu";
import { printReceipt } from "../print";
import { STATUS_META } from "../shared/constants";
import { methodText } from "../shared/helpers";
import { KhungXacNhanDaThu } from "./KhungXacNhanDaThu";


export type QuyenNganThu = {
  /** Gán / xoá chứng từ (ô Lập của màn Phiếu thu). */
  lap: boolean;
  huy: boolean;
  /** Xác nhận đã thu phiếu cũ (ô Đổi trạng thái). */
  xacNhan: boolean;
  in: boolean;
  /** Sửa phiếu cũ chờ thu từ phiếu chi (ô Lập). */
  sua: boolean;
};

/** Phiếu cũ được xác nhận SAU khi lập (máy chủ ghi `received_at` = lúc lập cho phiếu mới). */
const LECH_XAC_NHAN_MS = 60_000;

/** Độ rộng cột bảng "Áp vào hoá đơn" (cột trái của ngăn kiểu 3); null = cột giãn (Hoá đơn, ô xuống dòng
 *  được). Cùng khuôn bảng đợt của Phiếu chi: cột tiền 128px (Trừ cọc, Thu trước đó 112px — đủ số trăm
 *  triệu); tổng tối thiểu vừa cột trái ngăn rộng mặc định (~840px). Khung hẹp hơn (điện thoại) thì bảng
 *  cuộn ngang, không để cột Hoá đơn về 0px. */
const COT_HD = [null, 104, 116, 106, 106, 116, 116]; // đo 07/10: ngày tới 82px, số tỷ 94px; +2px mỗi cột vì ô lds-g đệm 10px (kt-g 9px); tổng 804 < khung 820
const RONG_HD = COT_HD.reduce<number>((t, w) => t + (w ?? 140), 0);
const COT_GOP = [120, 120, 116, 116, 116];

/** Xác nhận đã thu là việc RIÊNG (đáng nói) khi người khác xác nhận hoặc xác nhận sau lúc lập. */
function xacNhanRieng(phieu: PaymentReceiptRow): boolean {
  if (!phieu.received_at) return false;
  if (phieu.received_by_name && phieu.received_by_name !== phieu.created_by_name) return true;
  return Date.parse(phieu.received_at) - Date.parse(phieu.created_at) > LECH_XAC_NHAN_MS;
}

/** Dòng thời gian của MỘT phiếu thu: lập, xác nhận đã thu (phiếu cũ), thêm chứng từ, hủy. */
export function viecLichSuThu(phieu: PaymentReceiptRow, tep: PaymentReceiptAttachment[]): ViecLs[] {
  const nguoi: [number | null, string | null][] = [
    [phieu.created_by_user_id, phieu.created_by_name],
    [phieu.received_by_user_id, phieu.received_by_name],
    [phieu.cancelled_by_user_id, phieu.cancelled_by_name],
  ];
  const tenLap =
    phieu.source_type === "sales_invoice"
      ? "Lập phiếu thu từ Công nợ phải thu"
      : phieu.source_type === "order_deposit"
        ? "Lập phiếu thu từ Đơn hàng bán"
        : "Lập phiếu thu";
  const ds: ViecLs[] = [
    viecLap(phieu.created_at, tenLap, phieu.amount_vnd, methodText(phieu), phieu.created_by_name),
  ];
  if (phieu.received_at && Date.parse(phieu.received_at) - Date.parse(phieu.created_at) > LECH_XAC_NHAN_MS) {
    ds.push({
      khoa: "xac-nhan",
      moc: phieu.received_at,
      loai: "lap",
      ten: "Xác nhận đã thu",
      chiTiet: phieu.received_by_name ? <span>{phieu.received_by_name}</span> : null,
    });
  }
  ds.push(...viecThemTep(tep, (id) => tenTheoId(id, nguoi), phieu.created_at));
  if (phieu.cancelled_at) ds.push(viecHuy(phieu.cancelled_at, phieu.cancelled_by_name, phieu.cancel_reason));
  return xepMoiNhat(ds);
}


export function ReceiptsDrawer({
  dau,
  eventTick,
  quyen,
  len,
  xuong,
  onDong,
  onDoi,
  onSua,
  onMoDonBan,
  onMoPhieuChi,
  onMoCongNo,
}: {
  /** Dòng của bảng — vẽ ngay, rồi ngăn tự nạp bản mới nhất. */
  dau: PaymentReceiptRow;
  eventTick: number;
  quyen: QuyenNganThu;
  len?: () => void;
  xuong?: () => void;
  onDong: () => void;
  /** Phiếu vừa đổi (hủy, xác nhận, thêm/xoá chứng từ) — trang nạp lại bảng và thẻ lọc. */
  onDoi: () => void;
  /** Mở form sửa phiếu cũ chờ thu (PT-4). */
  onSua: (row: PaymentReceiptRow) => void;
  onMoDonBan?: (orderId: number) => void;
  onMoPhieuChi?: (code: string) => void;
  /** Mở Công nợ phải thu, ngăn của đúng khách (lỗi thật số 11). */
  onMoCongNo?: (khach: { id: number | null; name: string }) => void;
}) {
  const { token } = useAuth();
  const [phieu, setPhieu] = useState<PaymentReceiptRow>(dau);
  const [tep, setTep] = useState<PaymentReceiptAttachment[]>([]);
  // Chưa nạp xong danh sách tệp thì tin `attachment_count` của dòng — tab không nháy "chưa có".
  const [tepDaNap, setTepDaNap] = useState(false);
  const [hd, setHd] = useState<SalesInvoiceRow | null | "loi">(null);
  // Tab đang xem nhớ tới khi đóng trang (đặc tả A.5).
  const [tab, setTab] = useTabNho("phieu-thu");
  const [lamMoi, setLamMoi] = useState(0);
  const [loi, setLoi] = useState<string | null>(null);
  const [xacNhan, setXacNhan] = useState(false);
  const id = dau.id;

  // Đổi sang phiếu khác (↑ ↓): bỏ mọi thứ đang dở của phiếu trước.
  useEffect(() => {
    setPhieu(dau);
    setTep([]);
    setTepDaNap(false);
    setHd(null);
    setLoi(null);
    setXacNhan(false);
    huy.datLai();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Nạp lại phiếu + tệp: lúc mở, khi có sự kiện đẩy, và sau mỗi thao tác trong ngăn.
  useEffect(() => {
    if (!token) return;
    let conHieuLuc = true;
    api.accounting.receipt(token, id)
      .then((p) => conHieuLuc && setPhieu(p))
      .catch(() => undefined);
    api.accounting.receiptAttachments(token, id)
      .then((r) => {
        if (!conHieuLuc) return;
        setTep(r.items);
        setTepDaNap(true);
      })
      .catch(() => conHieuLuc && setTep([]));
    return () => {
      conHieuLuc = false;
    };
  }, [token, id, eventTick, lamMoi]);

  // Giá trị hoá đơn, Trừ cọc, ngày và trạng thái hoá đơn nằm ở hoá đơn bán, không ở phiếu.
  const donId = phieu.source_type === "sales_invoice" ? phieu.order_id : null;
  const hdId = phieu.sales_invoice_id;
  useEffect(() => {
    if (!token || donId == null || hdId == null) return;
    let conHieuLuc = true;
    api.accounting.salesInvoices(token, donId)
      .then((r) => conHieuLuc && setHd(r.items.find((h) => h.id === hdId) ?? "loi"))
      .catch(() => conHieuLuc && setHd("loi"));
    return () => {
      conHieuLuc = false;
    };
  }, [token, donId, hdId, eventTick, lamMoi]);

  const thayDoi = () => {
    setLamMoi((n) => n + 1);
    onDoi();
  };

  const huy = useHuyPhieu(
    token ? (lyDo) => api.accounting.cancelReceipt(token, phieu.id, lyDo) : null,
    (p: PaymentReceiptRow) => {
      setPhieu(p);
      thayDoi();
    },
  );

  const hoaDon = hd && hd !== "loi" ? hd : null;
  // Phiếu thu hoá đơn mà thiếu mã đơn / mã hoá đơn: không có gì để tải — nói không đọc được ngay.
  const khongDocDuocHd = hd === "loi" || donId == null || hdId == null;
  const heQuaHuy =
    // Chỉ hoá đơn còn hiệu lực mới "quay lại còn nợ": hoá đơn đã hủy máy chủ ép còn nợ về 0.
    phieu.source_type === "sales_invoice" && phieu.status === "received" && hoaDon?.status === "issued"
      ? `Hoá đơn ${hoaDon.invoice_number} sẽ quay lại còn nợ ${tien(hoaDon.remaining_amount + phieu.amount_vnd)}`
      : phieu.source_type === "order_deposit" && phieu.status === "received"
        ? `${phieu.order_code ? `Đơn ${phieu.order_code}` : "Đơn bán"} sẽ bớt ${tien(phieu.amount_vnd)} đã cọc`
        : "Phiếu còn trong sổ với dấu Đã hủy";
  const huyDuoc = quyen.huy && phieu.status !== "cancelled";
  const choThu = phieu.status === "waiting_receipt";
  const suaDuoc = quyen.sua && choThu && phieu.source_type === "purchase_refund" && phieu.payment_voucher_id != null;
  const viec = viecLichSuThu(phieu, tep);
  const tt = STATUS_META[phieu.status];
  const so = soPhieu(phieu);
  const soTep = tepDaNap ? tep.length : phieu.attachment_count;
  const chuyenKhoan = phieu.receipt_method === "bank_transfer";
  const gop = laGop(phieu);
  // Phiếu gộp: mỗi đơn bán của các dòng một lần, theo thứ tự dòng.
  const donGop = gop
    ? [...new Map(phieu.lines!.map((l) => [l.order_id, l.order_code ?? String(l.order_id)])).entries()]
    : [];

  function inPhieu() {
    setLoi(null);
    if (!printReceipt(phieu)) setLoi("Trình duyệt đang chặn cửa sổ in. Cho phép cửa sổ bật lên rồi thử lại.");
  }

  return (
    <NganPhai
      duongDan={<DuongDanPhieu loai="Phiếu thu" ma={so} />}
      tieuDe={<span className="kt-ngan__soLon">{tien(phieu.amount_vnd)}</span>}
      the={
        <>
          <span className={`kt-tt kt-tt--${tt.mau}`}>{tt.label}</span>
          <ChuSoTien soVnd={phieu.amount_vnd} so={phieu.amount} tienTe={phieu.currency} tyGia={phieu.exchange_rate} />
        </>
      }
      hanhDong={
        <>
          {quyen.xacNhan && choThu && (
            <button type="button" className="kt-btn kt-btn--chinh"
              onClick={() => {
                setTab("tt");
                setXacNhan(true);
              }}>
              Xác nhận đã thu
            </button>
          )}
          {suaDuoc && (
            <button type="button" className="kt-btn" onClick={() => onSua(phieu)}>
              <Pencil size={16} aria-hidden="true" />
              Sửa
            </button>
          )}
          {quyen.in && (
            <button type="button" className="kt-btn" onClick={inPhieu}>
              <Printer size={16} aria-hidden="true" />
              In phiếu
            </button>
          )}
          {huyDuoc && (
            <MenuThaoTac muc={[{
              nhan: "Hủy phiếu",
              phu: heQuaHuy,
              nguy: true,
              onChon: () => {
                setTab("tt");
                setXacNhan(false);
                huy.moKhung();
              },
            }]} />
          )}
        </>
      }
      tabs={[
        { id: "tt", nhan: "Chi tiết" },
        tabChungTuGoc(soTep, phieu.status === "received"),
        { id: "ls", nhan: "Lịch sử", dem: viec.length },
      ]}
      tab={tab}
      onTab={setTab}
      len={len}
      xuong={xuong}
      onDong={onDong}
      chanDong={huy.goDo}
      cot={
        <RayThuocTinh o={[
          { nhan: "Người nộp tiền", giaTri: phieu.payer_name || "—" },
          { nhan: "Mục thu", giaTri: phieu.muc_thu_chi_ten || <span className="kt-mo">Chưa phân loại</span> },
          // Ô Địa chỉ của mẫu 01-TT — trước nằm ở biên lai, giờ đứng ngay dưới người nộp.
          { nhan: "Địa chỉ người nộp", giaTri: phieu.payer_address },
          { nhan: "Hình thức", giaTri: methodText(phieu) },
          { nhan: "Ngày thu", giaTri: ngay(phieu.receipt_date) },
          // Gọi như hàm: tài khoản trống thì ra null ⇒ ô ẩn (bọc JSX thì ô hiện nhãn mà không có gì).
          { nhan: "Vào tài khoản", giaTri: chuyenKhoan
              ? TaiKhoanO({ nganHang: phieu.company_bank_name, so: phieu.company_account_number, chiNhanh: phieu.company_bank_branch })
              : null },
          { nhan: "Mã giao dịch", giaTri: phieu.bank_reference },
          { nhan: "Đơn bán", giaTri: gop ? (
            <Cum>
              {donGop.map(([oid, ma]) =>
                onMoDonBan ? (
                  <button key={oid} type="button" className="kt-lk" onClick={() => onMoDonBan(oid)}>{ma}</button>
                ) : (
                  <span key={oid}>{ma}</span>
                ),
              )}
            </Cum>
          ) : !phieu.order_code || phieu.source_type === "purchase_refund" ? null
              : onMoDonBan && phieu.order_id != null ? (
                <button type="button" className="kt-lk" onClick={() => onMoDonBan(phieu.order_id!)}>{phieu.order_code}</button>
              ) : phieu.order_code },
          { nhan: "Phiếu chi gốc", giaTri: phieu.source_type !== "purchase_refund" || !phieu.payment_voucher_code ? null
              : onMoPhieuChi ? (
                <button type="button" className="kt-lk" onClick={() => onMoPhieuChi(phieu.payment_voucher_code!)}>
                  {phieu.payment_voucher_code}
                </button>
              ) : phieu.payment_voucher_code },
          { nhan: "Người lập", giaTri: <NguoiLapO ten={phieu.created_by_name} moc={phieu.created_at} /> },
          // Cùng người, cùng lúc lập (mọi phiếu mới) ⇒ đã nói ở Người lập, không nói lại.
          { nhan: "Xác nhận đã thu", giaTri: xacNhanRieng(phieu) ? (
            <Cum>
              <span>{phieu.received_by_name || "—"}</span>
              <TheNho>{ngayGio(phieu.received_at!)}</TheNho>
            </Cum>
          ) : null },
          // Phiếu chưa có số in thì số phiếu ở đường dẫn ĐÃ là mã hệ thống — không nói lại.
          { nhan: "Mã hệ thống", giaTri: phieu.doc_no ? <span className="kt-mo">{phieu.code}</span> : null },
          { nhan: "Ghi chú", giaTri: phieu.note },
        ]} />
      }
    >
      {phieu.status === "cancelled" && <BangDaHuy moc={phieu.cancelled_at} lyDo={phieu.cancel_reason} />}
      {loi && <p className="kt-o__loi" role="alert"><CircleAlert size={14} aria-hidden="true" />{loi}</p>}

      {tab === "tt" && (
        <>
          {xacNhan && choThu && token && (
            <KhungXacNhanDaThu
              phieu={phieu}
              goi={(ref) => api.accounting.markReceiptReceived(token, phieu.id, ref)}
              onXong={(p) => {
                setXacNhan(false);
                setPhieu(p);
                thayDoi();
              }}
              onDong={() => setXacNhan(false)}
            />
          )}
          {huy.mo && (
            <KhungHuyPhieu ma={so} huy={huy}
              ghi="Phiếu vẫn còn trong sổ với dấu Đã hủy, in ra có chữ ĐÃ HỦY. Cần thu lại thì lập phiếu mới." />
          )}

          <div className="kt-ngan__muc">Lý do nộp</div>
          <p className="kt-ngan__ly">{phieu.content || "—"}</p>

          {gop && (
            <>
              <div className="kt-ngan__muc">
                <span>Các khoản trong phiếu</span>
              </div>
              <div className="lds-bang">
                <table className="lds-g" aria-label="Các khoản trong phiếu"
                  style={{ minWidth: COT_GOP.reduce((t, w) => t + w, 0) }}>
                  <colgroup>
                    {COT_GOP.map((w, i) => <col key={i} style={{ width: w }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Đơn bán</th>
                      <th>Khoản</th>
                      <th className="n">Thu trước đó</th>
                      <th className="n">Phiếu này</th>
                      <th className="n">Còn nợ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phieu.lines!.map((l) => {
                      // Đối chiếu chỉ có cho dòng hoá đơn (cọc không phải nợ).
                      const dc = l.invoice_number
                        ? phieu.doi_chieu?.find((d) => d.order_code === l.order_code && d.invoice_number === l.invoice_number)
                        : undefined;
                      return (
                        <tr key={l.sales_invoice_id != null ? `hd-${l.sales_invoice_id}` : `coc-${l.order_id}`}>
                          <td>
                            {onMoDonBan ? (
                              <button type="button" className="kt-lk" onClick={() => onMoDonBan(l.order_id)}>{l.order_code}</button>
                            ) : (
                              l.order_code
                            )}
                          </td>
                          <td>{l.invoice_number ? `HĐ ${l.invoice_number}` : "Cọc"}</td>
                          <td className="n"><OSo so={dc?.truoc_do} /></td>
                          <td className="n">{vietSo(l.amount)}</td>
                          <td className="n"><OSo so={dc?.con_no_sau} /></td>
                        </tr>
                      );
                    })}
                    <tr className="lds-cong">
                      <td colSpan={3}>{`Cộng ${vietSo(phieu.lines!.length)} khoản`}</td>
                      <td className="n">{vietSo(phieu.amount_vnd)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}

          {phieu.source_type === "sales_invoice" && !gop && (
            <>
              <div className="kt-ngan__muc">
                <span>Áp vào hoá đơn</span>
                {onMoCongNo && hoaDon && (
                  <button type="button" className="kt-lk"
                    onClick={() => onMoCongNo({ id: hoaDon.customer_id, name: hoaDon.customer_name })}>
                    Mở công nợ khách này
                    <ExternalLink size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
              {hoaDon ? (
                <div className="lds-bang">
                  <table className="lds-g" style={{ minWidth: RONG_HD }}>
                    <colgroup>
                      {COT_HD.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Hoá đơn</th>
                        <th>Ngày</th>
                        <th className="n">Giá trị</th>
                        <th className="n">Trừ cọc</th>
                        <th className="n">Thu trước đó</th>
                        <th className="n">Phiếu này</th>
                        <th className="n">Còn nợ</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ whiteSpace: "normal", lineHeight: "20px" }}>
                          <span className="kt-ma-hd">{[hoaDon.invoice_symbol, hoaDon.invoice_number].filter(Boolean).join(" ")}</span>
                          {hoaDon.status === "cancelled" && <TheNho>Đã hủy</TheNho>}
                        </td>
                        <td>{ngay(hoaDon.invoice_date)}</td>
                        <td className="n"><OSo so={hoaDon.amount_vnd} /></td>
                        <td className="n"><OSo so={hoaDon.deposit_offset_amount} /></td>
                        <td className="n"><OSo so={phieu.truoc_do} /></td>
                        <td className="n">{vietSo(phieu.amount_vnd)}</td>
                        <td className="n"><OSo so={phieu.con_no_sau} /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="kt-mo">
                  {khongDocDuocHd ? "Không đọc được số của hoá đơn này." : "Đang tải hoá đơn…"}
                </p>
              )}
            </>
          )}
        </>
      )}

      {tab === "ct" && token && (
        <TabChungTu tep={tep} daHuy={phieu.status === "cancelled"} coQuyen={quyen.lap} onDoi={thayDoi}
          taiMot={(f) => api.accounting.uploadReceiptAttachment(token, phieu.id, f)}
          xoaMot={(tepId) => api.accounting.deleteReceiptAttachment(token, phieu.id, tepId)}
          chuKeo="Kéo ảnh báo có hoặc biên nhận vào đây" chuChuaCo="Chưa có chứng từ. Kéo ảnh báo có vào đây" />
      )}

      {tab === "ls" && <TabLichSu viec={viec} />}
    </NganPhai>
  );
}

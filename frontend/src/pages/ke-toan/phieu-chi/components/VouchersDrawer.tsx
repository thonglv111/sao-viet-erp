/** Ngăn CHI TIẾT một phiếu chi (đặc tả A.5, PC-2, PC-6) — vỏ chung `NganPhai`, ngăn kiểu 3 của
 *  phương án A (docs/mockups/ke-toan-gon-3-phuong-an.html, 07/10/2026).
 *
 *  Đầu ngăn: đường dẫn "Phiếu chi > số phiếu" + chép số — SỐ TIỀN làm tiêu đề + pill + bằng chữ —
 *  "In phiếu", "⋯" — tab Chi tiết / Chứng từ gốc / Lịch sử. Thân chia hai: bên trái lý do chi và
 *  bảng đối chiếu đợt giao, bên phải cột thuộc tính xếp dọc (người nhận, tài khoản, đơn, người lập…).
 *  Mỗi thông tin nói một lần: số tiền chỉ ở tiêu đề (và ô "Phiếu này" của bảng đối chiếu).
 *  Ngăn tự nạp lại phiếu và tệp đính kèm khi có sự kiện đẩy (`eventTick`).
 *  Hủy phiếu là KHUNG viền đỏ ở đầu tab Chi tiết, lỗi nằm ngay trong khung (không banner sau lớp phủ).
 *  Phiếu chi không sửa được: sai thì hủy (có lý do) rồi lập lại.
 */
import { CircleAlert, ExternalLink, Printer } from "lucide-react";
import { useEffect, useState } from "react";

import {
  api,
  type PaymentVoucherAttachment,
  type PaymentVoucherRow,
  type PurchaseRequestRow,
} from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import { taiVaInBangKe } from "../../../../utils/printBangKeTamUng";
import { NganPhai } from "../../shared/NganPhai";
import { Cum, TheNho } from "../../shared/Cum";
import { ngay, tien, vietSo } from "../../shared/dinhDang";
import { RayThuocTinh, soPhieu } from "../../shared/LuoiGon";
import {
  BangDaHuy,
  ChuSoTien,
  DuongDanPhieu,
  KhungHuyPhieu,
  MenuThaoTac,
  useHuyPhieu,
  useTabNho,
} from "../../shared/NganPhieu";
import { NguoiLapO, OSo, TaiKhoanO, tabChungTuGoc } from "../../shared/PhieuGon";
import { laGop } from "../../shared/phieuGop";
import { TabChungTu } from "../../shared/TabChungTu";
import { printVoucher } from "../print";
import { SOURCE_LABELS, STATUS_META, VOUCHER_METHOD_LABELS, nguonPhieu } from "../shared/list-constants";
import { TabLichSu, viecLichSu } from "./TabLichSu";

export type QuyenNgan = {
  /** Gán / xoá chứng từ (ô Lập của màn Phiếu chi). */
  lap: boolean;
  huy: boolean;
  in: boolean;
  /** Ô Xem của màn Đơn mua hàng (Kế toán) — mới mở được đơn và đọc số đợt giao. */
  xemDonMua: boolean;
};

/** Đợt giao chia HAI bảng xếp chồng (13/10/2026): bảng đợt (Đợt | Ngày nhận hàng | Số hoá đơn | Ký hiệu
 *  | Ngày hoá đơn | Hàng) và bảng tiền (Giá trị đợt | Trừ cọc | Trả trước đó | Phiếu này | Còn nợ). Gộp
 *  một bảng thì tối thiểu ~1170px, quá cột trái ngăn rộng mặc định (đo 820px) ⇒ cột tiền trôi khỏi màn.
 *  Ngày nhận hàng và ngày hoá đơn tách cột vì hạn trả tính từ ngày hoá đơn. Đo font thật 13px:
 *  "1.234.567.890" 94px ⇒ cột tiền 114 (+2px vì ô lds-g đệm 10px); Trừ cọc, Trả trước đó 104 (đủ trăm
 *  triệu); "Ngày nhận hàng" ⇒ 120, "0000123" ⇒ 112, "1C26TAA" ⇒ 88. Cột Hàng giữ tối thiểu 200 (116 thì
 *  ba tên giấy xếp thành sáu dòng, bảng cao 250px). Khung hẹp hơn thì bảng cuộn ngang. */
const COT_DOT = [56, 120, 112, 88, 114, null];
const COT_TIEN_DOT = [116, 106, 106, 116, 116];
const COT_GOP = [120, 72, 104, 112, 112, 112];
const rongToiThieu = (cot: (number | null)[]) => cot.reduce<number>((t, w) => t + (w ?? 200), 0);

export function VouchersDrawer({
  dau,
  eventTick,
  quyen,
  len,
  xuong,
  onDong,
  onDoi,
  onMoDonMua,
  onMoPhieuThu,
  onMoYeuCau,
}: {
  /** Dòng của bảng — vẽ ngay, rồi ngăn tự nạp bản mới nhất. */
  dau: PaymentVoucherRow;
  eventTick: number;
  quyen: QuyenNgan;
  len?: () => void;
  xuong?: () => void;
  onDong: () => void;
  /** Phiếu vừa đổi (hủy, thêm/xoá chứng từ) — trang nạp lại bảng và thẻ lọc. */
  onDoi: () => void;
  onMoDonMua?: (code: string) => void;
  onMoPhieuThu: (code: string) => void;
  /** Mở màn Yêu cầu mua hàng theo mã — chỉ truyền khi người xem có ô Xem của màn đó. */
  onMoYeuCau?: (code: string) => void;
}) {
  const { token } = useAuth();
  const [phieu, setPhieu] = useState<PaymentVoucherRow>(dau);
  const [tep, setTep] = useState<PaymentVoucherAttachment[]>([]);
  // Chưa nạp xong danh sách tệp thì tin `attachment_count` của dòng — tab không nháy "chưa có".
  const [tepDaNap, setTepDaNap] = useState(false);
  const [don, setDon] = useState<PurchaseRequestRow | null>(null);
  // Tab đang xem nhớ tới khi đóng trang (đặc tả A.5).
  const [tab, setTab] = useTabNho("phieu-chi");
  const [lamMoi, setLamMoi] = useState(0);
  const [loi, setLoi] = useState<string | null>(null);
  const id = dau.id;

  // Đổi sang phiếu khác (↑ ↓): bỏ mọi thứ đang dở của phiếu trước.
  useEffect(() => {
    setPhieu(dau);
    setTep([]);
    setTepDaNap(false);
    setDon(null);
    setLoi(null);
    huy.datLai();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Nạp lại phiếu + tệp: lúc mở, khi có sự kiện đẩy, và sau mỗi thao tác trong ngăn.
  useEffect(() => {
    if (!token) return;
    let conHieuLuc = true;
    api.accounting.voucher(token, id)
      .then((p) => conHieuLuc && setPhieu(p))
      .catch(() => undefined);
    api.accounting.voucherAttachments(token, id)
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

  // Giá trị đợt và Trừ cọc nằm ở đơn mua, không ở phiếu.
  const donId = phieu.source_type === "purchase_request" ? phieu.purchase_request_id : null;
  useEffect(() => {
    if (!token || donId == null || !quyen.xemDonMua) return;
    let conHieuLuc = true;
    api.purchaseRequests.get(token, donId)
      .then((d) => conHieuLuc && setDon(d))
      .catch(() => conHieuLuc && setDon(null));
    return () => {
      conHieuLuc = false;
    };
  }, [token, donId, quyen.xemDonMua, eventTick, lamMoi]);

  const thayDoi = () => {
    setLamMoi((n) => n + 1);
    onDoi();
  };

  // Khung hủy phiếu (PC-6).
  const huy = useHuyPhieu(
    token ? (lyDo) => api.accounting.cancelVoucher(token, phieu.id, lyDo) : null,
    (p: PaymentVoucherRow) => {
      setPhieu(p);
      thayDoi();
    },
  );

  const nguon = nguonPhieu(phieu);
  const so = soPhieu(phieu);
  const coThuLai = phieu.receipt_received_amount + phieu.receipt_pending_amount > 0;
  const lyDoKhongHuy = coThuLai ? "Phiếu đã có phiếu thu lại — hủy phiếu thu trước" : null;
  const huyDuoc = quyen.huy && phieu.status === "paid";
  const viec = viecLichSu(phieu, tep);
  const soTep = tepDaNap ? tep.length : phieu.attachment_count;

  function inPhieu() {
    setLoi(null);
    if (!printVoucher(phieu)) setLoi("Trình duyệt đang chặn cửa sổ in. Cho phép cửa sổ bật lên rồi thử lại.");
  }

  const chuyenKhoan = phieu.voucher_type === "bank_transfer";
  const laDonMua = phieu.source_type === "purchase_request";
  const dot = don && phieu.delivery_id != null ? don.deliveries.find((d) => d.id === phieu.delivery_id) ?? null : null;
  // Người nhận: chuyển khoản là bên được trả (NCC), chủ tài khoản đứng riêng ở ô dưới; tiền mặt là
  // người cầm tiền ký nhận.
  const nguoiNhan = chuyenKhoan
    ? phieu.supplier_name || phieu.beneficiary_account_holder
    : phieu.cash_recipient_name || phieu.supplier_name;
  const gop = laGop(phieu);
  const moDon = laDonMua && !gop && nguon.ma && onMoDonMua ? () => onMoDonMua(nguon.ma!) : undefined;
  // Phiếu gộp: mỗi đơn mua của các dòng một lần, theo thứ tự dòng.
  const maDonGop = gop ? [...new Set(phieu.lines!.map((l) => l.purchase_code).filter((m): m is string => !!m))] : [];

  return (
    <NganPhai
      duongDan={<DuongDanPhieu loai="Phiếu chi" ma={so} />}
      tieuDe={<span className="kt-ngan__soLon">{tien(phieu.amount_vnd)}</span>}
      the={
        <>
          <span className={`kt-tt kt-tt--${phieu.status === "paid" ? "xanh" : "xam"}`}>{STATUS_META[phieu.status].label}</span>
          <ChuSoTien soVnd={phieu.amount_vnd} so={phieu.amount} tienTe={phieu.currency} tyGia={phieu.exchange_rate} />
        </>
      }
      hanhDong={
        <>
          {quyen.in && (
            <button type="button" className="kt-btn" onClick={inPhieu}>
              <Printer size={16} aria-hidden="true" />
              In phiếu
            </button>
          )}
          {quyen.in && phieu.source_type === "salary_advance" && token && (
            <button type="button" className="kt-btn"
              onClick={() => {
                setLoi(null);
                taiVaInBangKe(token, phieu.id).catch((e: Error) => setLoi(e.message));
              }}>
              In bảng kê
            </button>
          )}
          {huyDuoc && (
            <MenuThaoTac muc={[{
              nhan: "Hủy phiếu",
              phu: lyDoKhongHuy ?? "Phiếu còn trong sổ với dấu Đã hủy",
              nguy: true,
              khoa: !!lyDoKhongHuy,
              onChon: () => {
                setTab("tt");
                huy.moKhung();
              },
            }]} />
          )}
        </>
      }
      tabs={[
        { id: "tt", nhan: "Chi tiết" },
        tabChungTuGoc(soTep, phieu.status === "paid"),
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
          { nhan: "Người nhận tiền", giaTri: nguoiNhan || "—" },
          { nhan: "Mục chi", giaTri: phieu.muc_thu_chi_ten || <span className="kt-mo">Chưa phân loại</span> },
          // Phiếu hoàn tiền khách: tiền này vào Công nợ phải thu của đúng khách.
          { nhan: "Khách hàng", giaTri: phieu.customer_name },
          { nhan: "Hình thức", giaTri: VOUCHER_METHOD_LABELS[phieu.voucher_type] },
          { nhan: "Ngày chi", giaTri: ngay(phieu.voucher_date) },
          // Thiếu cả ngân hàng, số lẫn chi nhánh thì `TaiKhoanO` (gọi như hàm) trả null ⇒ ô ẩn hẳn, không còn nhãn trơ.
          { nhan: "Từ tài khoản", giaTri: chuyenKhoan
              && TaiKhoanO({ nganHang: phieu.company_bank_name, so: phieu.company_account_number, chiNhanh: phieu.company_bank_branch }) },
          { nhan: "Tới tài khoản", giaTri: chuyenKhoan
              && TaiKhoanO({ nganHang: phieu.beneficiary_bank_name, so: phieu.beneficiary_account_number,
                chiNhanh: phieu.beneficiary_bank_branch }) },
          // Trùng tên người nhận thì không nói lại.
          { nhan: "Chủ tài khoản nhận", giaTri: chuyenKhoan && phieu.beneficiary_account_holder !== nguoiNhan
              && phieu.beneficiary_account_holder },
          { nhan: "Địa chỉ người nhận", giaTri: !chuyenKhoan && phieu.cash_recipient_address },
          { nhan: "CCCD người nhận", giaTri: !chuyenKhoan && phieu.cash_recipient_identity },
          // Mã nguồn: đơn mua (mở được khi có quyền), lệnh gia công, phiếu tạm ứng lương.
          { nhan: SOURCE_LABELS[phieu.source_type] ?? "Nguồn", giaTri: gop ? (
            <Cum>
              {maDonGop.map((ma) =>
                onMoDonMua ? (
                  <button key={ma} type="button" className="kt-lk" onClick={() => onMoDonMua(ma)}>{ma}</button>
                ) : (
                  <span key={ma}>{ma}</span>
                ),
              )}
            </Cum>
          ) : nguon.ma && (moDon
              ? <button type="button" className="kt-lk" onClick={moDon}>{nguon.ma}</button>
              : nguon.ma) },
          { nhan: "Yêu cầu mua", giaTri: phieu.source_request_codes.length > 0 && (
            <Cum>
              {phieu.source_request_codes.map((ma) =>
                onMoYeuCau ? (
                  <button key={ma} type="button" className="kt-lk" onClick={() => onMoYeuCau(ma)}>{ma}</button>
                ) : (
                  <span key={ma}>{ma}</span>
                ),
              )}
            </Cum>
          ) },
          { nhan: "Số chứng từ", giaTri: phieu.invoice_number && (
            <Cum>
              <span>{phieu.invoice_number}</span>
              {phieu.invoice_date && <TheNho>{`Ngày ${ngay(phieu.invoice_date)}`}</TheNho>}
            </Cum>
          ) },
          { nhan: "Số hợp đồng", giaTri: phieu.contract_number },
          { nhan: "Mã giao dịch ngân hàng", giaTri: phieu.bank_reference },
          { nhan: "Người lập", giaTri: <NguoiLapO ten={phieu.created_by_name} moc={phieu.created_at} /> },
          // Phiếu chưa có số in thì số phiếu ở đường dẫn ĐÃ là mã hệ thống — không nói lại.
          { nhan: "Mã hệ thống", giaTri: phieu.doc_no && <span className="kt-mo">{phieu.code}</span> },
          { nhan: "Ghi chú", giaTri: phieu.note },
        ]} />
      }
    >
      {phieu.status === "cancelled" && <BangDaHuy moc={phieu.cancelled_at} lyDo={phieu.cancel_reason} />}
      {loi && <p className="kt-o__loi" role="alert"><CircleAlert size={14} aria-hidden="true" />{loi}</p>}

      {tab === "tt" && (
        <>
          {huy.mo && (
            <KhungHuyPhieu ma={so} huy={huy}
              ghi="Phiếu vẫn còn trong sổ với dấu Đã hủy, in ra có chữ ĐÃ HỦY. Cần chi lại thì lập phiếu mới." />
          )}

          <div className="kt-ngan__muc">Lý do chi</div>
          <p className="kt-ngan__ly">{phieu.content || "—"}</p>

          {coThuLai && (
            <div className="kt-bang-xam">
              <span className="kt-cum">
                {phieu.receipt_received_amount > 0 && <span>{`Đã thu lại ${tien(phieu.receipt_received_amount)}`}</span>}
                {phieu.receipt_pending_amount > 0 && <span>{`Chờ thu ${tien(phieu.receipt_pending_amount)}`}</span>}
                <button type="button" className="kt-lk" onClick={() => onMoPhieuThu(phieu.code)}>Xem phiếu thu</button>
              </span>
            </div>
          )}

          {laDonMua && gop && (
            <>
              <div className="kt-ngan__muc">
                <span>Các khoản trong phiếu</span>
              </div>
              <div className="lds-bang">
                <table className="lds-g" aria-label="Các khoản trong phiếu" style={{ minWidth: rongToiThieu(COT_GOP) }}>
                  <colgroup>
                    {COT_GOP.map((w, i) => <col key={i} style={{ width: w }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Đơn mua</th>
                      <th>Khoản</th>
                      <th>Số hoá đơn</th>
                      <th className="n">Trả trước đó</th>
                      <th className="n">Phiếu này</th>
                      <th className="n">Còn nợ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phieu.lines!.map((l) => {
                      // Đối chiếu chỉ có cho dòng đợt giao (cọc không phải nợ).
                      const dc = l.delivery_seq_no != null
                        ? phieu.doi_chieu?.find((d) => d.purchase_code === l.purchase_code && d.delivery_seq_no === l.delivery_seq_no)
                        : undefined;
                      return (
                        <tr key={`${l.purchase_request_id}:${l.delivery_id ?? "coc"}`}>
                          <td>
                            {onMoDonMua && l.purchase_code ? (
                              <button type="button" className="kt-lk" onClick={() => onMoDonMua(l.purchase_code!)}>
                                {l.purchase_code}
                              </button>
                            ) : (
                              l.purchase_code
                            )}
                          </td>
                          <td>{l.delivery_seq_no != null ? `Đợt ${l.delivery_seq_no}` : "Cọc"}</td>
                          <td>{l.invoice_number || <span className="lds-mu3">–</span>}</td>
                          <td className="n"><OSo so={dc?.truoc_do} /></td>
                          <td className="n">{vietSo(l.amount)}</td>
                          <td className="n"><OSo so={dc?.con_no_sau} /></td>
                        </tr>
                      );
                    })}
                    <tr className="lds-cong">
                      <td colSpan={4}>{`Cộng ${vietSo(phieu.lines!.length)} khoản`}</td>
                      <td className="n">{vietSo(phieu.amount_vnd)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}

          {laDonMua && !gop && (
            <>
              <div className="kt-ngan__muc">
                <span>{phieu.payment_stage === "advance" ? "Đặt cọc cho đơn mua" : "Trả cho đợt giao"}</span>
                {moDon && (
                  <button type="button" className="kt-lk" onClick={moDon}>
                    Mở đơn mua
                    <ExternalLink size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
              {phieu.payment_stage === "advance" ? (
                <p className="kt-mo">Phiếu đặt cọc không gắn đợt giao. Cọc trừ dần vào công nợ của cả đơn.</p>
              ) : phieu.delivery_seq_no == null ? (
                <p className="kt-mo">Đơn không theo dõi theo đợt giao.</p>
              ) : (
                <>
                  <div className="lds-bang">
                    <table className="lds-g" aria-label="Đợt giao" style={{ minWidth: rongToiThieu(COT_DOT) }}>
                      <colgroup>
                        {COT_DOT.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Đợt</th>
                          <th>Ngày nhận hàng</th>
                          <th>Số hoá đơn</th>
                          <th>Ký hiệu</th>
                          <th>Ngày hoá đơn</th>
                          <th>Hàng</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{`Đợt ${phieu.delivery_seq_no}`}</td>
                          <td>{dot?.delivery_date ? ngay(dot.delivery_date) : <span className="lds-mu3">–</span>}</td>
                          <td title={dot?.invoice_number || undefined}>
                            {dot?.invoice_number || <span className="lds-mu3">–</span>}
                          </td>
                          <td className="lds-mu">{dot?.invoice_symbol || <span className="lds-mu3">–</span>}</td>
                          <td>{dot?.invoice_date ? ngay(dot.invoice_date) : <span className="lds-mu3">–</span>}</td>
                          <td style={{ whiteSpace: "normal", lineHeight: "24px" }}
                            title={dot?.lines.map((l) => l.item_name).join("\n") || undefined}>
                            {dot && dot.lines.length > 0
                              ? <Cum>{dot.lines.map((l) => <TheNho key={l.id}>{l.item_name}</TheNho>)}</Cum>
                              : <span className="lds-mu3">–</span>}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="lds-bang">
                    <table className="lds-g" aria-label="Tiền của đợt" style={{ minWidth: rongToiThieu(COT_TIEN_DOT) }}>
                      <colgroup>
                        {COT_TIEN_DOT.map((w, i) => <col key={i} style={{ width: w }} />)}
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="n">Giá trị đợt</th>
                          <th className="n">Trừ cọc</th>
                          <th className="n">Trả trước đó</th>
                          <th className="n">Phiếu này</th>
                          <th className="n">Còn nợ</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="n"><OSo so={dot?.amount} /></td>
                          <td className="n"><OSo so={dot?.coc_bu} /></td>
                          <td className="n"><OSo so={phieu.truoc_do} /></td>
                          <td className="n">{vietSo(phieu.amount_vnd)}</td>
                          <td className="n"><OSo so={phieu.con_no_sau} /></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {tab === "ct" && token && (
        <TabChungTu tep={tep} daHuy={phieu.status === "cancelled"} coQuyen={quyen.lap} onDoi={thayDoi}
          taiMot={(f) => api.accounting.uploadVoucherAttachment(token, phieu.id, f)}
          xoaMot={(tepId) => api.accounting.deleteVoucherAttachment(token, phieu.id, tepId)}
          chuKeo="Kéo ảnh hoá đơn hoặc ủy nhiệm chi vào đây" chuChuaCo="Chưa có chứng từ. Kéo ảnh biên nhận vào đây" />
      )}

      {tab === "ls" && <TabLichSu viec={viec} />}
    </NganPhai>
  );
}

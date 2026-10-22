// PHA SAU của DRAWER Thực hiện sản xuất — Giai đoạn 3 (sản lượng · bàn giao · vật tư). Hỗ trợ chéo
// (Giai đoạn 4) gỡ 10/10/2026 (mg 0389): người tổ khác sang giúp được tổ thêm thẳng ở danh sách
// "Người làm lần này" của hộp Ghi sản lượng / Sửa số. Lớp "chia sản lượng từng mẻ" GỠ 18/09/2026 (mg `0322`): mẻ ghi theo CÔNG VIỆC
// KHOÁN, người tham gia chỉ là danh sách — sản xuất không chia, không nhân ra tiền. Gộp thẳng vào drawer `ThsxDrawer` (KHÔNG đẻ màn
// mới): mỗi mặt là một khối; mọi biểu mẫu (Ghi mẻ, Sửa số mẻ, Đề xuất giao, Sửa mẻ) mở thành hộp
// thoại chung `thsx/ThsxHop` (09/10/2026).
//
// Component KHÔNG tự gọi API: mọi mặt GHI đi qua `exec.*` (controller lo khoá lạc quan + refetch +
// toast). Danh mục "Lý do & lỗi SX" ĐÃ GỠ (mg 0288): không khâu nào bắt nêu lý do nữa, chỗ nào cần
// nói thêm thì có ô mô tả TỰ DO tuỳ chọn.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import type {
  SxWorkItemChiTiet, SxBatch, SxBanGiao, SxBanGiaoChangSau, SxHoTroUngVien,
  SxBatchIn, SxBanGiaoDeXuatIn, SxBanGiaoSuaIn, SxSuaSoMeIn,
  SxBacTheoChon, SxKhoanCongDoan, SxViecPhatSinhChon, SxNguoiGhi, SxViecNgan, SxTuyChonKhai, SxTuyChonLanGhi,
  SxKetQuaNhanh, SxSuCoIn, SxVatTuCap, SxVatTuCapLan, SxVatTuCapDoiChieu, SxVatTuNhapLai, SxPhieuXuatVatTu,
  SxVatTuDeNghiIn, SxVatTuDeNghiDongIn, SxTranGhi, SxVatTuNhapLaiIn, SxVatTuCapKeHoach, SxWorkItem, HangLoai,
} from "../api/client";
import { ApiError } from "../api/client";
import { Button } from "../components/Button";
import { Icon } from "../components/Icons";
import { ChipTT, OTim, type MauTT } from "../components/LuoiDs";
import { useAuth } from "../auth/useAuth";
import { chuanKho, coDonViGoc, nhanKhoGiay } from "../lib/khoGiay";
import { TaoYeuCauP2, type DongTuCongViec, type DraftLine, type TuCongViec } from "./KhoDeNghiPage";
import { num, ngayGio, gioNgan } from "./keHoachSxShared";
import { ChungTuKhoNoi, type ChungTuKho } from "./gia-cong/ChungTuKhoNoi";
import { nhanChangLenh, nhanDonVi } from "./lsxBuoc";
import { tinhTrangChon } from "./thsxTinhTrangNguoi";
import { ThsxHop } from "./thsx/ThsxHop";

// ============================ hợp đồng hành động (controller cấp) ============================
export interface ThsxExec {
  // Đổi máy giữa chừng (§7.2 mở rộng 31/08/2026) — CHẠY thì đóng phiên máy cũ + mở phiên mới
  // CÙNG mốc (giờ máy cũ không mất); TẠM DỪNG thì chỉ đổi máy phân công, không mở phiên.
  doiMay: (mayId: number, lyDo?: string | null) => Promise<boolean>;
  // Báo sự cố tại tổ (31/08/2026) — KHÔNG có bảng sự cố riêng: ghi thẳng vào hộp thư "Báo máy
  // hỏng" của tổ sửa chữa, kèm neo về công việc/lệnh. Nhánh "Dừng sản xuất" gộp luôn cú tạm dừng.
  baoSuCo: (body: SxSuCoIn) => Promise<boolean>;
  taoBatch: (body: SxBatchIn) => Promise<SxKetQuaNhanh[] | null>;
  deXuatBanGiao: (body: SxBanGiaoDeXuatIn) => Promise<boolean>;
  suaBanGiao: (banGiaoId: number, body: SxBanGiaoSuaIn) => Promise<boolean>;
  xacNhanBanGiao: (banGiaoId: number, version: number) => Promise<boolean>;
  // Sửa số làm được của mẻ (10/10/2026, thay điều chỉnh bàn giao) — mẻ đã giao thì lần giao đổi theo.
  suaSoMe: (batchId: number, body: SxSuaSoMeIn) => Promise<boolean>;
  // Đề nghị cấp vật tư theo công đoạn — `deNghiId` là id ĐỀ NGHỊ SẢN XUẤT, không phải id yêu cầu kho.
  deNghiVatTu: (congViecId: number, body: SxVatTuDeNghiIn) => Promise<boolean>;
  suaDeNghiVatTu: (congViecId: number, deNghiId: number, body: SxVatTuDeNghiIn) => Promise<boolean>;
  /** Tổ yêu cầu NHẬP LẠI vật tư thừa vào kho (spec 2026-10-01 §3.5). */
  nhapLaiVatTu: (congViecId: number, body: SxVatTuNhapLaiIn) => Promise<boolean>;
  // Băng "Danh mục đã đổi" của mẻ (§7.2b): ảnh chụp việc khoán/phát sinh lấy số MỚI.
  capNhatDanhMucMe: (batchId: number) => Promise<boolean>;
}

interface Props {
  chiTiet: SxWorkItemChiTiet;
  busy: boolean;
  /** Thợ tổ SX khác — thêm được vào "Người làm lần này" của hộp Ghi sản lượng / Sửa số. */
  hoTroUngVien: SxHoTroUngVien[];
  /** Ngày XƯỞNG máy chủ trả kèm danh sách ứng viên — để nói "nghỉ phép hôm nay". */
  ungVienHomNay?: string | null;
  /** Mở hộp có ô thêm người tổ khác — trang nạp lại tình trạng ứng viên cho tươi. */
  onMoChonNguoi?: () => void;
  exec: ThsxExec;
  /** Tên tổ của bàn — form Kho mở từ tab Vật tư ghi "Bàn tổ … ›". */
  tenTo?: string;
  /** Phần của tab nào trong ngăn B: Sản lượng / Giao và nhận / Vật tư.
   *  Không truyền ⇒ cả bốn khối như trước. */
  phan?: "sl" | "gn" | "vt";
}

// ============================ helper thuần ==================================
export function toNum(s: string): number { const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) ? n : 0; }
export function toDtLocal(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(" ", "T").slice(0, 16); // "YYYY-MM-DDTHH:mm"
}
export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** "Bây giờ" theo khuôn `datetime-local` — chỗ dựa khi công việc chưa có mốc dự kiến. */
function nowDtLocal(): string {
  const d = new Date();
  return `${todayYmd()}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const BG_TT: Record<string, { txt: string; mau: MauTT }> = {
  proposed: { txt: "chờ xác nhận", mau: "vang" },
  confirmed: { txt: "đã xác nhận", mau: "la" },
};

/** Bên giao sửa số mẻ của lần giao đã xác nhận mà bên nhận CHƯA xác nhận lại số mới
 *  (`ban_giao.cho_xac_nhan_lai`). Số mới đã có hiệu lực — cờ này chỉ đòi bên nhận bấm Xác nhận lại. */
function choXacNhanLai(g: SxBanGiao): boolean {
  return g.trang_thai === "confirmed" && !g.xac_nhan_luc && !g.cung_to;
}
/** Lần giao bên nhận phải bấm: mới đề xuất, hoặc bên giao vừa sửa số mẻ của nó. */
function choBenNhan(g: SxBanGiao): boolean {
  return g.trang_thai === "proposed" || choXacNhanLai(g);
}
// Trạng thái YÊU CẦU KHO của một lần đề nghị — nhãn giữ Y HỆT `REQUEST_STATUS` (khoShared.tsx),
// hiện bằng `ChipTT` như các chip trạng thái khác của ngăn. Đừng bịa nhãn khác cho cùng trạng thái.
const VT_TT: Record<string, { txt: string; mau: MauTT }> = {
  approved: { txt: "Chờ xử lý", mau: "vang" },
  received: { txt: "Kho tiếp nhận", mau: "xanh" },
  preparing: { txt: "Đang chuẩn bị", mau: "tim" },
  partial: { txt: "Đã cấp một phần", mau: "cam" },
  done: { txt: "Hoàn tất", mau: "la" },
  rejected: { txt: "Từ chối", mau: "do" },
  cancelled: { txt: "Đã hủy", mau: "xam" },
};
/** Ngưỡng "coi như bằng nhau" — khớp `_EPS` phía BE, để hàng khớp không hiện chênh lệch rác.
 *  Dùng cho số CÙNG THANG TỔ KHAI (kế hoạch ↔ đã yêu cầu, "số này có > 0 không"). */
const VT_EPS = 0.0005;
/** Ngưỡng riêng cho phép so ĐÃ QUA KHO. Hai bên lưu hai thang khác nhau: SX giữ 3 chữ số
 *  (`sl_yeu_cau_goc` là `Numeric(18,3)`), kho giữ 2 (`sl_de_nghi` là `Numeric(14,2)`), nên chỉ
 *  riêng làm tròn đã đẻ ra sai khác tới 0,005 — gấp 10 lần `VT_EPS`. Đo thật lúc nghiệm thu: tổ
 *  xin 554 tờ = 166,967 kg, kho cấp đúng 166,97 kg, `lech_thuc_te` ra +0,003 và dòng đeo badge
 *  vàng VĨNH VIỄN dù không ai làm gì sai. Giấy gần như không bao giờ ra số tròn 2 chữ số nên mọi
 *  dòng giấy đều dính, mà cờ lệch lại là tín hiệu DUY NHẤT của cả tính năng đối chiếu.
 *  0,005 = nửa bước lượng tử của `Numeric(_, 2)`: đúng phần sai khác mà cấu trúc bắt buộc phải có.
 *  KHÔNG nới `VT_EPS` lên bằng nó — hằng kia còn gác luật "có xin món này không" (`vtCanTro`,
 *  `vtPayloadLines`), nới là đổi luôn luật dòng nào được gửi. */
const VT_EPS_KHO = 0.005;

/** Số LẦN đề nghị CÓ XIN món này — nhân tử của dung sai `VT_EPS_KHO` (xem `vtCoLechThucTe`).
 *  Khớp theo cặp `hang_loai` + `hang_id`, đúng khoá mà `board.py::_vat_tu_cap` dùng để gom.
 *
 *  Dòng số 0 KHÔNG tính, dù nó vẫn nằm trong lần đề nghị đó: bản đối chiếu của sản xuất giữ cả
 *  dòng xin 0 (tổ đã sửa món đó về 0), nhưng `_lines_kho` không đẻ dòng kho cho chúng nên chúng
 *  không đi qua bước làm tròn về `Numeric(14,2)` nào — đếm vào là nới dung sai thêm 0,005 cho một
 *  lần không đóng góp sai số nào, tức bịt bớt cờ lệch THẬT. Xét ở thang GỐC (`sl_yeu_cau_goc`),
 *  đúng thang mà `board.py` cộng dồn để ra `lech_thuc_te`. */
export function vtSoLanCoMon(
  cacDeNghi: { dongs: (VtKhoaVao & { sl_yeu_cau_goc: number })[] }[],
  d: VtKhoaVao,
): number {
  // Cùng khoá với hàng đối chiếu (`vtKhoa`): giấy khác dạng/khổ là món khác.
  const k = vtKhoa(d);
  return cacDeNghi.filter(
    (l) => l.dongs.some((x) => vtKhoa(x) === k && x.sl_yeu_cau_goc > 0),
  ).length;
}

/** Kho thực xuất có LỆCH so với số tổ đã xin không — so ở thang KHO (`VT_EPS_KHO`).
 *  Tách khỏi JSX để test được: đây là vị ngữ quyết định badge vàng của cả bảng đối chiếu.
 *
 *  `soLan` = số lần đề nghị có chứa món này. `VT_EPS_KHO` là dung sai của MỘT lần làm tròn, nhưng
 *  `board.py` CỘNG DỒN `sl_yeu_cau_goc` qua mọi lần đề nghị của cùng một món, nên sai khác do làm
 *  tròn cũng cộng dồn: ba lần bổ sung mỗi lần lệch 0,004 là tổng 0,012 > 0,005 và badge vàng giả
 *  quay lại y như trước bản vá. Nhân dung sai theo số lần cộng vào là đúng chiều tích lũy đó.
 *  Sàn 1: món chưa có lần đề nghị nào (dòng kế hoạch thuần) vẫn phải giữ dung sai một lần. */
export function vtCoLechThucTe(
  d: Pick<SxVatTuCapDoiChieu, "lech_thuc_te">,
  soLan = 1,
): boolean {
  return Math.abs(d.lech_thuc_te) > VT_EPS_KHO * Math.max(1, soLan);
}

// ============================ khối chính ====================================
export function ThsxExecPanels({ chiTiet, busy, hoTroUngVien, ungVienHomNay = null, onMoChonNguoi, exec, tenTo, phan }: Props) {
  // Nút ghi theo QUYỀN TRÊN CHÍNH công việc này (máy chủ tính theo dòng quyền của tổ): ghi mẻ là
  // Thực hiện lệnh; bàn giao và sửa số là Xác nhận sản lượng; vật tư là Kho.
  const quyen = chiTiet.quyen ?? {};
  const canThucHien = !!quyen.run_order;
  const canXacNhan = !!quyen.confirm_output;
  const canKho = !!quyen.warehouse;
  const sl = chiTiet.san_luong;
  const conLai = Math.max(0, sl.tong_tot - sl.da_giao);
  return (
    <>
      {(!phan || phan === "sl") && (
        <SanLuongSection chiTiet={chiTiet} canAssign={canThucHien} canSuaSo={canXacNhan} busy={busy} exec={exec}
          toKhac={{ ds: hoTroUngVien, homNay: ungVienHomNay, onMo: onMoChonNguoi }} />
      )}
      {(!phan || phan === "gn") && (
        <>
          {/* Đi đúng chiều hàng chạy: nhận vào trước, giao đi sau. Mỗi lần một dòng bảng (10/10/2026 —
              thẻ to mỗi lần một hộp hai ô, 10 lần là cuộn mỏi tay). */}
          <ThsxNhanVe chiTiet={chiTiet} busy={busy} exec={exec} />
          <GiaoDiSection chiTiet={chiTiet} canAssign={canXacNhan} busy={busy} conLai={conLai} exec={exec} />
        </>
      )}
      {(!phan || phan === "vt") && (
        <VatTuSection chiTiet={chiTiet} canAssign={canKho} busy={busy} exec={exec} tenTo={tenTo} />
      )}
    </>
  );
}

// ─────────────────────────── SẢN LƯỢNG (§10-11) ───────────────────────────
/** Trạng thái việc ghi sản lượng được — cùng `san_luong._TRANG_THAI_GHI_DUOC` ở máy chủ. */
const GHI_DUOC = new Set(["running", "paused", "completed"]);

function SanLuongSection({
  chiTiet, canAssign, canSuaSo, busy, exec, toKhac,
}: {
  /** `canAssign` = ghi mẻ + cập nhật ảnh chụp danh mục của mẻ (Thực hiện lệnh). `canSuaSo` = sửa số
   *  mẻ đã ghi (Xác nhận sản lượng, 10/10/2026). */
  chiTiet: SxWorkItemChiTiet; canAssign: boolean; canSuaSo: boolean; busy: boolean;
  exec: ThsxExec; toKhac?: NguoiToKhac;
}) {
  const sl = chiTiet.san_luong;
  const cv = chiTiet.cong_viec;
  const [formOpen, setFormOpen] = useState(false);
  const [ketQuaToa, setKetQuaToa] = useState<SxKetQuaNhanh[] | null>(null);
  const lan = lanTheoId(sl.batches);

  // Ngăn B (09/10/2026): số tốt / đã giao / chờ giao / lỗi / còn phải làm nằm ở khối Tiến độ của cột
  // phải — tab này chỉ liệt kê các mẻ, mỗi thông tin nói một lần. Máy chủ nhận mẻ khi việc đang
  // chạy / tạm dừng / đã xong (cả ghi bù); việc chưa bấm Bắt đầu thì khoá nút và nói lý do ngay, đừng
  // để tổ gõ xong mới bị trả về (10/10/2026).
  const chuaBatDau = !GHI_DUOC.has(chiTiet.trang_thai);
  return (
    <section className="thsx-b-sec">
      <div className="thsx-b-sec__dau">
        <h3 className="thsx-b-sec__h">Sản lượng đã ghi</h3>
        {sl.batches.length > 0 && <span className="thsx-b-mo3">{sl.batches.length} lần</span>}
        {canAssign && (
          <span className="thsx-b-sec__phai">
            <Button variant="accent" onClick={() => { toKhac?.onMo?.(); setFormOpen(true); }} disabled={busy || chuaBatDau}
              aria-haspopup="dialog" title={chuaBatDau ? "Bấm Bắt đầu trước rồi mới ghi sản lượng" : undefined}>
              <Icon name="plus" size={13} /> Ghi sản lượng
            </Button>
          </span>
        )}
      </div>
      {canAssign && chuaBatDau && (
        <p className="thsx-f__g">Việc chưa bắt đầu. Bấm Bắt đầu ở đầu ngăn rồi mới ghi sản lượng.</p>
      )}

      {cv.nguon_loai === "bai_ghep" && (
        <div className="thsx-bao thsx-bao--xanh thsx-b-bao">
          Việc này là bài ghép, mỗi lần ghi tự chia sang các lệnh trong bài theo số con trên tờ.
        </div>
      )}

      {ketQuaToa && ketQuaToa.length > 0 && (
        <div className="thsx-bao thsx-bao--xanh thsx-b-bao thsx-b-toa">
          <div className="thsx-b-toa__dau">
            <span>Đã tự toả sang các lệnh sản xuất</span>
            <button type="button" className="thsx-b-x" aria-label="Đóng" onClick={() => setKetQuaToa(null)}>
              <Icon name="x" size={12} />
            </button>
          </div>
          <ul>
            {ketQuaToa.map((k) => (
              <li key={k.lsx_id}>
                <span>LSX #{k.lsx_id}</span>
                <span className="thsx-num">{num(k.so_luong)} {nhanDonVi(k.don_vi)}</span>
                {k.ban_giao_id != null && <span>đã tự bàn giao</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {formOpen && (
        <BatchForm cv={cv} khoan={chiTiet.khoan ?? null} busy={busy} 
          tranGhi={chiTiet.tran_ghi ?? null} nguoiGhi={chiTiet.nguoi_ghi ?? []} toKhac={toKhac}
          onXong={(kq) => { setFormOpen(false); setKetQuaToa(kq.length ? kq : null); }}
          exec={exec} />
      )}

      {sl.batches.length === 0 ? (
        <p className="thsx-b-trong">Chưa ghi sản lượng lần nào.</p>
      ) : (
        <div className="thsx-b-me">
          <div className="thsx-b-me__cot" aria-hidden="true">
            <span>Lúc</span>
            <span className="thsx-b-me__nguoi">Người</span>
            <span className="thsx-b-me__may">Máy</span>
            <span className="thsx-b-me__tot">Tốt</span>
            <span className="thsx-b-me__hong">Hỏng</span>
            <span />
          </div>
          <ul>
            {sl.batches.map((b) => (
              <BatchRow key={b.id} b={b} lan={lan.get(b.id)} dvt={chiTiet.cong_viec.don_vi_tinh} canAssign={canAssign} canSuaSo={canSuaSo} busy={busy} exec={exec}
                tuyChon={chiTiet.khoan?.tuy_chon ?? []}
                tranGhi={chiTiet.tran_ghi ?? null} nguoiGhi={chiTiet.nguoi_ghi ?? []} toKhac={toKhac}
                banGiao={chiTiet.ban_giao_di.find((g) => g.batch_ids.includes(b.id)) ?? null} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Số "lần" của mỗi lần ghi sản lượng trong một công việc (10/10/2026, chủ xưởng: *"sản lượng lần 1,
 *  sản lượng lần 2"*): đếm theo giờ bắt đầu, cũ nhất là lần 1 — cùng cách màn KCS đánh số. */
export function lanTheoId(batches: Pick<SxBatch, "id" | "bat_dau">[]): Map<number, number> {
  const xep = [...batches].sort((a, b) => a.bat_dau.localeCompare(b.bat_dau) || a.id - b.id);
  return new Map(xep.map((b, i) => [b.id, i + 1]));
}

/** Giá khoán kèm ĐVT — chỉ để TỔ NHÌN (§7.1): bàn tổ không nhân gì ra tiền. Giá là giá CỦA TỔ
 *  (bảng giá theo tổ, 21/10/2026): có giá cố định thì nêu trước, tổ chưa có giá thì nói thẳng. */
function giaKhoan(v: {
  don_gia: number; don_vi: string; don_vi_ten: string | null; gia_co_dinh?: number; thieu_gia?: boolean;
}): string {
  if (v.thieu_gia) return "tổ chưa có giá";
  const dv = `${num(v.don_gia)} đ một ${v.don_vi_ten ?? nhanDonVi(v.don_vi)}`;
  return v.gia_co_dinh ? `${num(v.gia_co_dinh)} đ một lần ghi + ${dv}` : dv;
}

/** "lệnh 4 màu, 1 màu pha" — cùng chữ lương báo thiếu giá (`viec_khoan.mo_ta_mau`). */
export function moTaMau(soMau: number, pha: number): string {
  if (soMau <= 0) return "lệnh chưa có số màu in";
  return `lệnh ${num(soMau)} màu` + (pha > 0 ? `, ${num(pha)} màu pha` : "");
}

/** Công đoạn chia bậc (Bài in): bậc + giá ứng với tick đang chọn — đổi ngay khi thợ tick Mực UV.
 *  Không chia bậc ⇒ null. */
export function bacTheoTick(
  khoan: Pick<SxKhoanCongDoan, "bac_theo_chon" | "tuy_chon">, gt: Record<string, string>,
): SxBacTheoChon | null {
  const ds = khoan.bac_theo_chon ?? [];
  if (!ds.length) return null;
  const chon = tuyChonBody(khoan.tuy_chon ?? [], gt);
  return ds.find((x) => Object.entries(x.chon).every(([ma, v]) => (chon[ma] ? 1 : 0) === v)) ?? ds[0];
}

/** Thẻ tuỳ chọn khác 0 của lần ghi — cùng chữ ngăn soi lương (`khoan_ky._nhan_tuy_chon`):
 *  "trùng khuôn", "3 số lỗ đục". */
export function nhanTuyChon(ds: SxTuyChonLanGhi[] | null | undefined): string[] {
  return (ds ?? []).filter((t) => t.gia_tri !== 0).map((t) => {
    const ten = t.ten.toLowerCase();
    return t.kieu === "co_khong" ? ten : `${num(t.gia_tri)} ${ten}`;
  });
}

/** Giá trị đang chọn của từng tuỳ chọn → body `{ma: số}`. Có / không: "1" là tick. */
export function tuyChonBody(ds: SxTuyChonKhai[], gt: Record<string, string>): Record<string, number> {
  return Object.fromEntries(ds.map((t) => [t.ma, t.kieu === "co_khong" ? (gt[t.ma] ? 1 : 0) : toNum(gt[t.ma] ?? "")]));
}

/** Ảnh chụp của lần ghi → giá trị mở sẵn ở hộp Sửa số. */
function tuyChonTuAnh(anh: SxTuyChonLanGhi[] | null | undefined): Record<string, string> {
  return Object.fromEntries((anh ?? []).filter((t) => t.gia_tri !== 0)
    .map((t) => [t.ma, t.kieu === "co_khong" ? "1" : String(t.gia_tri)]));
}

/** Khối "Tuỳ chọn lần này" (Đợt 2) — đặt trên việc phát sinh, cùng khuôn hàng với việc phát sinh. */
function TuyChonGhi({ ds, gt, onDoi }: {
  ds: SxTuyChonKhai[]; gt: Record<string, string>; onDoi: (gt: Record<string, string>) => void;
}) {
  return (
    <div className="thsx-gm-ps">
      <div className="thsx-gm-mo">Tuỳ chọn lần này</div>
      <ul aria-label="Tuỳ chọn lần này">
        {ds.map((t) => (
          <li key={t.ma} className="thsx-gm-ps__dong">
            <div className="thsx-gm-ps__hang">
              {t.kieu === "co_khong" ? (
                <label className="thsx-gm-ps__chon">
                  <input type="checkbox" checked={!!gt[t.ma]}
                    onChange={(e) => onDoi({ ...gt, [t.ma]: e.target.checked ? "1" : "" })} />
                  <span>{t.ten}</span>
                </label>
              ) : (
                <>
                  <span className="thsx-gm-ps__chon">{t.ten}</span>
                  <label className="thsx-gm-ps__o">
                    <input type="number" min={0} step="any" inputMode="decimal" aria-label={t.ten}
                      placeholder={t.goi_y ?? ""} value={gt[t.ma] ?? ""}
                      onChange={(e) => onDoi({ ...gt, [t.ma]: e.target.value })} />
                  </label>
                </>
              )}
              {t.goi_y && t.kieu === "co_khong" && <span className="thsx-b-mo3">{t.goi_y}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "đã nhận từ In 1.000 × 2 = 2.000, đã ghi 300" — CHỈ SỐ, không đơn vị (19/09/2026: mẻ chỉ ghi
 *  nhận con số, xưởng không muốn thấy tờ/con/cái ở form này). */
// Cùng tổ + cùng lệnh thì không có bàn giao, `da_nhan` là SẢN LƯỢNG bước trước — viết "đã nhận"
// ở đó là nói sai việc, tổ sẽ đi tìm bàn giao không tồn tại. Cùng chữ với câu máy chủ chặn.
/** Câu dưới thanh trần: số nhận từ đâu, quy đổi, trừ lỗi KCS (10/10/2026) — "Đã nhận từ In 1.000 × 2
 *  = 2.000, trừ 200 KCS bắt lỗi còn 1.800" / "Kế hoạch nhận 175 × 2 = 350" (bước đầu chuỗi). */
function nguonTranGhi(t: SxTranGhi): string {
  const quyDoi = Math.abs(t.he_so - 1) > 1e-9 ? ` × ${num(t.he_so)} = ${num(t.toi_da_nhan)}` : "";
  const dau = t.dau_chuoi
    ? `Kế hoạch nhận ${num(t.da_nhan)}`
    : t.cung_to ? `${t.nguon_ten} làm ra ${num(t.da_nhan)}` : `Đã nhận từ ${t.nguon_ten} ${num(t.da_nhan)}`;
  const kcs = t.loi_kcs > 0 ? `, trừ ${num(t.loi_kcs)} KCS bắt lỗi còn ${num(t.toi_da)}` : "";
  return `${dau}${quyDoi}${kcs}`;
}

/** Hộp GHI MẺ theo CÔNG VIỆC KHOÁN (spec 2026-09-18 §7.1; khuôn hộp `#ghi-me` 09/10/2026): khoán là
 *  cấu hình cố định của công đoạn, tổ chỉ gõ số của mẻ rồi tick một hoặc nhiều VIỆC PHÁT SINH kèm số
 *  lượng. Việc phát sinh KHÔNG cộng vào sản lượng; không có thành tiền ở đâu cả.
 *
 *  Không có ô giờ (10/10/2026, chủ xưởng: *"thời gian sẽ theo cái nút ghi sản lượng"*): hộp không gửi
 *  giờ, máy chủ lấy lúc bấm làm kết thúc, bắt đầu nối lần ghi trước (`san_luong._khoang_luc_bam`).
 *
 *  Số của mẻ là MỘT ô "Số lượng làm được" (18/09/2026): tổ không tự chia tổng/tốt/hỏng — hàng lỗi do
 *  KCS phát hiện và ghi. Máy chủ vẫn giữ luật `tong = tot + hong` nên gửi tong = tot = số đó, hong = 0. */
export function BatchForm({
  cv, khoan, busy, tranGhi, nguoiGhi = [], toKhac, onXong, exec,
}: {
  cv: SxWorkItemChiTiet["cong_viec"]; busy: boolean;
  khoan: SxKhoanCongDoan | null;
  /** Trần theo routing (`dau_vao.tran_ghi`) — null = không trần (bước đầu, hệ số gõ tay…). */
  tranGhi: SxTranGhi | null;
  /** Người tổ mình đang được giao (`chiTiet.nguoi_ghi`). */
  nguoiGhi?: SxNguoiGhi[];
  /** Thợ tổ khác thêm được vào lần ghi; không truyền = không có ô thêm. */
  toKhac?: NguoiToKhac;
  onXong: (ketQua: SxKetQuaNhanh[]) => void; exec: ThsxExec;
}) {
  // Người tổ mình được tick — sẵn mọi người đi làm hôm đó.
  const [chonNguoi, setChonNguoi] = useState<Set<number>>(
    () => new Set(nguoiGhi.filter((n) => n.tick_san).map((n) => n.employee_id)));
  // Người tổ khác tổ vừa thêm vào lần này (10/10/2026: thêm thẳng, không chờ ai duyệt).
  const [themNguoi, setThemNguoi] = useState<NguoiLam[]>([]);
  const dsNguoi = [...nguoiLamGhi(nguoiGhi), ...themNguoi];
  const soNguoi = demNguoiLam(dsNguoi, chonNguoi);
  const [soLuong, setSoLuong] = useState("");
  const [ghiChu, setGhiChu] = useState("");
  // Việc phát sinh đã tick → số đang gõ. Có khoá = đã tick.
  const [psSl, setPsSl] = useState<Record<number, string>>({});
  // Tuỳ chọn khi ghi của công đoạn (Đợt 2) → giá trị đang chọn.
  const tuyChon = khoan?.tuy_chon ?? [];
  const [tcGt, setTcGt] = useState<Record<string, string>>({});
  const bac = khoan ? bacTheoTick(khoan, tcGt) : null;
  const nSoLuong = toNum(soLuong);
  // Mẻ 0 hợp lệ — ca chỉ làm việc phát sinh (thay kẽm, lên khuôn) vẫn cần mẻ để ghi nhận; nhưng ô
  // phải được GÕ (kể cả số 0), để trống thì chưa cho lưu.
  const soLuongDaGo = soLuong.trim() !== "" && Number.isFinite(Number(soLuong.replace(/,/g, "")));
  const donVi = cv.don_vi_ra ?? cv.don_vi_vao ?? null;
  // Tên CHẶNG ("tờ in", chặng thành phẩm = ĐVT lệnh "cuốn") — cùng chữ với đầu ngăn, KCS và kho.
  const donViHienThi = donVi ? nhanChangLenh(donVi, cv.don_vi_tinh) : "SP";

  function tickPs(p: SxViecPhatSinhChon) {
    setPsSl((cu) => {
      const moi = { ...cu };
      if (p.id in moi) delete moi[p.id];
      else moi[p.id] = "";
      return moi;
    });
  }
  const psTick = Object.entries(psSl);
  const psHopLe = psTick.every(([, s]) => toNum(s) > 0);

  // Máy chủ cũng chặn (`dau_vao.kiem_tran_ghi`); hộp báo trước để tổ khỏi gõ rồi mới bị trả về.
  const vuotTran = tranGhi != null && nSoLuong > tranGhi.con_ghi_duoc + 0.0005;
  const conSo = tranGhi != null && tranGhi.con_ghi_duoc > 0.0005;
  const hopLe = soLuongDaGo && nSoLuong >= 0 && !vuotTran && psHopLe && soNguoi > 0;

  async function luu() {
    if (!hopLe || busy) return;
    const body: SxBatchIn = {
      tong: nSoLuong, tot: nSoLuong, hong: 0,
      don_vi: donVi,
      mo_ta_loi: null,
      ghi_chu: ghiChu.trim() || null,
      phat_sinh: psTick.map(([id, s]) => ({ phat_sinh_id: Number(id), so_luong: toNum(s) })),
      nguoi_ids: dsNguoi.filter((n) => !n.mo && chonNguoi.has(n.id)).map((n) => n.id),
      ...(tuyChon.length ? { tuy_chon: tuyChonBody(tuyChon, tcGt) } : {}),
    };
    const ketQua = await exec.taoBatch(body);
    if (ketQua) onXong(ketQua);
  }

  // Phần trăm trên thanh tiến độ — theo tổng tối đa của trần.
  const phan = (v: number) => (tranGhi && tranGhi.toi_da > 0 ? Math.min(100, Math.max(0, (v / tranGhi.toi_da) * 100)) : 0);

  // Cộng nhanh không vượt trần — chạm trần thì dừng ở số còn ghi được.
  function congNhanh(val: number) {
    setSoLuong((prev) => {
      const next = Math.max(0, toNum(prev) + val);
      if (tranGhi && next > tranGhi.con_ghi_duoc) return String(tranGhi.con_ghi_duoc);
      return String(next);
    });
  }

  return (
    <ThsxHop tieuDe="Ghi sản lượng" phuDe={cv.nguon_ma ? `${cv.ten_cong_doan} của ${cv.nguon_ma}` : cv.ten_cong_doan}
      dienThoai="toan" phimTat="Ctrl + Enter để ghi" onPhimTat={luu}
      nutChinh="Ghi sản lượng" nutChinhKhoa={!hopLe} dangGui={busy}
      onDong={() => onXong([])} onChinh={luu}>
      {/* Số lượng là việc chính của hộp (10/10/2026, chủ xưởng chê khối cũ "chán"): ô số to, trần
          nằm ngay cạnh nhãn, thanh hai nấc cho thấy lần này đẩy tiến độ tới đâu. Khối "Lần này ghi
          tối đa" tách riêng trước đây gộp vào đây — mỗi con số nói một lần. */}
      <div className={`thsx-gso${vuotTran ? " is-loi" : ""}`}>
        <div className="thsx-gso__dau">
          <label className="thsx-f__n" htmlFor={`gm-so-${cv.id}`}>Số lượng làm được</label>
          {tranGhi && (
            <span className="thsx-gso__tran thsx-num">
              {conSo ? <>còn ghi được <b>{num(tranGhi.con_ghi_duoc)}</b> {donViHienThi}</> : "đã ghi đủ"}
            </span>
          )}
        </div>
        <div className="thsx-gso__o">
          <input id={`gm-so-${cv.id}`} type="number" min={0} inputMode="numeric" placeholder="0" autoFocus
            className="thsx-gso__in" value={soLuong} onChange={(e) => setSoLuong(e.target.value)} />
          <span className="thsx-gso__dv">{donViHienThi}</span>
          {tranGhi && conSo && (
            <button type="button" className="thsx-gso__max" onClick={() => setSoLuong(String(tranGhi.con_ghi_duoc))}>
              Tối đa {num(tranGhi.con_ghi_duoc)}
            </button>
          )}
        </div>
        <div className="thsx-gso__nhanh">
          <div className="thsx-gso__cong" role="group" aria-label="Cộng nhanh">
            {[10, 50, 100, 1000].map((v) => (
              <button key={v} type="button" onClick={() => congNhanh(v)}>+{num(v)}</button>
            ))}
          </div>
          <button type="button" className="thsx-b-lk thsx-gso__ve0" onClick={() => setSoLuong("0")}>Về 0</button>
        </div>
        {tranGhi && (
          <div className="thsx-gso__tien">
            <div className="thsx-gso__thanh" aria-hidden="true">
              <i className="thsx-gso__da" style={{ width: `${phan(tranGhi.da_ghi)}%` }} />
              <i className={`thsx-gso__nay${vuotTran ? " is-loi" : ""}`}
                style={{ width: `${Math.max(0, Math.min(100 - phan(tranGhi.da_ghi), phan(nSoLuong)))}%` }} />
            </div>
            <div className="thsx-gso__chu thsx-num">
              <span>
                {soLuongDaGo && nSoLuong > 0
                  ? <>Sau lần này {num(tranGhi.da_ghi + nSoLuong)} trên {num(tranGhi.toi_da)} {donViHienThi}</>
                  : <>Đã ghi {num(tranGhi.da_ghi)} trên {num(tranGhi.toi_da)} {donViHienThi}</>}
              </span>
              <span className="thsx-gso__nguon">{nguonTranGhi(tranGhi)} {donViHienThi}.</span>
            </div>
          </div>
        )}
        {vuotTran && tranGhi && (
          <span className="thsx-f__g thsx-f__g--loi">
            {conSo
              ? `Vượt số còn ghi được, lần này ghi tối đa ${num(tranGhi.con_ghi_duoc)} ${donViHienThi}.`
              : tranGhi.dau_chuoi
                ? "Đã ghi đủ, chỉ ghi được số 0."
                : `Chỉ ghi được số 0 cho tới khi công đoạn trước ${tranGhi.cung_to ? "làm" : "giao"} thêm.`}
          </span>
        )}
      </div>

      <NguoiLamChon ds={dsNguoi} chon={chonNguoi} onDoi={setChonNguoi} toKhac={toKhac}
        ngay={toKhac?.homNay ?? nowDtLocal().slice(0, 10)}
        onThem={(n) => { setThemNguoi((cu) => [...cu, n]); setChonNguoi((cu) => new Set(cu).add(n.id)); }} />


      {khoan && (
        <div className="thsx-gm-khoan">
          <div className="thsx-gm-khoan__dau">
            <span className="thsx-gm-mo">Khoán</span>
            <span>{khoan.ten}</span>
            <span className="thsx-gm-gia thsx-num">{giaKhoan(bac ? { ...khoan, ...bac } : khoan)}</span>
          </div>
          {bac && (
            <div className="thsx-gm-bac">
              <span className="thsx-gm-mo">Bậc giá</span>
              <span>{bac.bac_ten ?? "chưa khớp bậc nào"}</span>
              <span className="thsx-gm-mo">{moTaMau(bac.so_mau, bac.so_mau_pha)}</span>
            </div>
          )}
          {tuyChon.length > 0 && <TuyChonGhi ds={tuyChon} gt={tcGt} onDoi={setTcGt} />}
          {khoan.phat_sinh.length > 0 && (
            <div className="thsx-gm-ps">
              <div className="thsx-gm-mo">Việc phát sinh, không cộng vào sản lượng</div>
              <ul aria-label={`Việc phát sinh của ${khoan.ten}`}>
                {khoan.phat_sinh.map((p) => {
                  const tick = p.id in psSl;
                  const sai = tick && psSl[p.id] !== "" && toNum(psSl[p.id]) <= 0;
                  return (
                    // Một hàng: tick + tên | ô số lượng có đơn vị nằm TRONG ô (chỉ khi đã tick) | đơn giá.
                    <li key={p.id} className="thsx-gm-ps__dong">
                      <div className="thsx-gm-ps__hang">
                        <label className="thsx-gm-ps__chon">
                          <input type="checkbox" checked={tick} onChange={() => tickPs(p)} />
                          <span>{p.ten}</span>
                        </label>
                        {tick && (
                          <label className={`thsx-gm-ps__o${sai ? " is-loi" : ""}`}>
                            <input type="number" min={0} step="any" inputMode="decimal" autoFocus
                              placeholder="Số lượng" aria-label={`Số lượng ${p.ten}`} value={psSl[p.id]}
                              onChange={(e) => setPsSl((cu) => ({ ...cu, [p.id]: e.target.value }))} />
                            <span>{p.don_vi_ten ?? nhanDonVi(p.don_vi)}</span>
                          </label>
                        )}
                        <span className="thsx-gm-gia thsx-num">{giaKhoan(p)}</span>
                      </div>
                      {sai && <span className="thsx-f__g thsx-f__g--loi thsx-gm-ps__loi">Phải lớn hơn 0</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      <label className="thsx-f">
        <span className="thsx-f__n">Ghi chú</span>
        <input type="text" className="thsx-x-in" value={ghiChu} onChange={(e) => setGhiChu(e.target.value)}
          placeholder="Không bắt buộc" />
      </label>
    </ThsxHop>
  );
}

/** Một dòng trong danh sách Người làm: `mo` = nghỉ hôm đó (mờ, không tick được), `the` = các thẻ ghi
 *  chú cạnh tên (tổ gốc của người tổ khác, việc đang ở). */
export type NguoiLam = { id: number; ten: string; the: string[]; mo: boolean };

/** Thợ tổ SX khác (`/teams/{id}/ho-tro-ung-vien`) — nguồn của ô "Thêm người tổ khác". `onMo` = nạp lại
 *  tình trạng cho tươi lúc mở hộp. */
export type NguoiToKhac = { ds: SxHoTroUngVien[]; homNay?: string | null; onMo?: () => void };

function tenViec(v: SxViecNgan): string {
  return [v.ma, v.ten_cong_doan].filter(Boolean).join(" ");
}

/** Người tổ mình đang được giao, bày trong danh sách Người làm của hộp Ghi sản lượng. Người tổ khác
 *  tổ thêm thẳng ở ô "Thêm người tổ khác" (10/10/2026, không còn thỏa thuận hỗ trợ chờ hai tổ). */
export function nguoiLamGhi(nguoiGhi: SxNguoiGhi[]): NguoiLam[] {
  return nguoiGhi.map((n) => ({
    id: n.employee_id, ten: n.ho_ten, mo: n.nghi != null,
    the: [...(n.nghi ? [n.nghi] : []), ...n.dang_o.map((v) => `đang ở ${tenViec(v)}`)],
  }));
}

/** Một thợ tổ khác thành dòng Người làm — thẻ là tên tổ gốc. */
export function nguoiTuToKhac(h: SxHoTroUngVien): NguoiLam {
  return { id: h.id, ten: h.full_name, mo: false, the: [h.to_ten ?? "tổ khác"] };
}

export function demNguoiLam(ds: NguoiLam[], chon: Set<number>): number {
  return ds.filter((n) => !n.mo && chon.has(n.id)).length;
}

/** Khối tick "Người làm lần này" — dùng chung hộp Ghi sản lượng và Sửa số sản lượng. Có `toKhac` thì
 *  kèm nút "Thêm người tổ khác" mở popup chọn tổ rồi chọn người (10/10/2026): người được chọn vào
 *  danh sách, tick sẵn; người nghỉ đúng `ngay` hoặc đã nghỉ việc thì mờ, không chọn được. */
export function NguoiLamChon({
  ds, chon, onDoi, baoThieu = true, toKhac, ngay, onThem, tieuDe = "Người làm lần này",
  cauThieu = "Chọn ít nhất một người làm lần này.",
}: {
  ds: NguoiLam[]; chon: Set<number>; onDoi: (moi: Set<number>) => void;
  /** Hộp Báo dừng máy dùng lại khối này với chữ "Người hưởng". */
  tieuDe?: string;
  cauThieu?: string;
  /** Báo "chọn ít nhất một người" khi không ai được tick. */
  baoThieu?: boolean;
  toKhac?: NguoiToKhac;
  /** Ngày của lần ghi (YYYY-MM-DD) — xét người tổ khác nghỉ hôm đó. */
  ngay?: string;
  onThem?: (n: NguoiLam) => void;
}) {
  const so = demNguoiLam(ds, chon);
  function doi(id: number) {
    const moi = new Set(chon);
    if (moi.has(id)) moi.delete(id); else moi.add(id);
    onDoi(moi);
  }
  const [moChon, setMoChon] = useState(false);
  return (
    <div className="thsx-f">
      <div className="thsx-ng__dau">
        <span className="thsx-f__n">{tieuDe}</span>
        <span className="thsx-gm-mo thsx-num">{so} người</span>
      </div>
      {ds.length === 0 ? (
        <span className="thsx-f__g">Chưa giao ai vào việc này.</span>
      ) : (
        <ul className="thsx-ng" aria-label={tieuDe}>
          {ds.map((n) => (
            <li key={n.id}>
              <label className={`thsx-ng__o${n.mo ? " is-mo" : ""}`}>
                <input type="checkbox" checked={!n.mo && chon.has(n.id)} disabled={n.mo}
                  onChange={() => doi(n.id)} />
                <span className="thsx-ng__ten">{n.ten}</span>
                {n.the.map((t) => <span key={t} className="thsx-ng__the">{t}</span>)}
              </label>
            </li>
          ))}
        </ul>
      )}
      {toKhac && onThem && toKhac.ds.length > 0 && (
        <button type="button" className="thsx-b-lk thsx-ng__them" onClick={() => setMoChon(true)}>
          <Icon name="plus" size={13} /> Thêm người tổ khác
        </button>
      )}
      {moChon && toKhac && onThem && (
        <ChonNguoiToKhac ds={toKhac.ds} daCo={new Set(ds.map((n) => n.id))} ngay={ngay ?? ""}
          homNay={toKhac.homNay ?? null} onDong={() => setMoChon(false)}
          onChon={(hs) => { hs.forEach((h) => onThem(nguoiTuToKhac(h))); setMoChon(false); }} />
      )}
      {baoThieu && so === 0 && ds.length > 0 && (
        <span className="thsx-f__g thsx-f__g--loi">{cauThieu}</span>
      )}
    </div>
  );
}

/** Chuỗi so khớp ô tìm: chữ thường, bỏ dấu (gõ "can mang" vẫn ra "Cán màng"). */
function boDauTim(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
}

/** Popup "Thêm người tổ khác" (10/10/2026, chủ xưởng: *"popup chọn tổ, xong chọn nhân viên"*): bước 1
 *  chọn tổ, bước 2 tick người của tổ đó rồi bấm Thêm. Người đã có trong lần ghi không hiện lại. */
function ChonNguoiToKhac({ ds, daCo, ngay, homNay, onDong, onChon }: {
  ds: SxHoTroUngVien[]; daCo: Set<number>;
  /** Ngày của lần ghi (YYYY-MM-DD) — xét nghỉ phép. */
  ngay: string; homNay: string | null;
  onDong: () => void; onChon: (hs: SxHoTroUngVien[]) => void;
}) {
  const [toChon, setToChon] = useState<string | null>(null);
  const [tick, setTick] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const conLai = ds.filter((h) => !daCo.has(h.id));
  const khoaTo = (h: SxHoTroUngVien) => (h.to_id != null ? String(h.to_id) : `ten:${h.to_ten ?? ""}`);
  // Ô tìm khớp tên tổ, hoặc tên / mã một người trong tổ — gõ tên người là ra ngay tổ của họ.
  const tim = boDauTim(q);
  const khop = (h: SxHoTroUngVien) => !tim
    || [h.to_ten, h.full_name, h.code].some((x) => x && boDauTim(x).includes(tim));
  const cacTo = [...new Map(conLai.filter(khop).map((h) => [khoaTo(h), h.to_ten ?? "Chưa có tổ"])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "vi"));
  const nguoiTo = conLai.filter((h) => khoaTo(h) === toChon)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "vi"));
  const tenTo = cacTo.find(([k]) => k === toChon)?.[1];
  const chon = conLai.filter((h) => tick.has(h.id));

  function doi(id: number) {
    setTick((cu) => {
      const moi = new Set(cu);
      if (moi.has(id)) moi.delete(id); else moi.add(id);
      return moi;
    });
  }

  return (
    <ThsxHop tieuDe="Thêm người tổ khác" co="hep" dienThoai="day"
      phuDe={toChon == null ? "Chọn tổ của người sang giúp" : tenTo}
      nutChinh={chon.length ? `Thêm ${chon.length} người` : "Thêm"} nutChinhKhoa={chon.length === 0}
      onPhimTat={() => onChon(chon)} onDong={onDong} onChinh={() => onChon(chon)}>
      {toChon == null ? (<>
        <div className="thsx-ctk__tim">
          <OTim value={q} onChange={setQ} placeholder="Tìm tổ hoặc tên người" ariaLabel="Tìm tổ hoặc tên người" />
        </div>
        {cacTo.length === 0 ? (
          <p className="thsx-f__g">{q ? "Không có tổ hay người nào khớp." : "Người tổ khác đều đã có trong lần ghi này."}</p>
        ) : (
          <ul className="thsx-ctk" aria-label="Chọn tổ">
            {cacTo.map(([k, ten]) => (
              <li key={k}>
                <button type="button" className="thsx-ctk__to" onClick={() => setToChon(k)}>
                  <span className="thsx-ctk__ten">{ten}</span>
                  <span className="thsx-ctk__so thsx-num">{conLai.filter((h) => khoaTo(h) === k).length} người</span>
                  <Icon name="chevron" size={14} style={{ transform: "rotate(-90deg)" }} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </>) : (
        <>
          <button type="button" className="thsx-b-lk thsx-ctk__lui" onClick={() => setToChon(null)}>
            <Icon name="chevron" size={13} style={{ transform: "rotate(90deg)" }} /> Chọn tổ khác
          </button>
          <ul className="thsx-ng" aria-label={`Người của ${tenTo ?? "tổ"}`}>
            {nguoiTo.map((h) => {
              const chan = tinhTrangChon(h, { ngay, homNay }).chan;
              return (
                <li key={h.id}>
                  <label className={`thsx-ng__o${chan ? " is-mo" : ""}`}>
                    <input type="checkbox" checked={!chan && tick.has(h.id)} disabled={!!chan}
                      onChange={() => doi(h.id)} />
                    <span className="thsx-ng__ten">{h.full_name}</span>
                    {h.code && <span className="thsx-ng__the">{h.code}</span>}
                    {chan && <span className="thsx-ng__the">{chan}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </ThsxHop>
  );
}

function formatBatchTime(batDau: string | null | undefined, ketThuc: string | null | undefined): string {
  if (!batDau) return "—";
  const d1 = new Date(batDau);
  if (Number.isNaN(d1.getTime())) return "—";
  const m1 = String(d1.getMonth() + 1).padStart(2, "0");
  const dt1 = String(d1.getDate()).padStart(2, "0");
  const hh1 = String(d1.getHours()).padStart(2, "0");
  const mm1 = String(d1.getMinutes()).padStart(2, "0");
  const str1 = `${dt1}/${m1} ${hh1}:${mm1}`;

  if (!ketThuc) return `${str1} → Đang chạy`;
  const d2 = new Date(ketThuc);
  if (Number.isNaN(d2.getTime())) return `${str1} → —`;

  const hh2 = String(d2.getHours()).padStart(2, "0");
  const mm2 = String(d2.getMinutes()).padStart(2, "0");

  if (d1.toDateString() === d2.toDateString()) {
    return `${str1} → ${hh2}:${mm2}`;
  }

  const m2 = String(d2.getMonth() + 1).padStart(2, "0");
  const dt2 = String(d2.getDate()).padStart(2, "0");
  return `${str1} → ${dt2}/${m2} ${hh2}:${mm2}`;
}

/** Giờ MỘT lần dừng máy của mẻ. Mốc khác ngày với mẻ (dừng qua nửa đêm) thì kèm ngày — chỉ ghi
 *  "00:21" là người đọc hiểu thành cùng ngày với mẻ. Chưa chạy lại (`ket_thuc` trống) thì nói thẳng. */
function khungDungMay(s: SxBatch["su_co"][number], meBatDau: string): string {
  if (!s.bat_dau) return "—";
  const ngayMe = new Date(meBatDau).toDateString();
  const moc = (v: string) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime()) || d.toDateString() === ngayMe) return gioNgan(v);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${gioNgan(v)}`;
  };
  return s.ket_thuc ? `${moc(s.bat_dau)}–${moc(s.ket_thuc)}` : `từ ${moc(s.bat_dau)}, chưa chạy lại`;
}

/** MỘT MẺ trong danh sách sản lượng. Dòng gấp: giờ, người, máy, tốt, hỏng; mở ra đọc phần còn lại:
 *  đơn giá khoán (ảnh chụp cấu hình Khoán của công đoạn), việc phát sinh, ca, lỗi hỏng, các lần dừng máy.
 *  Không còn cột "việc khoán" (10/10/2026): từ 21/09 khoán là cấu hình của công đoạn, thợ không chọn
 *  việc khi ghi mẻ — tên chụp vào mẻ chỉ là tên công đoạn, trống khi công đoạn chưa cấu hình Khoán. KHÔNG chia sản lượng cho ai (gỡ 18/09/2026). Danh mục đổi sau lúc ghi ⇒ băng so sánh
 *  cũ → mới + nút lấy số mới; không bấm = giữ số cũ. */
/** Dòng gấp chỉ bày chừng này tên, còn lại "+N người"; mở dòng mới hiện đủ — tổ Thành phẩm 24 thợ
 *  một lần ghi kéo dòng cao cả màn, che mất các lần ghi khác (19/10/2026). */
const NGUOI_GON = 3;

export function BatchRow({
  b, lan, canAssign, canSuaSo = false, busy, exec, tranGhi = null, banGiao = null, nguoiGhi = [], toKhac, dvt = null,
  tuyChon = [],
}: {
  b: SxBatch; canAssign: boolean; busy: boolean; exec: ThsxExec;
  /** Tuỳ chọn khi ghi công đoạn đang khai — hộp Sửa số bày để sửa khi thợ tick nhầm. */
  tuyChon?: SxTuyChonKhai[];
  /** ĐVT thành phẩm của lệnh — tên chặng "cai". */
  dvt?: string | null;
  /** Người tổ mình đang được giao — hộp Sửa số cho thêm họ vào lần ghi. */
  nguoiGhi?: SxNguoiGhi[];
  /** Thợ tổ khác — hộp Sửa số thêm được họ vào lần ghi. */
  toKhac?: NguoiToKhac;
  /** Số thứ tự "Lần N" (`lanTheoId`). */
  lan?: number;
  /** Xác nhận sản lượng ⇒ nút Sửa số (10/10/2026). */
  canSuaSo?: boolean;
  tranGhi?: SxTranGhi | null;
  /** Lần giao mẻ này đã đi theo — null là mẻ chưa giao. */
  banGiao?: SxBanGiao | null;
}) {
  const [mo, setMo] = useState(false);
  const [suaOpen, setSuaOpen] = useState(false);
  // "Giữ số cũ" (§7.2b) KHÔNG gọi server — mẻ vốn giữ số lúc ghi cho tới khi có người bấm Cập nhật.
  // Nút chỉ gấp băng lại cho gọn trong lượt xem này; pill "danh mục đổi" ở đầu dòng vẫn treo, mở lại
  // màn thì băng hiện lại — hệ không bao giờ tự quên là số đang cũ.
  const [giuCu, setGiuCu] = useState(false);
  const the = nhanTuyChon(b.tuy_chon_khoan);
  const coChiTiet = (b.viec_khoan_don_gia != null && !!b.viec_khoan_don_vi) || b.phat_sinh.length > 0 || !!b.ca_ten
    || the.length > 0 || !!b.bac_khoan_ten
    || (b.hong > 0 && !!b.mo_ta_loi) || b.su_co.length > 0 || b.lot_vao.length > 0 || !!b.ghi_chu;
  return (
    <li className={`thsx-b-me__dong${mo ? " is-mo" : ""}`}>
      {/* Cột: Lúc | Người | Máy | Tốt | Hỏng | ▸. Người / máy / số đã nằm trên dòng thì phần mở ra
          không nhắc lại. */}
      <button type="button" className="thsx-b-me__h" onClick={() => setMo((o) => !o)} aria-expanded={mo}>
        <span className="thsx-b-me__luc">
          {/* Đang ở tab Sản lượng — "Lần N" là đủ, chữ dài đẩy giờ xuống dòng hai. */}
          {lan != null && <span className="thsx-b-me__lan">Lần {lan}</span>}
          <span className="thsx-num">{formatBatchTime(b.bat_dau, b.ket_thuc)}</span>
          {b.danh_muc_doi.length > 0 && (
            <ChipTT mau="vang" vuong title="Danh mục đã đổi so với lúc ghi sản lượng">danh mục đổi</ChipTT>
          )}
        </span>
        <span className="thsx-b-me__nguoi">
          {b.nguoi_tham_gia.length > 0
            ? <>
              {(mo || b.nguoi_tham_gia.length <= NGUOI_GON + 1 ? b.nguoi_tham_gia : b.nguoi_tham_gia.slice(0, NGUOI_GON))
                .map((x) => (
                  <span key={x.employee_id}>{x.ho_ten}{x.to_ten && <small className="thsx-b-mo3"> ({x.to_ten})</small>}</span>
                ))}
              {!mo && b.nguoi_tham_gia.length > NGUOI_GON + 1 && (
                <span className="thsx-b-mo3">+{b.nguoi_tham_gia.length - NGUOI_GON} người</span>
              )}
            </>
            : b.so_nguoi > 0 ? `${b.so_nguoi} người` : <span className="thsx-b-mo3">—</span>}
        </span>
        <span className="thsx-b-me__may">{b.may_ten ?? <span className="thsx-b-mo3">—</span>}</span>
        <span className="thsx-b-me__tot thsx-num" data-nhan="Tốt">
          {num(b.tot)}{b.don_vi && <small> {nhanChangLenh(b.don_vi, dvt)}</small>}
        </span>
        <span className="thsx-b-me__hong thsx-num" data-nhan="Hỏng">{num(b.hong)}</span>
        <Icon name="chevron" size={12} className={`thsx-b-me__mui${mo ? "" : " thsx-rot-90"}`} />
      </button>
      {mo && (
        <div className="thsx-b-me__ct">
          {b.danh_muc_doi.length > 0 && giuCu && (
            <p className="thsx-bao thsx-bao--vang thsx-b-bao" role="status">
              Lần này đang giữ số lúc ghi — danh mục đã đổi.{" "}
              <button type="button" className="thsx-b-lk" onClick={() => setGiuCu(false)}>Xem thay đổi</button>
            </p>
          )}
          {b.danh_muc_doi.length > 0 && !giuCu && (
            <div className="thsx-bao thsx-bao--vang thsx-b-bao" role="status">
              <div>Danh mục đã đổi so với lúc ghi sản lượng</div>
              <table className="thsx-vk-doi__tbl">
                <thead><tr><th>Mục</th><th>Lúc ghi</th><th>Danh mục nay</th></tr></thead>
                <tbody>
                  {/* `truong` KHÔNG duy nhất: việc khoán và từng việc phát sinh cùng có "don_gia". */}
                  {b.danh_muc_doi.map((d, i) => (
                    <tr key={`${i}:${d.nhan}`}>
                      <td>{d.nhan}</td>
                      <td className="thsx-vk-doi__cu">{d.cu ?? "—"}</td>
                      <td className="thsx-vk-doi__moi">{d.mat ? "đã gỡ khỏi danh mục" : (d.moi ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div>Không bấm Cập nhật thì lần này giữ nguyên số lúc ghi.</div>
              <div className="thsx-b-hang-nut">
                {canAssign && (
                  <button type="button" className="thsx-b-lk" disabled={busy || b.danh_muc_doi.every((d) => d.mat)}
                    title={b.danh_muc_doi.every((d) => d.mat) ? "Việc đã gỡ khỏi danh mục — không có số mới để lấy" : undefined}
                    onClick={() => void exec.capNhatDanhMucMe(b.id)}>
                    Cập nhật theo danh mục
                  </button>
                )}
                <button type="button" className="thsx-b-lk" onClick={() => setGiuCu(true)}>Giữ số cũ</button>
              </div>
            </div>
          )}
          {/* Chi tiết bên trái, Sửa số ghim mép phải — mục nào trống thì không có dòng. */}
          <div className="thsx-b-me__than">
          {coChiTiet ? (
          <dl className="thsx-b-kv thsx-b-kv--rong">
            {b.viec_khoan_don_gia != null && b.viec_khoan_don_vi && (
              <>
                <dt>Đơn giá khoán</dt>
                <dd className="thsx-num">
                  {num(b.viec_khoan_don_gia)} đ / {b.viec_khoan_don_vi_ten ?? nhanDonVi(b.viec_khoan_don_vi)}
                </dd>
              </>
            )}
            {b.bac_khoan_ten && (
              <>
                <dt>Bậc giá</dt>
                <dd>{b.bac_khoan_ten}</dd>
              </>
            )}
            {the.length > 0 && (
              <>
                <dt>Tuỳ chọn</dt>
                <dd className="thsx-b-the">{the.map((t) => <ChipTT key={t} mau="cyan" vuong>{t}</ChipTT>)}</dd>
              </>
            )}
            {b.phat_sinh.length > 0 && (
              <>
                <dt>Việc phát sinh</dt>
                <dd>
                  {b.phat_sinh.map((ps) => (
                    <div key={ps.id} className="thsx-b-dong-ps">
                      <span>{ps.ten ?? "—"}</span>
                      <span className="thsx-num">{num(ps.so_luong)}{ps.don_vi ? ` ${ps.don_vi_ten ?? nhanDonVi(ps.don_vi)}` : ""}</span>
                      {ps.don_gia != null && ps.don_vi && (
                        <span className="thsx-b-mo3 thsx-num">{num(ps.don_gia)} đ / {ps.don_vi_ten ?? nhanDonVi(ps.don_vi)}</span>
                      )}
                    </div>
                  ))}
                  <small>không cộng sản lượng</small>
                </dd>
              </>
            )}
            {b.ca_ten && <><dt>Ca</dt><dd>{b.ca_ten}</dd></>}
            {b.hong > 0 && b.mo_ta_loi && <><dt>Lỗi hỏng</dt><dd>{b.mo_ta_loi}</dd></>}
            {b.su_co.length > 0 && (
              <>
                <dt>Dừng máy</dt>
                <dd>{b.su_co.map((sc, i) => <div key={i}>{`${khungDungMay(sc, b.bat_dau)}: ${sc.ly_do ?? ""}`}</div>)}</dd>
              </>
            )}
            {b.lot_vao.length > 0 && (
              <>
                <dt>Lô vào</dt>
                <dd>{b.lot_vao.map((l, i) => (
                  <div key={i} className="thsx-num">{num(l.so_luong)}{l.don_vi ? ` ${nhanDonVi(l.don_vi)}` : ""}</div>
                ))}</dd>
              </>
            )}
            {b.ghi_chu && <><dt>Ghi chú</dt><dd>{b.ghi_chu}</dd></>}
          </dl>
          ) : <span className="thsx-b-mo3">Không có ghi chú thêm</span>}
          {canSuaSo && (
            <Button variant="secondary" onClick={() => { toKhac?.onMo?.(); setSuaOpen(true); }} disabled={busy}
              aria-haspopup="dialog">
              Sửa số
            </Button>
          )}
          </div>
        </div>
      )}
      {suaOpen && (
        <SuaSoMeForm b={b} lan={lan} dvt={dvt} tranGhi={tranGhi} banGiao={banGiao} busy={busy} nguoiGhi={nguoiGhi}
          toKhac={toKhac} tuyChon={tuyChon} onXong={() => setSuaOpen(false)} exec={exec} />
      )}
    </li>
  );
}

// ─────────────────────────── BÀN GIAO (§11.2) ─────────────────────────────
/** Khối "Giao đi" của tab Giao và nhận: còn bao nhiêu tốt chưa giao + nút Đề xuất giao + bảng các lần
 *  giao đi. Bước cuối lệnh không có chặng sau ⇒ không bàn giao; thành phẩm vào kho qua KCS. */
function GiaoDiSection({
  chiTiet, canAssign, busy, conLai, exec,
}: {
  chiTiet: SxWorkItemChiTiet; canAssign: boolean; busy: boolean; conLai: number;
  exec: ThsxExec;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const chang = chiTiet.ban_giao_chang_sau;
  const di = chiTiet.ban_giao_di;
  const buocCuoi = chang.length === 0;
  const dv = chiTiet.san_luong.don_vi ? ` ${nhanChangLenh(chiTiet.san_luong.don_vi, chiTiet.cong_viec.don_vi_tinh)}` : "";

  return (
    <section className="thsx-b-sec">
      <div className="thsx-b-sec__dau">
        <h3 className="thsx-b-sec__h">Giao đi</h3>
        {!buocCuoi && (
          <span className="thsx-b-mo3">
            {chang.length === 1 ? `sang ${chang[0].ten_cong_doan}` : `sang ${chang.length} bước sau`}
          </span>
        )}
        {!buocCuoi && conLai > 0 && <span className="thsx-b-canh">còn {num(conLai)}{dv} tốt chưa giao</span>}
        {di.length > 0 && <span className="thsx-b-mo3">{di.length} lần</span>}
        {canAssign && !buocCuoi && (
          <span className="thsx-b-sec__phai">
            <Button variant="secondary" onClick={() => setFormOpen(true)} disabled={busy} aria-haspopup="dialog">
              Đề xuất giao
            </Button>
          </span>
        )}
      </div>
      {di.length > 0 ? (
        <BanGiaoBang phia="di">
          {di.map((g) => (
            <BanGiaoRow key={g.id} g={g} phia="di" dvt={chiTiet.cong_viec.don_vi_tinh} canAssign={canAssign} busy={busy} exec={exec}
              batches={chiTiet.san_luong.batches} conLai={conLai} />
          ))}
        </BanGiaoBang>
      ) : (
        <p className="thsx-b-trong">
          {buocCuoi ? "Bước cuối, hàng tốt đề nghị nhập kho ở tab KCS."
            : conLai > 0 ? "Chưa giao đi lần nào." : "Chưa có hàng tốt nào chờ giao."}
        </p>
      )}
      {formOpen && !buocCuoi && (
        <BanGiaoForm chiTiet={chiTiet} conLai={conLai}
          busy={busy} onXong={() => setFormOpen(false)} exec={exec} />
      )}
    </section>
  );
}

/** Bảng các lần giao/nhận — mỗi lần một dòng: bao nhiêu, công đoạn đầu kia, bên giao, bên nhận,
 *  trạng thái, nút. Dùng chung cho Nhận vào (`den`) và Giao đi (`di`). */
function BanGiaoBang({ phia, children }: { phia: "di" | "den"; children: ReactNode }) {
  return (
    <div className="thsx-b-tw">
      <table className="thsx-b-t thsx-b-bgt">
        <thead>
          <tr>
            <th className="r">Số lượng</th>
            <th>{phia === "di" ? "Sang" : "Từ"}</th>
            <th>Bên giao</th>
            <th>Bên nhận</th>
            <th>Trạng thái</th>
            <th aria-label="Thao tác" />
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Tab "Nhận" của ngăn chi tiết (§11.5): bàn giao ĐẾN công đoạn này. Bên nhận Xác nhận / Điều chỉnh
 *  ngay tại đây — trước kia khối "Nhận về" nằm dưới Sản lượng và Giao đi của tab Bàn giao & Vật tư,
 *  phải cuộn mới thấy nút. Lần chờ nhận đứng đầu danh sách. */
export function ThsxNhanVe({
  chiTiet, busy, exec,
}: {
  chiTiet: SxWorkItemChiTiet; busy: boolean; exec: ThsxExec;
}) {
  const canXacNhan = !!chiTiet.quyen?.confirm_output;
  const den = chiTiet.ban_giao_den ?? [];
  const cho = den.filter(choBenNhan);
  const xong = den.filter((g) => !choBenNhan(g));
  // Bước trước cùng tổ + cùng lệnh thì hàng không qua bàn giao — danh sách trống là ĐÚNG, phải nói
  // ra, kẻo tổ đi tìm một lần giao không bao giờ có.
  const cungTo = (chiTiet.cong_doan_truoc ?? []).filter((c) => c.cung_to).map((c) => c.ten_cong_doan);

  // Bước đầu lệnh (không có công đoạn trước) nhận vật tư từ kho — phiếu xuất nằm ở tab Vật tư.
  const dauLenh = (chiTiet.cong_doan_truoc ?? []).length === 0;

  // CHỈ các lần nhận (27/09/2026): tổ cần biết nhận mấy lần, mỗi lần bao nhiêu, từ công đoạn nào.
  // Câu "chưa nhận hàng thì chưa bắt đầu được" nằm ở ô vướng của cột phải.
  return (
    <section className="thsx-b-sec">
      <div className="thsx-b-sec__dau">
        <h3 className="thsx-b-sec__h">Nhận vào</h3>
        <span className="thsx-b-mo3">{dauLenh ? "từ kho" : "từ bước trước"}</span>
        {den.length > 0 && <span className="thsx-b-mo3">{den.length} lần</span>}
      </div>
      {den.length === 0 ? (
        <p className="thsx-b-trong">
          {cungTo.length > 0
            ? `${cungTo.join(", ")} cùng tổ — hàng không qua bàn giao, bước đó làm ra bao nhiêu thì ghi sản lượng được bấy nhiêu.`
            : dauLenh
              ? "Bước đầu nhận vật tư từ kho theo phiếu xuất ở tab Vật tư."
              : "Chưa nhận lần nào từ công đoạn trước."}
        </p>
      ) : (
        <BanGiaoBang phia="den">
          {[...cho, ...xong].map((g) => (
            <BanGiaoRow key={g.id} g={g} phia="den" dvt={chiTiet.cong_viec.don_vi_tinh} canAssign={canXacNhan} busy={busy} exec={exec} />
          ))}
        </BanGiaoBang>
      )}
      {cho.length > 0 && !canXacNhan && (
        <p className="thsx-b-trong">Xác nhận nhận hàng cần quyền Xác nhận sản lượng của tổ.</p>
      )}
    </section>
  );
}

/** Nơi làm của một chặng sau. Bước thuê ngoài nói rõ nhà gia công — "giao ra ngoài" chung chung thì
 *  tổ không biết hàng đi đâu. Tên bước (đã kèm "lần k/N" nếu tách) đứng riêng một dòng phía trên. */
function noiChangSau(c: SxBanGiaoChangSau): string | null {
  if (c.loai_buoc === "thue_ngoai") return c.nha_cung_cap ? `Gia công ngoài tại ${c.nha_cung_cap}` : "Gia công ngoài";
  return c.to_ten;
}

/** Số giao theo mẻ: tổng TỐT của mẻ đã tick, không vượt phần còn chưa giao (bàn giao tạo trước khi
 *  có giao-theo-mẻ không gắn mẻ nào, nên mẻ cũ vẫn hiện "chưa giao" dù số đã đi rồi). Không còn mẻ
 *  nào để chọn ⇒ giao nốt phần lẻ. Máy chủ tính lại đúng công thức này — ô số không còn trên form. */
function soTheoMe(me: SxBatch[], chon: Set<number>, conLai: number): number {
  if (me.length === 0) return conLai;
  return Math.min(me.filter((b) => chon.has(b.id)).reduce((t, b) => t + b.tot, 0), conLai);
}

/** Danh sách mẻ tick chọn — dùng chung cho đề xuất mới và sửa mẻ của đề xuất còn chờ xác nhận.
 *  Dòng cuối "Chọn a trên b mẻ" và tổng số sẽ giao. */
function MeChon({
  me, chon, onDoi, tong, dv, nhanTong = "", chuaGiao, lan,
}: {
  me: SxBatch[]; chon: Set<number>; onDoi: (next: Set<number>) => void; tong: number; dv: string;
  /** Số "Lần N" tính trên TẤT CẢ lần ghi của việc (`me` chỉ là phần còn chọn được). */
  lan?: Map<number, number>;
  /** Chữ đứng trước tổng, vd "Giao " ở hộp Đề xuất giao. */
  nhanTong?: string;
  /** Hộp Sửa mẻ: mẻ chưa thuộc lần giao nào thì ghi nhỏ "chưa giao". */
  chuaGiao?: (b: SxBatch) => boolean;
}) {
  function bat(id: number) {
    const next = new Set(chon);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onDoi(next);
  }
  return (
    <div className="thsx-f">
      <span className="thsx-f__n">Sản lượng giao</span>
      <div className="thsx-hop-ds">
        {me.map((b) => (
          <label key={b.id} className="thsx-hop-ds__o">
            <input type="checkbox" checked={chon.has(b.id)} onChange={() => bat(b.id)} />
            <span className="thsx-num">
              {lan?.get(b.id) != null && <span className="thsx-hop-ds__lan">Sản lượng lần {lan.get(b.id)}</span>}
              {formatBatchTime(b.bat_dau, b.ket_thuc)}
              {chuaGiao?.(b) && <small>chưa giao</small>}
            </span>
            <span className="thsx-num">{num(b.tot)}{dv}</span>
          </label>
        ))}
        <div className="thsx-hop-ds__tong">
          <span>Chọn {chon.size} trên {me.length} lần</span>
          <span className="thsx-num">{nhanTong}{num(tong)}{dv}</span>
        </div>
      </div>
    </div>
  );
}

/** Đề xuất bàn giao (§11.2, sửa 14/09/2026; khuôn hộp `#de-xuat-giao` 09/10/2026).
 *
 *  ĐÍCH không phải thứ để chọn: lệnh đã khai routing, backend trả đúng chặng sau. Chỉ khi bước sau
 *  tách lần chạy hoặc routing rẽ nhánh (nhiều chặng sau) tổ mới chọn một trong số đó. Bước cuối
 *  lệnh không mở hộp này (không bàn giao — thành phẩm vào kho qua KCS).
 *
 *  GIAO THEO MẺ: liệt kê các mẻ chưa giao, tick sẵn hết; số lượng = tổng tốt của mẻ đã tick, KHÔNG
 *  gõ tay. Đếm thực tế lệch thì bên giao điều chỉnh sau khi bên nhận xác nhận (§11.3). */
export function BanGiaoForm({
  chiTiet, conLai, busy, onXong, exec,
}: {
  chiTiet: SxWorkItemChiTiet; conLai: number;
  busy: boolean; onXong: () => void; exec: ThsxExec;
}) {
  const cv = chiTiet.cong_viec;
  const donVi = cv.don_vi_ra ?? null;
  const dv = donVi ? ` ${nhanChangLenh(donVi, cv.don_vi_tinh)}` : "";
  const changSau = chiTiet.ban_giao_chang_sau;
  const meChuaGiao = chiTiet.san_luong.batches.filter((b) => !b.da_ban_giao && b.tot > 0);
  const macDinh = changSau.find((c) => c.trang_thai !== "completed") ?? changSau[0];

  const [dich, setDich] = useState<number | null>(macDinh?.cong_viec_id ?? null);
  const [chon, setChon] = useState<Set<number>>(() => new Set(meChuaGiao.map((b) => b.id)));
  const tong = soTheoMe(meChuaGiao, chon, conLai);
  const hopLe = tong > 0
    && (meChuaGiao.length === 0 || chon.size > 0)
    && dich != null;

  async function luu() {
    if (dich == null || !hopLe || busy) return;
    const body: SxBanGiaoDeXuatIn = {
      dich_cong_viec_id: dich,
      don_vi: donVi,
      batch_ids: meChuaGiao.filter((b) => chon.has(b.id)).map((b) => b.id),
    };
    if (await exec.deXuatBanGiao(body)) onXong();
  }

  return (
    <ThsxHop tieuDe="Đề xuất giao" phuDe={cv.nguon_ma ? `${cv.ten_cong_doan} của ${cv.nguon_ma}` : cv.ten_cong_doan}
      nutChinh="Đề xuất giao" nutChinhKhoa={!hopLe} dangGui={busy} onDong={onXong} onChinh={luu}>
      <div className="thsx-f">
        <span className="thsx-f__n">Giao cho</span>
        {changSau.length === 1 ? (
          <div className="thsx-hop-dich">
            <span className="thsx-hop-dich__mui" aria-hidden="true">→</span>
            <div>
              {changSau[0].ten_cong_doan}
              {noiChangSau(changSau[0]) && <small>{noiChangSau(changSau[0])}</small>}
            </div>
            {/* Không in giờ bắt đầu dự kiến của bước nhận (10/10/2026): chữ "dự kiến" trơ trọi bị đọc nhầm
                là giờ giao, mốc lại hay đã cũ — mà giao cho ai thì không phải chọn. */}
          </div>
        ) : (
          <div className="thsx-hop-ds" role="radiogroup" aria-label="Bước sau">
            {changSau.map((c) => (
              <label key={c.cong_viec_id} className="thsx-hop-ds__o">
                <input type="radio" name={`bg-dich-${cv.id}`} checked={dich === c.cong_viec_id}
                  onChange={() => setDich(c.cong_viec_id)} />
                <span>
                  {c.ten_cong_doan}
                  {noiChangSau(c) && <small>{noiChangSau(c)}</small>}
                </span>
                {c.trang_thai === "completed"
                  ? <span className="thsx-gm-mo">đã xong</span>
                  : <span />}
              </label>
            ))}
          </div>
        )}
      </div>

      {meChuaGiao.length > 0 ? (
        <MeChon me={meChuaGiao} chon={chon} onDoi={setChon} tong={tong} dv={dv} nhanTong="Giao "
          lan={lanTheoId(chiTiet.san_luong.batches)} />
      ) : (
        <div className="thsx-f">
          <span className="thsx-f__n">Số giao</span>
          <div className="thsx-bao thsx-bao--xam">
            {conLai > 0
              ? <>Sản lượng các lần đều đã giao. Giao nốt phần lẻ <span className="thsx-num">{num(conLai)}</span>{dv}.</>
              : "Không còn hàng tốt để giao."}
          </div>
        </div>
      )}
      <div className="thsx-bao thsx-bao--xam">
        Bên nhận bấm xác nhận thì lần giao mới tính. Đếm thực tế lệch thì sửa số ở lần ghi sản lượng, lần giao đổi theo.
      </div>
    </ThsxHop>
  );
}

function BanGiaoRow({
  g, phia, canAssign, busy, exec, batches = [], conLai = 0, dvt = null,
}: {
  g: SxBanGiao; phia: "di" | "den"; canAssign: boolean; busy: boolean;
  /** ĐVT thành phẩm của lệnh — tên chặng "cai". */
  dvt?: string | null;
  exec: ThsxExec;
  /** Chỉ dòng "Giao đi": mẻ của công đoạn nguồn + phần còn chưa giao — để sửa mẻ. */
  batches?: SxBatch[]; conLai?: number;
}) {
  const [suaOpen, setSuaOpen] = useState(false);
  const st: { txt: string; mau: MauTT } = choXacNhanLai(g)
    ? { txt: "chờ xác nhận lại", mau: "cam" }
    : BG_TT[g.trang_thai] ?? { txt: g.trang_thai, mau: "vang" };
  // Số đầu thẻ đọc nhãn CHẶNG ("tờ in") cho khớp khối Sản lượng ngay trên — `nhanDonVi` ra "tờ".
  const dvChang = g.don_vi ? ` ${nhanChangLenh(g.don_vi, dvt)}` : "";
  // Mẻ sửa được = mẻ chưa đi theo lần giao nào + mẻ của chính lần giao này.
  const meSua = batches.filter((b) => b.tot > 0 && (!b.da_ban_giao || g.batch_ids.includes(b.id)));
  // Nguồn (đi) đổi mẻ khi còn 'proposed'; đích (đến) xác nhận khi 'proposed' hoặc chờ xác nhận lại.
  // Lệch số sau khi đã nhận thì bên giao sửa số ở MẺ (10/10/2026), lần giao đổi theo.
  const canSua = canAssign && phia === "di" && g.trang_thai === "proposed" && meSua.length > 0;
  const canXac = canAssign && phia === "den" && choBenNhan(g);

  const cdGiao = g.nguon_cong_doan ?? (phia === "den" ? g.doi_tac_ten : null);
  const cdNhan = g.dich_cong_doan ?? (phia === "di" ? (g.doi_tac_ten || "Kho") : null);

  // Đầu kia của tuyến: dòng giao đi ghi nơi NHẬN, dòng nhận vào ghi nơi GIAO — đầu mình khỏi nhắc.
  const cdKia = phia === "di" ? cdNhan : cdGiao;
  const toKia = phia === "di" ? g.dich_to : g.nguon_to;

  return (
    <>
      <tr className="thsx-x-bg">
        <td className="r thsx-num">
          <span className="thsx-b-bgt__so">{num(g.so_luong)}</span>
          {dvChang && <span className="thsx-x-unit">{dvChang}</span>}
          {g.batch_ids.length > 0 && <div className="thsx-b-bgt__phu">{g.batch_ids.length} lần ghi</div>}
        </td>
        <td>
          {cdKia || "—"}
          {toKia && <div className="thsx-b-bgt__phu">{toKia}</div>}
        </td>
        <td>
          {g.nguoi_de_xuat ?? "—"}
          {g.de_xuat_luc && <div className="thsx-b-bgt__phu thsx-num">{ngayGio(g.de_xuat_luc)}</div>}
        </td>
        <td>
          {g.xac_nhan_luc == null ? <span className="thsx-b-canh">Chưa xác nhận</span>
            : g.cung_to ? "Tự nhận (cùng tổ)"
              : <>
                {g.nguoi_xac_nhan ?? "—"}
                <div className="thsx-b-bgt__phu thsx-num">{ngayGio(g.xac_nhan_luc)}</div>
              </>}
        </td>
        <td><ChipTT mau={st.mau}>{st.txt}</ChipTT></td>
        <td className="thsx-b-t__nut">
          {canSua && (
            <Button variant="secondary" onClick={() => setSuaOpen((o) => !o)} disabled={busy}>
              Chọn lại
            </Button>
          )}
          {canXac && (
            <Button variant="accent" onClick={() => void exec.xacNhanBanGiao(g.id, g.version)} disabled={busy}>
              Xác nhận
            </Button>
          )}
        </td>
      </tr>
      {suaOpen && (
        <SuaMeForm g={g} me={meSua} dvt={dvt} lan={lanTheoId(batches)} conLai={conLai} busy={busy}
          onXong={() => setSuaOpen(false)} exec={exec} />
      )}
    </>
  );
}

/** Hộp SỬA MẺ của lần giao còn chờ xác nhận (`#sua-me`) — chọn nhầm thì bỏ, sót thì thêm; số giao
 *  tính lại theo mẻ. Nút Lưu chỉ sáng khi đã đổi gì đó. */
export function SuaMeForm({
  g, me, conLai, busy, onXong, exec, lan, dvt = null,
}: {
  g: SxBanGiao; me: SxBatch[]; conLai: number; busy: boolean; lan?: Map<number, number>;
  dvt?: string | null;
  onXong: () => void; exec: ThsxExec;
}) {
  const [chon, setChon] = useState<Set<number>>(() => new Set(g.batch_ids));
  // Phần còn lại tính cả số của chính lần giao này (nó sắp được thay bằng số mới).
  const tong = soTheoMe(me, chon, conLai + g.so_luong);
  const doi = chon.size !== g.batch_ids.length || g.batch_ids.some((id) => !chon.has(id));
  const dv = g.don_vi ? ` ${nhanChangLenh(g.don_vi, dvt)}` : "";
  const sang = g.dich_cong_doan ?? g.doi_tac_ten;
  const hopLe = doi && chon.size > 0 && tong > 0;

  async function luu() {
    if (!hopLe || busy) return;
    const body: SxBanGiaoSuaIn = {
      batch_ids: me.filter((b) => chon.has(b.id)).map((b) => b.id), expected_version: g.version,
    };
    if (await exec.suaBanGiao(g.id, body)) onXong();
  }

  return (
    <ThsxHop tieuDe="Chọn lại sản lượng của lần giao" co="hep"
      phuDe={`Lần giao ${num(g.so_luong)}${dv}${sang ? ` sang ${sang}` : ""}`}
      nutChinh="Lưu" nutChinhKhoa={!hopLe} dangGui={busy} onDong={onXong} onChinh={luu}>
      <MeChon me={me} chon={chon} onDoi={setChon} tong={tong} dv={dv} lan={lan}
        chuaGiao={(b) => !g.batch_ids.includes(b.id)} />
    </ThsxHop>
  );
}

const BUOC_SUA_SO = [-100, -10, -1, 1, 10, 100];
const LY_DO_SUA_SO = ["Đếm lại", "Gõ nhầm"];

/** Hộp SỬA SỐ MẺ (10/10/2026) — thay "Điều chỉnh số" trên lần giao: chủ xưởng *"bỏ điều chỉnh số ở
 *  các lần giao, sửa số ở chỗ lần mẻ ấy"*. Người có Xác nhận sản lượng ở tổ làm mẻ. Tăng không vượt
 *  trần ghi mẻ; mẻ đã giao thì lần giao đổi theo, khác tổ thì bên nhận xác nhận lại. Máy chủ chặn cả
 *  chiều giảm (dưới số KCS đã kiểm đạt, dưới số bước sau đã ghi) — câu chặn hiện nguyên văn.
 *  Cùng hộp đổi được người làm lần đó, kể cả thêm hoặc bỏ người tổ khác. */
export function SuaSoMeForm({
  b, lan, tranGhi, banGiao, busy, nguoiGhi = [], toKhac, onXong, exec, dvt = null, tuyChon = [],
}: {
  b: SxBatch; tranGhi: SxTranGhi | null; banGiao: SxBanGiao | null; busy: boolean;
  dvt?: string | null;
  onXong: () => void; exec: ThsxExec;
  /** Số "Lần N" của lần ghi đang sửa. */
  lan?: number;
  /** Người tổ mình đang được giao — thêm được vào lần ghi. */
  nguoiGhi?: SxNguoiGhi[];
  /** Thợ tổ khác — thêm được vào lần ghi. */
  toKhac?: NguoiToKhac;
  /** Tuỳ chọn khi ghi công đoạn đang khai; giá trị mở sẵn từ ảnh chụp của lần ghi. */
  tuyChon?: SxTuyChonKhai[];
}) {
  const [tcGt, setTcGt] = useState<Record<string, string>>(() => tuyChonTuAnh(b.tuy_chon_khoan));
  const tcCu = tuyChonBody(tuyChon, tuyChonTuAnh(b.tuy_chon_khoan));
  const tcMoi = tuyChonBody(tuyChon, tcGt);
  const tcDoi = tuyChon.some((t) => tcCu[t.ma] !== tcMoi[t.ma]);
  const nguoiCu = b.nguoi_tham_gia ?? [];
  const idCu = nguoiCu.map((n) => n.employee_id);
  const [themNguoi, setThemNguoi] = useState<NguoiLam[]>([]);
  const dsNguoi: NguoiLam[] = [
    ...nguoiCu.map((n) => ({ id: n.employee_id, ten: n.ho_ten, mo: false, the: n.to_ten ? [n.to_ten] : [] })),
    ...nguoiGhi.filter((n) => !nguoiCu.some((c) => c.employee_id === n.employee_id))
      .map((n) => ({ id: n.employee_id, ten: n.ho_ten, mo: false, the: [] as string[] })),
    ...themNguoi,
  ];
  const [chonNguoi, setChonNguoi] = useState<Set<number>>(() => new Set(idCu));
  const nguoiDoi = chonNguoi.size !== idCu.length || idCu.some((id) => !chonNguoi.has(id));
  const soNguoi = demNguoiLam(dsNguoi, chonNguoi);
  const [so, setSo] = useState(String(b.tot));
  const [lyDo, setLyDo] = useState("");
  const nSo = toNum(so);
  const daGo = so.trim() !== "" && Number.isFinite(Number(so.replace(/,/g, "")));
  const chenhLech = daGo ? nSo - b.tot : 0;
  // Nhãn CHẶNG ("tờ in") cho khớp cột Tốt của dòng mẻ ngay dưới.
  const dv = b.don_vi ? nhanChangLenh(b.don_vi, dvt) : "";
  // Mẻ được sửa lên tới số cũ + phần còn ghi được của bước (các mẻ khác giữ nguyên).
  const toiDa = tranGhi ? b.tot + Math.max(0, tranGhi.con_ghi_duoc) : null;
  const vuotTran = toiDa != null && nSo > toiDa + 0.0005;
  const veKhong = banGiao != null && daGo && nSo <= 0.0005;
  // Lần ghi cũ chưa có ai (gia công ngoài, dữ liệu rỗng) vẫn sửa số được; chỉ chặn khi tổ bỏ tick hết.
  const hopLe = daGo && nSo >= 0 && (Math.abs(chenhLech) > 0.0005 || nguoiDoi || tcDoi) && !vuotTran && !veKhong
    && (!nguoiDoi || soNguoi > 0);
  const sang = banGiao ? (banGiao.dich_cong_doan ?? banGiao.doi_tac_ten) : null;
  const benNhan = banGiao ? (banGiao.dich_to ?? banGiao.doi_tac_ten ?? "bên nhận") : "";

  async function luu() {
    if (!hopLe || busy) return;
    const body: SxSuaSoMeIn = {
      tot: nSo, ly_do: lyDo.trim() || null, expected_version: b.version,
      ...(nguoiDoi ? { nguoi_ids: [...chonNguoi] } : {}),
      ...(tcDoi ? { tuy_chon: tcMoi } : {}),
    };
    if (await exec.suaSoMe(b.id, body)) onXong();
  }

  return (
    <ThsxHop tieuDe="Sửa số sản lượng"
      phuDe={`${lan != null ? `Sản lượng lần ${lan} ` : ""}lúc ${formatBatchTime(b.bat_dau, b.ket_thuc)}`}
      phimTat="Ctrl + Enter để lưu" onPhimTat={luu}
      nutChinh="Lưu" nutChinhKhoa={!hopLe} dangGui={busy} onDong={onXong} onChinh={luu}>
      <div className="thsx-hop-so2">
        <div>
          <small>Số đang ghi</small>
          <span className="thsx-hop-so2__v thsx-num">{num(b.tot)}</span> {dv && <span className="thsx-gm-mo">{dv}</span>}
        </div>
        <div>
          <small>Số sau khi sửa</small>
          <span className="thsx-hop-so2__v thsx-num">{num(nSo)}</span> {dv && <span className="thsx-gm-mo">{dv}</span>}
          {Math.abs(chenhLech) > 0.0001 && (
            <span className={`thsx-hop-so2__lech thsx-num ${chenhLech < 0 ? "is-bot" : "is-them"}`}>
              {chenhLech < 0 ? `bớt ${num(-chenhLech)}` : `thêm ${num(chenhLech)}`}
            </span>
          )}
        </div>
      </div>

      <div className="thsx-f">
        <label className="thsx-f__n" htmlFor={`ss-so-${b.id}`}>Số lượng làm được</label>
        <div className={`thsx-gm-so${vuotTran || veKhong ? " is-loi" : ""}`}>
          <input id={`ss-so-${b.id}`} type="number" min={0} inputMode="numeric" className="thsx-o-so"
            value={so} onChange={(e) => setSo(e.target.value)} />
          {dv && <span className="thsx-gm-mo">{dv}</span>}
        </div>
        <div className="thsx-chips">
          {BUOC_SUA_SO.map((d) => (
            <button key={d} type="button" className="thsx-chip thsx-num"
              onClick={() => setSo(String(Math.max(0, toiDa != null ? Math.min(toiDa, nSo + d) : nSo + d)))}>
              {d < 0 ? `−${-d}` : `+${d}`}
            </button>
          ))}
          {nSo !== b.tot && (
            <button type="button" className="thsx-b-lk" onClick={() => setSo(String(b.tot))}>
              Về số cũ {num(b.tot)}
            </button>
          )}
        </div>
        {toiDa != null && !vuotTran && <span className="thsx-f__g thsx-num">Sửa tối đa {num(toiDa)} {dv}</span>}
        {vuotTran && toiDa != null && (
          <span className="thsx-f__g thsx-f__g--loi">
            Vượt số còn ghi được, lần này sửa tối đa {num(toiDa)} {dv}.
          </span>
        )}
        {veKhong && <span className="thsx-f__g thsx-f__g--loi">Lần này đã giao, không sửa về 0 được.</span>}
      </div>

      <NguoiLamChon ds={dsNguoi} chon={chonNguoi} onDoi={setChonNguoi} baoThieu={nguoiDoi}
        toKhac={toKhac} ngay={toDtLocal(b.bat_dau).slice(0, 10)}
        onThem={(n) => { setThemNguoi((cu) => [...cu, n]); setChonNguoi((cu) => new Set(cu).add(n.id)); }} />

      {tuyChon.length > 0 && <TuyChonGhi ds={tuyChon} gt={tcGt} onDoi={setTcGt} />}

      <div className="thsx-f">
        <label className="thsx-f__n" htmlFor={`ss-ld-${b.id}`}>Lý do sửa</label>
        <input id={`ss-ld-${b.id}`} type="text" className="thsx-x-in" value={lyDo} onChange={(e) => setLyDo(e.target.value)} />
        <div className="thsx-chips">
          <span className="thsx-chips__nhan">Chọn nhanh</span>
          {LY_DO_SUA_SO.map((c) => (
            <button key={c} type="button" className="thsx-chip" aria-pressed={lyDo === c} onClick={() => setLyDo(c)}>{c}</button>
          ))}
        </div>
        <span className="thsx-f__g">Không bắt buộc</span>
      </div>

      {banGiao && (
        <div className="thsx-bao thsx-bao--xanh">
          Lần này đã giao{sang ? ` sang ${sang}` : ""}.{" "}
          {Math.abs(chenhLech) > 0.0001 ? (
            <>
              Lần giao <span className="thsx-num">{num(banGiao.so_luong)}</span> đổi thành{" "}
              <span className="thsx-num">{num(Math.max(0, banGiao.so_luong + chenhLech))}</span> {dv}.
            </>
          ) : (
            <>Sửa số thì lần giao <span className="thsx-num">{num(banGiao.so_luong)}</span> {dv} đổi theo.</>
          )}
          {!banGiao.cung_to && (banGiao.trang_thai === "confirmed"
            ? ` ${benNhan} sẽ phải xác nhận lại.`
            : ` ${benNhan} chưa xác nhận, sẽ thấy số mới.`)}
        </div>
      )}
    </ThsxHop>
  );
}

// ────────────── VẬT TƯ: đề nghị cấp theo công đoạn + phiếu nhận về tổ ──────────────
// Khối này LUÔN hiện, kể cả chưa có phiếu nào: bản cũ `if (vt.length === 0) return null;` khiến tổ
// trưởng không có cửa nào để bắt đầu xin vật tư (spec §7).
//
// Hai luồng dữ liệu KHÁC NHAU cùng nằm một section:
//   · `chiTiet.vat_tu_cap` — các LẦN tổ ĐỀ NGHỊ + bản đối chiếu kế hoạch/yêu cầu/thực xuất.
//   · `chiTiet.vat_tu`     — phiếu kho ĐÃ ghi sổ, chờ tổ xác nhận NHẬN (giữ nguyên như cũ).
//
// Vật tư KHÔNG BAO GIỜ chặn bắt đầu/kết thúc công đoạn (spec §8) — không có gì ở đây gài vào
// `disabled` của hai nút đó.
/** `nhap_lai` = tổ trả vật tư thừa về kho (yêu cầu NHẬP): cùng form Kho, chiều nhập, không cột nền. */
type VtFormMode = "moi" | "sua" | "bo_sung" | "nhap_lai";

/** Đúng MỘT nút CTA hiện ở header. Thứ tự kiểm là CỐ ĐỊNH: `de_nghi_co_the_sua_id` trước, rồi
 *  "chưa từng đề nghị", cuối cùng mới tới bổ sung — `co_the_tao_bo_sung` có thể `true` ngay cả khi
 *  chưa có lần nào, đảo thứ tự là mời tổ trưởng "bổ sung" cho công đoạn chưa xin gì. */
function ctaMode(vt: SxVatTuCap): VtFormMode | null {
  if (vt.de_nghi_co_the_sua_id != null) return "sua";
  if (vt.cac_de_nghi.length === 0) return "moi";
  if (vt.co_the_tao_bo_sung) return "bo_sung";
  return null;
}

const VT_CTA: Record<VtFormMode, { txt: string; icon: "send" | "pencil" | "plus" | "packageCheck" }> = {
  moi: { txt: "Yêu cầu cấp vật tư", icon: "send" },
  sua: { txt: "Sửa đề nghị", icon: "pencil" },
  bo_sung: { txt: "Yêu cầu bổ sung", icon: "plus" },
  nhap_lai: { txt: "Yêu cầu nhập kho", icon: "packageCheck" },
};

export function VatTuSection({
  chiTiet, canAssign, busy, exec, tenTo,
}: {
  chiTiet: SxWorkItemChiTiet; canAssign: boolean; busy: boolean; exec: ThsxExec;
  /** Tên tổ của bàn — đường dẫn "Bàn tổ … ›" và dòng Tổ của form Kho. */
  tenTo?: string;
}) {
  const { token } = useAuth();
  const [formMode, setFormMode] = useState<VtFormMode | null>(null);
  // Chứng từ kho đang mở chồng lên ngăn: đề nghị (bấm mã yêu cầu) hoặc phiếu (bấm thẻ phiếu).
  const [chungTu, setChungTu] = useState<ChungTuKho | null>(null);
  const moPhieu = (id: number) => setChungTu({ loai: "phieu", id });
  const moDeNghi = (id: number) => setChungTu({ loai: "de_nghi", id });
  const vt = chiTiet.vat_tu;
  const cap = chiTiet.vat_tu_cap;
  const cta = ctaMode(cap);
  const cvId = chiTiet.cong_viec.id;
  const lanSua = cap.cac_de_nghi.find((d) => d.id === cap.de_nghi_co_the_sua_id) ?? null;

  // Drawer KHÔNG remount khi bấm sang việc khác (`ThsxDrawer` render không có `key`, `loadChiTiet`
  // không đặt `chiTiet = null` giữa chừng) nên khối này sống xuyên suốt: form đang mở dở của việc A
  // vẫn còn nguyên khi màn đã là việc B ⇒ bấm Gửi là B nhận vật tư của A. Đóng form khi đổi việc.
  useEffect(() => { setFormMode(null); setChungTu(null); }, [cvId]);

  // Dòng "Nhận từ bước trước" không phải thứ phải xin cấp — không tính vào mẫu số/tử số.
  const canXin = cap.doi_chieu.filter((d) => !d.nhan_tu);
  const tongMatHang = canXin.length;
  // Tình trạng từng món tính MỘT lần — dùng cho cả chip dòng lẫn mấy thẻ đếm cạnh tiêu đề.
  const tinhTrang = cap.doi_chieu.map((d) => vtTinhTrang(d, cap.cac_de_nghi));
  const demTT = (loai: VtLoaiTT) => tinhTrang.filter((t) => t.loai === loai).length;
  const chuaXin = demTT("chua_xin");
  const choKho = demTT("cho_kho");
  const khoLech = demTT("kho_lech");
  const nhapLai = cap.cac_nhap_lai ?? [];
  const coChungTu = cap.cac_de_nghi.length > 0 || vt.length > 0 || nhapLai.length > 0;
  const reqCuaDeNghi = new Set(cap.cac_de_nghi.map((d) => d.stock_request_id).filter((x) => x != null));
  const phieuLe = vt.filter((v) => v.request_id == null || !reqCuaDeNghi.has(v.request_id));

  /** `onGui` của form Kho: dòng form → thân gửi ĐƯỜNG CỦA TỔ (máy chủ tự gắn lệnh của việc vào dòng
   *  thêm tay). Ném lỗi thì form giữ nguyên và hiện câu ở dải lỗi; xong thì form tự đóng. */
  async function guiVatTu(mode: VtFormMode, p: { can_luc: string; ghi_chu: string | null; dong: DraftLine[] }) {
    const dongs = p.dong.map(vtDongTuDraft);
    // Loại HIỆU LỰC quyết luật lọc dòng: sửa thì theo `loai` của chính lần đang sửa.
    const loai = mode === "moi" || (mode === "sua" && lanSua?.loai !== "bo_sung") ? "lan_dau" : "bo_sung";
    const lines = vtPayloadLines(dongs, loai);
    const chan = vtCanTro(dongs, lines, mode, loai);
    if (chan) throw new ApiError(chan, 400);
    let ok: boolean;
    if (mode === "nhap_lai") {
      ok = await exec.nhapLaiVatTu(cvId, { can_luc: p.can_luc, ghi_chu: p.ghi_chu, lines: vtPayloadNhapLai(dongs) });
    } else if (mode === "sua") {
      // Sửa mà không tra ra lần nào ⇒ DỪNG, tuyệt đối không rơi sang tạo mới: đó là đẻ thêm một lần
      // đề nghị nữa (cộng dồn vào bản đối chiếu) thay vì sửa lần đang mở.
      if (lanSua == null) throw new ApiError("Không thấy lần đề nghị đang sửa — đóng form rồi mở lại.", 0);
      ok = await exec.suaDeNghiVatTu(cvId, lanSua.id, { can_luc: p.can_luc, ghi_chu: p.ghi_chu, lines });
    } else {
      ok = await exec.deNghiVatTu(cvId, { can_luc: p.can_luc, ghi_chu: p.ghi_chu, lines });
    }
    // Lỗi máy chủ đã hiện ở toast của bàn tổ (`exec` không trả câu lỗi) — ngăn phải ở lại, không đóng
    // như đã gửi.
    if (!ok) throw new ApiError("Chưa gửi được. Xem thông báo lỗi ở góc dưới màn hình.", 0);
  }

  return (
    <>
    <section className="thsx-b-sec">
      <div className="thsx-b-sec__dau">
        <h3 className="thsx-b-sec__h">Vật tư theo kế hoạch</h3>
        {/* Thay băng ba ô số: vài thẻ nhỏ, chỉ hiện thẻ có việc phải lo. */}
        {tongMatHang > 0 && <span className="thsx-b-mo3">{tongMatHang} món</span>}
        {chuaXin > 0 && <span className="thsx-b-canh">{chuaXin} chưa xin</span>}
        {choKho > 0 && <span className="thsx-b-mo3">{choKho} chờ kho</span>}
        {khoLech > 0 && <span className="thsx-b-loi">{khoLech} kho xuất lệch</span>}
        {canAssign && (
          <span className="thsx-b-sec__phai">
            {/* Trả vật tư thừa về kho — logic chung mọi vật tư, mở được bất kể đã xin hay chưa. */}
            <Button variant="secondary" onClick={() => setFormMode("nhap_lai")} disabled={busy} aria-haspopup="dialog">
              {VT_CTA.nhap_lai.txt}
            </Button>
            {cta != null && (
              <Button variant="accent" onClick={() => setFormMode(cta)} disabled={busy} aria-haspopup="dialog">
                {VT_CTA[cta].txt}
              </Button>
            )}
          </span>
        )}
      </div>

      {cap.du_lieu_cu && (
        <div className="thsx-bao thsx-bao--vang thsx-b-bao" role="status">
          Dữ liệu lịch sử (trước 31/08/2026): công đoạn chưa từng gửi đề nghị nên phiếu đang lấy theo lệnh sản xuất cũ.
        </div>
      )}

      {cap.doi_chieu.length === 0 ? (
        <p className="thsx-b-trong">
          Công đoạn này không có nhu cầu vật tư theo kế hoạch.
          <small>Vẫn gửi đề nghị được nếu tổ cần xin thêm.</small>
        </p>
      ) : (
        // Mỗi món ĐÚNG một dòng thấp, không dòng phụ trong ô; bấm dòng mở ra xem đã xin ở lần nào và
        // thực dùng tính ra sao (10/10/2026 — 10 món trở lên bảng cũ cao gấp ba vì chip chồng, dòng phụ).
        <div className="thsx-b-tw">
        <table className="thsx-b-t thsx-b-vt">
          <thead>
            <tr>
              <th>Vật tư</th>
              <th className="r">Kế hoạch</th>
              <th className="r">Đã xin</th>
              <th className="r">Kho đã xuất</th>
              <th className="r">Nhập lại</th>
              <th className="r" title="Thực dùng = kho đã xuất − tổ nhập lại kho">Thực dùng</th>
              <th>Tình trạng</th>
            </tr>
          </thead>
          {cap.doi_chieu.map((d, i) => (
            <VtDongMon key={vtKhoa(d)} d={d} t={tinhTrang[i]} cacDeNghi={cap.cac_de_nghi} />
          ))}
        </table>
        </div>
      )}
    </section>

      {formMode != null && createPortal(
        // Form Yêu cầu nhập xuất của Kho, mở từ công việc. PORTAL ra `body` vì `.thsx-panel--open` có
        // `transform` — render tại chỗ thì ngăn bị nhốt trong khung bàn tổ. Lớp bọc z 65: trên bàn tổ
        // (61), dưới toast (70) để lỗi máy chủ vẫn đọc được. Chặn click nổi ngược qua portal về cây bàn tổ.
        <div className="thsx-ngan-kho" onClick={(e) => e.stopPropagation()}>
          <TaoYeuCauP2
            // `cvId` nằm trong key để dựng lại state form khi đổi việc — hai việc cùng chưa có đề
            // nghị thì `"moi-0"` giống hệt nhau, một mình `setFormMode(null)` ở trên vẫn hở nếu về
            // sau có đường nào mở form mà không đi qua nút CTA.
            key={`${cvId}-${formMode}-${lanSua?.id ?? 0}`}
            token={token ?? ""}
            canRequest
            tuCongViec={{
              ...dungTuCongViec(chiTiet.cong_viec, cap, formMode, formMode === "sua" ? lanSua : null, tenTo ?? ""),
              // Dòng thêm tay: đơn vị lần trước của chính mặt hàng đó, khỏi lật đơn vị cả hàng đối chiếu.
              dvtGoiY: (hl, id) => vtDvtLanTruoc(cap.cac_de_nghi, hl, id),
              onGui: (p) => guiVatTu(formMode, p),
            }}
            onClose={() => setFormMode(null)}
            onSaved={() => setFormMode(null)}
          />
        </div>,
        document.body,
      )}

    {/* Đề nghị và phiếu kho: mỗi yêu cầu tổ gửi kho MỘT dòng, phiếu kho của chính nó nằm ở cột Phiếu
        kho cùng dòng (11/10/2026, phương án B). Không kể lại từng món — bấm dòng mới mở ra. */}
    <section className="thsx-b-sec">
      <div className="thsx-b-sec__dau">
        <h3 className="thsx-b-sec__h">Đề nghị và phiếu kho</h3>
        {cap.cac_de_nghi.length > 0 && <span className="thsx-b-mo3">{cap.cac_de_nghi.length} yêu cầu xuất</span>}
        {nhapLai.length > 0 && <span className="thsx-b-mo3">{nhapLai.length} yêu cầu nhập</span>}
      </div>
      {!coChungTu ? (
        <p className="thsx-b-trong">Chưa gửi kho yêu cầu nào.</p>
      ) : (
        <div className="thsx-b-tw">
        <table className="thsx-b-t thsx-b-ct">
          <thead>
            <tr>
              <th>Yêu cầu</th>
              <th>Chiều</th>
              <th>Cần lúc</th>
              <th>Người gửi</th>
              <th>Trạng thái</th>
              <th>Phiếu kho</th>
            </tr>
          </thead>
          {/* Mới nhất lên đầu — khớp quy ước màn Kho. Trả về kho thường gửi sau cùng nên đứng trước. */}
          {[...nhapLai].reverse().map((r) => (
            <VtNhapLaiRow key={`n${r.id}`} r={r} onMoPhieu={moPhieu} onMoDeNghi={moDeNghi} />
          ))}
          {[...cap.cac_de_nghi].reverse().map((d) => (
            <VtDeNghiLanRow key={d.id} d={d} onMoPhieu={moPhieu} onMoDeNghi={moDeNghi}
              phieu={vt.filter((v) => v.request_id != null && v.request_id === d.stock_request_id)} />
          ))}
          {/* Phiếu không gắn đề nghị nào của bước (dữ liệu trước 31/08/2026 lấy theo lệnh). */}
          {phieuLe.length > 0 && (
            <tbody>
              {phieuLe.map((v) => (
                <tr key={v.voucher_id}>
                  <td className="thsx-b-mo3">Không qua đề nghị</td>
                  <td><ChipTT mau="cyan">Xuất kho</ChipTT></td>
                  <td>—</td>
                  <td>—</td>
                  <td />
                  <td><PhieuKhoChip ma={v.ma} chu="xuất" luc={v.xuat_luc} nguoi={v.nguoi_xuat}
                    onMo={() => moPhieu(v.voucher_id)} /></td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
        </div>
      )}
    </section>

    {/* CÙNG ngăn của màn Kho, chỉ đọc — từ đề nghị bấm sang phiếu đã lập ngay trong lớp. Portal ra
        `body` vì ngăn bàn tổ có `transform`; lớp tự bắt Esc để không đóng luôn cả ngăn bàn tổ. */}
    {chungTu != null && <ChungTuKhoNoi mo={chungTu} token={token ?? ""} lop="thsx-phieu-kho-lop" onClose={() => setChungTu(null)} />}
    </>
  );
}

type VtLoaiTT = "nhan_tu" | "khac_kho" | "chua_xin" | "cho_kho" | "kho_lech" | "lech_kh" | "khop";
interface VtTT { loai: VtLoaiTT; mau: MauTT; txt: string; phu: string | null }
/** Yêu cầu kho còn đang chạy — kho chưa xuất đủ lúc này là CHỜ, chưa phải thiếu. */
const VT_KHO_MO = new Set(["approved", "received", "preparing", "partial"]);

/** Tình trạng MỘT món: một chip cho việc cần lo nhất, lệch thứ hai (nếu có) là chữ mờ bên cạnh.
 *  Mỗi tình trạng một sắc riêng. Kho chưa xuất đủ mà yêu cầu còn mở ⇒ "Chờ kho" — trước 10/10/2026
 *  dòng vừa gửi đã đeo chip đỏ "Kho thiếu" dù kho chưa kịp làm gì. */
export function vtTinhTrang(d: SxVatTuCapDoiChieu, cacDeNghi: SxVatTuCapLan[]): VtTT {
  if (d.nhan_tu) return { loai: "nhan_tu", mau: "xam", txt: `Nhận từ ${d.nhan_tu}`, phu: null };
  if (d.sl_thuc_dung == null) {
    return { loai: "khac_kho", mau: "cham", txt: "Nhập lại khác khổ", phu: `trừ vào dòng ${d.nhap_lai_vao ?? "—"}` };
  }
  const dv = nhanDonVi(d.dvt);
  const dvGoc = nhanDonVi(d.dvt_goc);
  if (d.sl_yeu_cau <= VT_EPS && d.sl_ke_hoach > VT_EPS) return { loai: "chua_xin", mau: "vang", txt: "Chưa xin", phu: null };
  const soKh = d.sl_yeu_cau - d.sl_ke_hoach;
  const ngoaiKh = d.sl_ke_hoach <= VT_EPS && d.sl_yeu_cau > VT_EPS;
  const chuKh = Math.abs(soKh) <= VT_EPS ? null
    : ngoaiKh ? "ngoài kế hoạch"
    : soKh > 0 ? `vượt kế hoạch ${num(soKh)} ${dv}` : `ít hơn kế hoạch ${num(-soKh)} ${dv}`;
  const k = vtKhoa(d);
  const lanCoMon = cacDeNghi.filter((l) => l.dongs.some((x) => vtKhoa(x) === k && x.sl_yeu_cau_goc > 0));
  const soYc = d.lech_thuc_te;
  if (vtCoLechThucTe(d, lanCoMon.length)) {
    if (soYc > 0) return { loai: "kho_lech", mau: "tim", txt: `Kho xuất dư ${num(soYc)} ${dvGoc}`, phu: chuKh };
    if (lanCoMon.some((l) => VT_KHO_MO.has(l.stock_request_trang_thai ?? ""))) {
      return {
        loai: "cho_kho", mau: "xanh", txt: "Chờ kho",
        phu: d.sl_thuc_xuat > VT_EPS ? `đã xuất ${num(d.sl_thuc_xuat)} ${dvGoc}` : chuKh,
      };
    }
    return { loai: "kho_lech", mau: "do", txt: `Kho xuất thiếu ${num(-soYc)} ${dvGoc}`, phu: chuKh };
  }
  if (chuKh) {
    const txt = chuKh.charAt(0).toUpperCase() + chuKh.slice(1);
    return { loai: "lech_kh", mau: soKh > 0 ? "cam" : "cyan", txt, phu: null };
  }
  return { loai: "khop", mau: "la", txt: "Khớp", phu: null };
}

/** MỘT món của bảng vật tư. Dòng gấp: số + một chip; mở ra: đã xin ở lần nào, thực dùng tính ra sao. */
function VtDongMon({ d, t, cacDeNghi }: { d: SxVatTuCapDoiChieu; t: VtTT; cacDeNghi: SxVatTuCapLan[] }) {
  const [mo, setMo] = useState(false);
  const dv = nhanDonVi(d.dvt);
  const dvGoc = nhanDonVi(d.dvt_goc);
  const k = vtKhoa(d);
  const cacLan = cacDeNghi.flatMap((l) => l.dongs
    .filter((x) => vtKhoa(x) === k && x.sl_yeu_cau > VT_EPS)
    .map((x) => ({ l, x })));
  const kho = nhanKhoGiay(d) || null;
  const so = (n: number, u: string) => <>{num(n)}<span className="thsx-x-unit"> {u}</span></>;
  return (
    <tbody className={`thsx-b-vt__mon${mo ? " is-mo" : ""}`}>
      {/* Cả dòng là chỗ bấm; nút ở ô tên cho bàn phím — click của nút nổi lên dòng, nút không tự bắt. */}
      <tr className="thsx-b-vt__dong" onClick={() => setMo((o) => !o)}>
        <td>
          <button type="button" className="thsx-b-vt__ten" aria-expanded={mo}>
            <Icon name="chevron" size={12} className={`thsx-b-vt__mui${mo ? "" : " thsx-rot-90"}`} />
            <span>{d.ten}</span>
            {kho && <span className="thsx-b-mo3">{kho}</span>}
          </button>
        </td>
        <td className="r thsx-num">{so(d.sl_ke_hoach, dv)}</td>
        <td className="r thsx-num">{so(d.sl_yeu_cau, dv)}</td>
        {/* Kho đã xuất / nhập lại / thực dùng đọc thẳng dòng chứng từ nên LUÔN ở thang GỐC (board.py:
            `_vat_tu_cap`) — dán nhãn `dvt` (thang tổ khai) vào đây là in sai đơn vị. */}
        <td className="r thsx-num">{d.nhan_tu ? <span className="thsx-b-mo3">—</span> : so(d.sl_thuc_xuat, dvGoc)}</td>
        <td className="r thsx-num">{so(d.sl_nhap_lai, dvGoc)}</td>
        <td className="r thsx-num">{d.sl_thuc_dung == null ? <span className="thsx-b-mo3">—</span> : so(d.sl_thuc_dung, dvGoc)}</td>
        <td>
          <span className="thsx-b-vt__tt">
            <ChipTT mau={t.mau}>{t.txt}</ChipTT>
            {t.phu && <span className="thsx-b-mo3">{t.phu}</span>}
          </span>
        </td>
      </tr>
      {mo && (
        <tr className="thsx-b-vt__ct">
          <td colSpan={7}>
            <dl className="thsx-b-kv thsx-b-kv--rong">
              <dt>Đã xin</dt>
              <dd>
                {cacLan.length === 0 ? <span className="thsx-b-mo3">chưa xin lần nào</span> : cacLan.map(({ l, x }) => (
                  <div key={l.id} className="thsx-b-vt__lan">
                    <span>Lần {l.lan_so}</span>
                    {l.stock_request_ma && <span className="thsx-b-mo3 thsx-num">{l.stock_request_ma}</span>}
                    <span className="thsx-num">{so(x.sl_yeu_cau, nhanDonVi(x.dvt))}</span>
                  </div>
                ))}
              </dd>
              <dt>Thực dùng</dt>
              <dd className="thsx-num">
                {d.sl_thuc_dung == null
                  ? <>nhập lại {so(d.sl_nhap_lai, dvGoc)} đã trừ ở dòng {d.nhap_lai_vao ?? "—"}</>
                  : d.nhan_tu
                    ? <>nhận {so(d.sl_ke_hoach_goc, dvGoc)} trừ nhập lại {so(d.sl_nhap_lai, dvGoc)}</>
                    : <>kho xuất {so(d.sl_thuc_xuat, dvGoc)} trừ nhập lại {so(d.sl_nhap_lai, dvGoc)}</>}
              </dd>
            </dl>
          </td>
        </tr>
      )}
    </tbody>
  );
}

/** MỘT lần đề nghị trong danh sách chứng từ — một dòng; bấm mở ra xem lần đó xin những gì. */
/** Trạng thái yêu cầu NHẬP: "một phần" là kho đã nhập một phần, không phải đã cấp. */
const VT_TT_NHAP: Record<string, { txt: string; mau: MauTT }> = {
  ...VT_TT,
  partial: { txt: "Đã nhập một phần", mau: "cam" },
};

/** Một yêu cầu nhập kho tổ trả hàng thừa — bấm dòng mở ra các món và số trả. Chỉ số lượng. */
/** Một phiếu kho trong cột Phiếu kho: mã + lúc ghi sổ, bấm mở phiếu chỉ đọc. Chặn click nổi lên dòng
 *  (bấm dòng là bung danh sách món). */
function PhieuKhoChip({ ma, chu, luc, nguoi, onMo }: {
  ma: string; chu: string; luc: string | null; nguoi: string | null; onMo: () => void;
}) {
  return (
    <button type="button" className="thsx-b-pk" aria-haspopup="dialog"
      title={`Xem phiếu ${chu} kho${nguoi ? `\nGhi sổ: ${nguoi}` : ""}`}
      onClick={(e) => { e.stopPropagation(); onMo(); }}>
      <Icon name="box" size={13} className="thsx-x-vt__ic" />
      <span className="thsx-num">{ma}</span>
      {luc && <span className="thsx-b-mo3">{chu} {ngayGio(luc)}</span>}
    </button>
  );
}

/** Mã yêu cầu kho — CÙNG dáng thẻ phiếu, bấm mở ngăn yêu cầu của màn Kho (chỉ đọc). */
function MaDeNghiChip({ ma, onMo }: { ma: string; onMo: () => void }) {
  return (
    <button type="button" className="thsx-b-pk" aria-haspopup="dialog" title="Xem yêu cầu kho"
      onClick={(e) => { e.stopPropagation(); onMo(); }}>
      <Icon name="clipboardList" size={13} className="thsx-x-vt__ic" />
      <span className="thsx-num">{ma}</span>
    </button>
  );
}

/** Ô Phiếu kho của một yêu cầu: các phiếu đã ghi sổ, hoặc chữ mờ khi kho chưa lập. */
function OPhieuKho({ cac, chu, onMo }: {
  cac: { voucher_id: number; ma: string; luc: string | null; nguoi: string | null }[];
  chu: string; onMo: (id: number) => void;
}) {
  if (cac.length === 0) return <span className="thsx-b-mo3">Kho chưa lập phiếu</span>;
  return (
    <span className="thsx-b-pks">
      {cac.map((p) => (
        <PhieuKhoChip key={p.voucher_id} ma={p.ma} chu={chu} luc={p.luc} nguoi={p.nguoi}
          onMo={() => onMo(p.voucher_id)} />
      ))}
    </span>
  );
}

function VtNhapLaiRow({ r, onMoPhieu, onMoDeNghi }: {
  r: SxVatTuNhapLai; onMoPhieu: (id: number) => void; onMoDeNghi: (id: number) => void;
}) {
  const st = VT_TT_NHAP[r.trang_thai];
  // `r.id` là chính yêu cầu nhập kho ⇒ bấm dòng mở ngăn yêu cầu của màn Kho (như bấm thẻ phiếu).
  return (
    <tbody className="thsx-b-vt__mon">
      <tr className="thsx-b-vt__dong" onClick={() => onMoDeNghi(r.id)}>
        <td>
          <MaDeNghiChip ma={r.ma} onMo={() => onMoDeNghi(r.id)} />
          <span className="thsx-b-mo3 thsx-b-ct__phu">{r.dongs.length} món</span>
        </td>
        <td><ChipTT mau="cham">Nhập kho</ChipTT></td>
        <td className="thsx-num">{r.can_luc ? ngayGio(r.can_luc) : "—"}</td>
        <td title={`Gửi lúc ${ngayGio(r.created_at)}`}>{r.created_by_ten || "—"}</td>
        <td><ChipTT mau={st?.mau ?? "vang"}>{st?.txt ?? r.trang_thai}</ChipTT></td>
        <td>
          <OPhieuKho chu="nhập" onMo={onMoPhieu} cac={(r.cac_phieu ?? []).map((p) => (
            { voucher_id: p.voucher_id, ma: p.ma, luc: p.nhap_luc, nguoi: p.nguoi_nhap }))} />
        </td>
      </tr>
    </tbody>
  );
}

function VtDeNghiLanRow({ d, phieu, onMoPhieu, onMoDeNghi }: {
  d: SxVatTuCapLan; phieu: SxPhieuXuatVatTu[]; onMoPhieu: (id: number) => void; onMoDeNghi: (id: number) => void;
}) {
  const [mo, setMo] = useState(false);
  // Có yêu cầu kho ⇒ bấm dòng mở NGĂN yêu cầu của màn Kho (như bấm thẻ phiếu); lần "không cần cấp"
  // không có chứng từ nào để mở ⇒ giữ bấm-mở-ra danh sách món tại chỗ.
  const yc = d.stock_request_id;
  const st = d.stock_request_trang_thai ? VT_TT[d.stock_request_trang_thai] : null;
  const dongs = d.dongs.filter((x) => x.sl_yeu_cau > VT_EPS);
  const suaBoi = d.updated_by_id != null && d.updated_by_id !== d.created_by_id;
  return (
    <tbody className={`thsx-b-vt__mon${mo ? " is-mo" : ""}`}>
      <tr className="thsx-b-vt__dong" onClick={() => (yc != null ? onMoDeNghi(yc) : setMo((o) => !o))}>
        <td>
          {yc != null ? <MaDeNghiChip ma={d.stock_request_ma ?? "—"} onMo={() => onMoDeNghi(yc)} /> : (
            <button type="button" className="thsx-b-vt__ten" aria-expanded={mo}>
              <Icon name="chevron" size={12} className={`thsx-b-vt__mui${mo ? "" : " thsx-rot-90"}`} />
              <span className="thsx-num">{d.stock_request_ma ?? "—"}</span>
            </button>
          )}
          <span className="thsx-b-mo3 thsx-b-ct__phu">Lần {d.lan_so}</span>
          {d.loai === "bo_sung" && <span className="thsx-b-mo3 thsx-b-ct__phu">bổ sung</span>}
          <span className="thsx-b-mo3 thsx-b-ct__phu">{dongs.length} món</span>
        </td>
        <td><ChipTT mau="cyan">Xuất kho</ChipTT></td>
        <td className="thsx-num">{ngayGio(d.can_luc)}</td>
        {/* Lần tự lập: người bấm phát hành chỉ đứng tên — ô ghi rõ hệ thống lập, tên người để ở title.
            Tổ sửa lần tự lập thì `updated_by_id` mới có (lúc lập để trống). */}
        <td title={`${d.tu_lap ? `${d.created_by_ten || "—"} phát hành lệnh lúc` : "Gửi lúc"} ${ngayGio(d.created_at)}${
          d.updated_by_id != null && (d.tu_lap || suaBoi) ? `\n${d.updated_by_ten || "—"} sửa lúc ${ngayGio(d.updated_at)}` : ""}`}>
          {d.tu_lap ? "Tự lập khi phát hành" : d.created_by_ten || "—"}
        </td>
        <td>
          {d.stock_request_ma
            ? <ChipTT mau={st?.mau ?? "vang"}>{st?.txt ?? d.stock_request_trang_thai}</ChipTT>
            : <ChipTT mau="slate">Không cần cấp</ChipTT>}
        </td>
        <td>
          {d.stock_request_ma && (
            <OPhieuKho chu="xuất" onMo={onMoPhieu} cac={phieu.map((v) => (
              { voucher_id: v.voucher_id, ma: v.ma, luc: v.xuat_luc, nguoi: v.nguoi_xuat }))} />
          )}
        </td>
      </tr>
      {mo && yc == null && (
        <tr className="thsx-b-vt__ct">
          <td colSpan={6}>
            {dongs.length === 0 ? <span className="thsx-b-mo3">Lần này không xin món nào.</span> : (
              <ul className="thsx-b-vt__ds">
                {dongs.map((x) => (
                  <li key={vtKhoa(x)}>
                    <span>{x.ten}</span>
                    {nhanKhoGiay(x) && <span className="thsx-b-mo3">{nhanKhoGiay(x)}</span>}
                    <span className="thsx-num">{num(x.sl_yeu_cau)}<span className="thsx-x-unit"> {nhanDonVi(x.dvt)}</span></span>
                  </li>
                ))}
              </ul>
            )}
            <div className="thsx-b-mo3 thsx-b-vt__gui">
              Gửi lúc {ngayGio(d.created_at)}
              {suaBoi && <> sửa bởi {d.updated_by_ten || "—"} lúc {ngayGio(d.updated_at)}</>}
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}

// ---- Gửi đề nghị: form Kho mở từ công việc (`TaoYeuCauP2` + `dungTuCongViec`) -------------------
// Form là của Kho; ở đây chỉ còn phần đổi dòng form → thân gửi đường của tổ và các luật chặn.
interface VtDongForm {
  key: string;
  hang_loai: string;
  hang_id: number;          // 0 = dòng chưa chọn mặt hàng
  ten: string;
  /** Giấy: khổ mm + đơn vị gốc (`to`, `kg`…) — cùng mã khác khổ/đơn vị gốc là hai dòng. Đơn vị gốc
   *  chỉ để khớp dòng ở máy khách, KHÔNG gửi (máy chủ tự suy từ `dvt`). */
  don_vi_goc: string;
  kho_rong: number;
  kho_dai: number;
  dvt: string;
  /** Đơn vị của số nền (kế hoạch / đã xin) cùng mặt hàng. */
  dvtKeHoach: string;
  sl_ke_hoach: number;
  sl_yeu_cau: number;
  /** Dòng đến TỪ kế hoạch: lần đầu phải lưu đủ kể cả khi = 0, nên không cho xoá (dùng "Về 0"). */
  tuKeHoach: boolean;
}

type VtKhoaVao = { hang_loai: string; hang_id: number; don_vi_goc?: string | null;
  kho_rong?: number; kho_dai?: number };

/** Khoá một dòng vật tư — phản chiếu `khoa_dong` của máy chủ: loại · mã · đơn vị gốc · khổ (ngắn ×
 *  dài; chỉ rộng thì dài 0). Vật tư khác: loại · mã · đơn vị gốc · 0 · 0. Hàng khác chỉ loại · mã. */
export function vtKhoa(x: VtKhoaVao): string {
  if (!coDonViGoc(x.hang_loai)) return `${x.hang_loai}:${x.hang_id}`;
  if (x.hang_loai !== "giay") return `${x.hang_loai}:${x.hang_id}:${(x.don_vi_goc ?? "").trim().toLowerCase()}:0:0`;
  const [r, d] = chuanKho(x.kho_rong, x.kho_dai);
  return `giay:${x.hang_id}:${(x.don_vi_goc ?? "").trim().toLowerCase()}:${r}:${d}`;
}

/** Dòng đã chọn được mặt hàng nhưng Ô ĐƠN VỊ CỦA CHÍNH DÒNG ĐÓ đang trống. BE không nhận nổi một
 *  dòng như vậy khi tổ xin số dương (nó không biết quy ra đơn vị kho), và im lặng vứt ở FE thì tổ
 *  trưởng thấy toast xanh "Đã gửi" trong khi kho không bao giờ thấy món đó.
 *
 *  CỐ Ý chỉ xét `d.dvt`, KHÔNG gộp `d.dvtKeHoach`: hàm hỏi "ô đơn vị trên màn có chữ gì không". Gộp
 *  vào là cho tổ gõ một số dương vào ô đơn vị trống rồi để BE âm thầm đọc nó theo đơn vị KẾ HOẠCH —
 *  một lần lệch thang im lặng. Ca "dòng đã lưu `dvt=""`, kế hoạch nay có đơn vị" không rơi vào đây:
 *  `dungTuCongViec` mode `sua` đã gộp đơn vị kế hoạch vào `dvt` ngay lúc dựng dòng. */
function vtThieuDonVi(d: VtDongForm): boolean {
  return d.hang_id > 0 && !d.dvt;
}

/** Câu chặn gửi — `null` nghĩa là gửi được. Form Kho đã tự chặn phần lớn các ca này; đây là lớp gác
 *  cuối ngay trước khi gọi máy chủ, câu trả về hiện ở dải lỗi của form. */
function vtCanTro(
  dongs: VtDongForm[], lines: SxVatTuDeNghiDongIn[],
  mode: VtFormMode, loai: "lan_dau" | "bo_sung",
): string | null {
  // CHỈ chặn khi tổ đang THẬT SỰ xin món đó. Dòng kế hoạch cũng có thể trống đơn vị — chặn cả khi
  // nó đang để 0 là để một món hỏng khoá chết cả công đoạn, mà dòng kế hoạch lại không xoá được nên
  // tổ trưởng hết đường. Đường thoát thật: đưa món đó về 0, gửi phần còn lại.
  if (dongs.some((d) => vtThieuDonVi(d) && d.sl_yeu_cau > VT_EPS)) {
    return "Còn mặt hàng chưa có đơn vị tính nên chưa xin được — đưa dòng đó về 0 rồi gửi phần còn "
      + "lại, hoặc nhờ kỹ thuật kiểm lại đơn vị rồi xin lại.";
  }
  // Gõ số rồi quên chọn mặt hàng: cũng là một dòng sẽ bị loại trước khi rời trình duyệt.
  if (dongs.some((d) => d.hang_id <= 0 && d.sl_yeu_cau > VT_EPS)) {
    return "Còn dòng đã điền số nhưng chưa chọn mặt hàng.";
  }
  // Trùng mặt hàng: dùng ĐÚNG câu BE trả, để hai bên không nói hai kiểu về cùng một lỗi.
  const dem = new Map<string, number>();
  for (const d of dongs) {
    if (d.hang_id <= 0) continue;
    const k = vtKhoa(d);
    dem.set(k, (dem.get(k) ?? 0) + 1);
  }
  if ([...dem.values()].some((n) => n > 1)) {
    return "Một mặt hàng cùng khổ, cùng đơn vị gốc chỉ được khai một dòng — gộp số lượng lại.";
  }
  // Sửa được phép đưa HẾT về 0 (đó là đường tự huỷ yêu cầu, spec §5.3) nên không đòi số dương.
  // Tạo mới thì phải có cái gì đó để gửi: một lần đề nghị RỖNG vẫn thành `de_nghi_co_the_sua_id`
  // và khoá luôn đường "Yêu cầu bổ sung" cho tới khi sửa.
  if (mode !== "sua" && lines.length === 0) {
    if (mode === "nhap_lai") return "Chưa có dòng nào để nhập lại — thêm vật tư và điền số lượng.";
    return loai === "bo_sung"
      ? "Đề nghị bổ sung phải có ít nhất một mặt hàng với số lớn hơn 0."
      : "Chưa có dòng nào để gửi — thêm mặt hàng và điền số trước khi gửi.";
  }
  return null;
}

/** Dòng form → thân yêu cầu NHẬP LẠI: chỉ dòng dương. Giấy mang khổ (đơn vị gốc máy chủ suy từ `dvt`). */
export function vtPayloadNhapLai(dongs: VtDongForm[]): SxVatTuNhapLaiIn["lines"] {
  return vtPayloadLines(dongs, "bo_sung").map((l) => ({
    hang_loai: l.hang_loai, hang_id: l.hang_id, dvt: l.dvt, so_luong: l.sl_yeu_cau,
    ...(l.hang_loai === "giay" ? { kho_rong: l.kho_rong, kho_dai: l.kho_dai } : {}),
  }));
}

export function vtPayloadLines(dongs: VtDongForm[], loai: "lan_dau" | "bo_sung"): SxVatTuDeNghiDongIn[] {
  // Dòng KẾ HOẠCH giữ lại kể cả khi `dvt` rỗng (danh mục, snapshot của bước, hay routing của dòng
  // giấy — nguyên nhân nào cũng vậy): BE nhận `dvt=""` với số 0. Lọc thẳng `!!d.dvt` là vứt HẲN dòng
  // và bản đối chiếu ghi thiếu thứ tổ khai.
  // Dòng NGOÀI kế hoạch vẫn phải có đơn vị: nó có `tuKeHoach === false` nên vế `(!!d.dvt || d.tuKeHoach)`
  // rút về đúng `!!d.dvt`. Thêm một lớp nữa: `vtCanTro` chặn khi dòng như vậy đang xin số dương.
  const giu = dongs.filter((d) => d.hang_id > 0 && (!!d.dvt || d.tuKeHoach))
    // lần đầu: giữ MỌI dòng gốc kế hoạch kể cả 0 ("kế hoạch có, tổ không lấy"); dòng ngoài kế
    // hoạch mà = 0 thì bỏ. Bổ sung: chỉ dòng dương.
    .filter((d) => (loai === "lan_dau" ? d.tuKeHoach || d.sl_yeu_cau > VT_EPS : d.sl_yeu_cau > VT_EPS));
  return giu.map((d) => ({
    hang_loai: d.hang_loai, hang_id: d.hang_id,
    // Giấy mang khổ (ngắn × dài; chỉ rộng thì dài 0) — máy chủ chuẩn hoá lại và tự suy đơn vị gốc.
    ...(d.hang_loai === "giay"
      ? {
          kho_rong: chuanKho(d.kho_rong, d.kho_dai)[0],
          kho_dai: chuanKho(d.kho_rong, d.kho_dai)[1],
        }
      : {}),
    dvt: d.dvt,
    sl_yeu_cau: d.sl_yeu_cau,
  }));
}

/** Đơn vị mà lần đề nghị GẦN NHẤT đã dùng cho ĐÚNG mặt hàng này — `null` khi chưa lần nào xin nó.
 *
 *  Dùng làm đơn vị mặc định lúc tổ thêm tay mặt hàng ở form Kho mở từ công việc (`dvtGoiY`, mọi
 *  chế độ — lần đầu chưa có đề nghị nào nên hàm trả null). Trước đây dòng mới luôn nhận
 *  `don_vi_goc`, mà bảng đối chiếu lại gộp theo `(hang_loai, hang_id)` KHÔNG kèm đơn vị: một mặt
 *  hàng ôm hai `dvt` khác nhau thì `board.py` buộc phải hạ CẢ HÀNG về thang gốc (đúng — cộng 554
 *  tờ với 12 kg rồi in ra mới là nói dối). Hậu quả: tổ gõ lần 1 "554 tờ", xin bổ sung chút giấy
 *  mà form chỉ cho gõ kg, thế là cả dòng lật từ "554 to" sang "166,967 kg" rồi "178,967 kg" — tổ
 *  trưởng vốn nghĩ bằng tờ mở lại thấy đề nghị của chính mình ghi bằng kg. Bám theo đơn vị lần
 *  trước thì hàng vẫn một thang và không có gì phải lật.
 *
 *  Nhiều lần trước dùng nhiều đơn vị khác nhau ⇒ lấy của lần `lan_so` LỚN NHẤT (thói quen mới
 *  nhất của tổ). Dòng lưu với `dvt` rỗng KHÔNG tính là một câu trả lời — nó chỉ nghĩa là lúc đó
 *  routing/danh mục chưa nói được đơn vị, chép lại là chép cái trống. */
export function vtDvtLanTruoc(
  cacDeNghi: { lan_so: number; dongs: { hang_loai: string; hang_id: number; dvt: string }[] }[],
  hangLoai: string, hangId: number,
): string | null {
  let tot: { lanSo: number; dvt: string } | null = null;
  for (const lan of cacDeNghi) {
    for (const d of lan.dongs) {
      if (d.hang_loai !== hangLoai || d.hang_id !== hangId || !d.dvt) continue;
      if (tot == null || lan.lan_so > tot.lanSo) tot = { lanSo: lan.lan_so, dvt: d.dvt };
    }
  }
  return tot?.dvt ?? null;
}

/** Câu cam dưới dòng chưa có đơn vị tính — microcopy đã duyệt, giữ NGUYÊN chữ. Ở 0 thì dòng vẫn đi
 *  (BE nhận dòng kế hoạch `dvt=""` số 0); có số dương thì form Kho chặn và đòi chọn đơn vị. Không đóng
 *  đinh nguyên nhân vào "danh mục chưa khai": ô đơn vị còn trống được vì snapshot của bước chốt trước
 *  lúc kỹ thuật khai, hoặc vì routing chưa đủ để suy ra đơn vị đếm giấy. */
const VT_CANH_THIEU_DV = "Chưa có đơn vị tính. Để ở 0 thì vẫn gửi được, muốn xin thì nhờ kỹ thuật kiểm lại đơn vị.";

type VtNguonDong = VtKhoaVao & { ten: string; don_vi_goc: string; kho_rong: number; kho_dai: number };

/** Hệ số về đơn vị gốc suy từ cặp số máy chủ đã quy đổi — cảnh báo quá tồn của form Kho so đúng
 *  thang mà khỏi gọi thêm API. Số 0 thì không suy được ⇒ null, form coi như 1. */
function vtHeSo(sl: number, slGoc: number): number | null {
  return sl > VT_EPS && slGoc > 0 ? slGoc / sl : null;
}

function vtDongCv(
  n: VtNguonDong,
  p: Pick<DongTuCongViec, "dvt" | "he_so_ve_goc" | "sl_de_nghi" | "sl_nen" | "theo_ke_hoach" | "kho_chi_doc" | "dvt_nen">,
): DongTuCongViec {
  return {
    hang_loai: n.hang_loai as HangLoai, hang_id: n.hang_id, hang_ma: null, hang_ten: n.ten,
    don_vi_goc: n.don_vi_goc || null, kho_rong: n.kho_rong ?? 0, kho_dai: n.kho_dai ?? 0,
    // Cả form một lệnh (thẻ khoá bên phải): dòng không mang lệnh, máy chủ của tổ tự gắn lệnh của việc.
    lsx_id: null, bai_ghep_id: null, lsx_ma: null, bai_ghep_ma: null,
    don_gia: null, ghi_chu: null,
    ...p,
    canh: p.dvt ? null : VT_CANH_THIEU_DV,
  };
}

/** Dựng form Kho MỞ TỪ CÔNG VIỆC cho một nút của tab Vật tư (mockup ban-to-hop-thoai-B #vat-tu).
 *  Thuần, test được — `onGui` do nơi mở gắn vào.
 *  · moi: mọi dòng kế hoạch, số đầu = kế hoạch. Lần đầu phải lưu đủ kế hoạch nên dòng không xoá được.
 *  · sua: số CỦA RIÊNG lần đang sửa, KHÔNG phải số cộng dồn của `doi_chieu` — dùng nhầm là thổi phồng
 *    lần đang sửa bằng số của các lần trước. Sửa lần đầu thì bù dòng kế hoạch thêm sau lúc gửi (số 0).
 *  · bo_sung: các món đã xin, nền = số đã xin cộng dồn, số đầu 0 — xin THÊM trên nền đó. Xoá được, khổ
 *    chỉ đọc; dòng để 0 không đi.
 *  · nhap_lai: chiều nhập, sẵn các món kho ĐÃ XUẤT cho việc (nền = kho đã xuất, thang gốc như phiếu
 *    xuất), số đầu 0 — tổ chỉ gõ số trả về; dòng để 0 không đi, vẫn thêm tay được món khác (11/10/2026). */
export function dungTuCongViec(
  cv: SxWorkItem, cap: SxVatTuCap, mode: VtFormMode, lanSua: SxVatTuCapLan | null, toTen: string,
):Omit<TuCongViec, "onGui"> {
  const nhapLai = mode === "nhap_lai";
  const kh = new Map(cap.ke_hoach.map((k) => [vtKhoa(k), k]));
  const theoKh = (k: SxVatTuCapKeHoach, sl: number) => vtDongCv(k, {
    dvt: k.dvt, he_so_ve_goc: vtHeSo(k.sl, k.sl_goc), sl_de_nghi: sl, sl_nen: k.sl, theo_ke_hoach: true,
  });
  let dong: DongTuCongViec[] = [];
  if (mode === "moi") {
    dong = cap.ke_hoach.map((k) => theoKh(k, k.sl));
  } else if (mode === "sua") {
    dong = (lanSua?.dongs ?? []).map((d) => {
      const k = kh.get(vtKhoa(d));
      return vtDongCv(d, {
        // Vá GỐC: dòng đã lưu có thể mang `dvt=""` (routing mập mờ lúc gửi lần đầu) trong khi kế hoạch
        // nay đã có đơn vị. BE gộp `ln.dvt or k_row.dvt` nên form phải hiện ĐÚNG thứ BE sẽ dùng.
        dvt: d.dvt || (k?.dvt ?? ""),
        he_so_ve_goc: vtHeSo(d.sl_yeu_cau, d.sl_yeu_cau_goc) ?? vtHeSo(d.sl_ke_hoach, d.sl_ke_hoach_goc),
        sl_de_nghi: d.sl_yeu_cau, sl_nen: k ? d.sl_ke_hoach : null, theo_ke_hoach: !!k,
        dvt_nen: k?.dvt ?? d.dvt,
      });
    });
    if (lanSua?.loai === "lan_dau") {
      const co = new Set((lanSua.dongs ?? []).map(vtKhoa));
      for (const k of cap.ke_hoach) if (!co.has(vtKhoa(k))) dong.push(theoKh(k, 0));
    }
  } else if (mode === "bo_sung") {
    dong = cap.doi_chieu
      // Giấy nhận từ bước trước không phải thứ xin cấp; dòng thông tin phần trả khác khổ (thực dùng
      // null) và món chỉ có nhập lại thì không có gì để xin thêm.
      .filter((d) => !d.nhan_tu && d.sl_thuc_dung !== null && (d.sl_ke_hoach > VT_EPS || d.sl_yeu_cau > VT_EPS))
      .map((d) => vtDongCv(d, {
        dvt: d.dvt, he_so_ve_goc: vtHeSo(d.sl_yeu_cau, d.sl_yeu_cau_goc), sl_de_nghi: 0,
        sl_nen: d.sl_yeu_cau, theo_ke_hoach: false, kho_chi_doc: true,
      }));
  } else if (nhapLai) {
    // Kho đã xuất đọc thẳng phiếu xuất nên ở thang GỐC — dòng nhập lại cũng gõ theo thang đó.
    dong = cap.doi_chieu
      .filter((d) => !d.nhan_tu && d.sl_thuc_xuat > VT_EPS)
      .map((d) => {
        const dv = d.dvt_goc || d.don_vi_goc || d.dvt;
        return vtDongCv(d, {
          dvt: dv, he_so_ve_goc: 1, sl_de_nghi: 0, sl_nen: d.sl_thuc_xuat, dvt_nen: dv,
          theo_ke_hoach: false, kho_chi_doc: true,
        });
      });
  }
  const batDau = toDtLocal(cv.du_kien_bat_dau) || null;
  // Giờ cần: sửa = giờ CỦA CHÍNH lần đó (chỉnh lại cái tổ đã chọn, không quay về mốc gốc). Xin mới mà
  // giờ bắt đầu dự kiến đã qua thì lấy bây giờ — gửi giờ đã qua là kho thấy "Quá hạn" ngay lúc nhận.
  const bayGio = nowDtLocal();
  const canLuc = (mode === "sua" ? toDtLocal(lanSua?.can_luc)
    : nhapLai || !batDau || batDau < bayGio ? "" : batDau) || bayGio;
  const nguoi = lanSua?.created_by_ten ?? "";
  return {
    duongDan: [
      ["Bàn tổ", toTen].filter(Boolean).join(" "),
      cv.nguon_ma ? `${cv.ten_cong_doan} của ${cv.nguon_ma}` : cv.ten_cong_doan,
      mode === "sua" ? "Sửa yêu cầu" : "Tạo mới",
    ].join(" › "),
    tieuDe: nhapLai ? "Yêu cầu nhập kho"
      : mode === "sua" ? `Sửa yêu cầu xuất kho${lanSua?.stock_request_ma ? ` ${lanSua.stock_request_ma}` : ""}`
      : "Yêu cầu xuất kho",
    loai: nhapLai ? "NHAP" : "XUAT",
    cotNen: nhapLai ? (dong.length ? "Kho đã xuất" : null) : mode === "bo_sung" ? "Đã xin" : "Kế hoạch",
    nhanSoLuong: nhapLai ? "Số lượng nhập" : mode === "bo_sung" ? "Số xin thêm" : "Số lượng xin",
    nutGui: mode === "sua" ? "Lưu thay đổi" : "Gửi kho",
    lenh: {
      ma: cv.nguon_ma, ten: cv.nguon_ten, congDoan: cv.ten_cong_doan, to: toTen,
      lan: mode === "sua" && lanSua ? { so: lanSua.lan_so, nguoi, luc: toDtLocal(lanSua.created_at) } : null,
    },
    canLuc,
    lucBatDauViec: nhapLai ? null : batDau,
    goiY: mode === "bo_sung"
      ? "Đã xin đủ kế hoạch nên lần này là xin thêm, chỉ thêm đúng món đang thiếu."
      : nhapLai && dong.length
        ? "Điền số còn thừa trả về kho. Món nào không trả thì để 0."
      : !nhapLai && dong.some((d) => d.theo_ke_hoach)
        ? "Dòng theo kế hoạch không xoá được. Bấm Về 0 nghĩa là tổ không cần cấp món đó."
        : null,
    dong,
    ghiChu: "",
    // Sửa được phép đưa HẾT về 0 — đường tự huỷ yêu cầu (spec §5.3): máy chủ nhận `lines: []` và huỷ
    // yêu cầu kho đi kèm. Kể cả lần chỉ có món ngoài kế hoạch (thường là lần bổ sung).
    choPhepRong: mode === "sua",
  };
}

/** Dòng form Kho → dòng của tổ, để đi tiếp qua `vtPayloadLines` / `vtCanTro` như cũ. */
function vtDongTuDraft(l: DraftLine): VtDongForm {
  return {
    key: l.key, hang_loai: l.hang_loai ?? "", hang_id: l.hang_id ?? 0, ten: l.hang_ten ?? "",
    // Chưa rõ đơn vị gốc (ô đơn vị chưa báo lên) thì tạm lấy chính `dvt` để chống trùng: cùng đơn
    // vị chắc chắn cùng họ.
    don_vi_goc: l.don_vi_goc || l.dvt, kho_rong: l.kho_rong ?? 0, kho_dai: l.kho_dai ?? 0,
    dvt: l.dvt, dvtKeHoach: l.dvt_nen ?? l.dvt, sl_ke_hoach: l.sl_nen ?? 0,
    sl_yeu_cau: Math.max(0, Number(l.sl_de_nghi) || 0), tuKeHoach: !!l.theo_ke_hoach,
  };
}

// ============================ nguyên liệu dùng chung ========================
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="thsx-x-fld">
      <span className="thsx-x-fld__l">{label}</span>
      {children}
    </label>
  );
}

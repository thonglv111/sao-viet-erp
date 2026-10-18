// Ngăn CHI TIẾT công nợ một nhà cung cấp — kiểu 3 (docs/mockups/ke-toan-gon-3-phuong-an.html,
// 07/10/2026), vỏ `NganCongNo` chung hai màn công nợ.
//
// Đầu ngăn: "Công nợ phải trả > Nhà cung cấp" — tên + thẻ mã — "In sao kê" và "Hồ sơ nhà cung cấp" —
// ba tab. Cột thuộc tính bên phải: còn nợ tới hôm nay, quá hạn, hạn sớm nhất, hạn mức + cho nợ, người
// liên hệ, tài khoản nhận tiền. Ba tab:
// - "Còn nợ": một lưới mọi đợt, nhóm theo đơn mua (hoặc xếp theo hạn trả), tích để trả nhiều đợt. Mở từ
//   danh sách đang lọc quá hạn / mốc tuổi thì lọc sẵn (thẻ lọc + "Bỏ lọc"). Tích đợt ⇒ chân tối "Đã
//   chọn n đợt … — Bỏ chọn — Lập phiếu chi trả" mở ngăn chồng `LapPhieuChiGop` với ẢNH CHỤP các đợt
//   lúc bấm (ngăn dưới nạp lại / tải hỏng cũng không đổi form đang gõ) — MỘT phiếu chi cho cả lượt
//   (17/10/2026), bảng phân bổ từng đợt.
// - "Sao kê": số dư đầu kỳ, từng chứng từ với số dư chạy, số dư cuối kỳ; in được.
// - "Lịch sử": dòng thời gian mọi chứng từ với nhà cung cấp + các đợt đã trễ.
// Nút "Nhà cung cấp hoàn tiền" trên đầu ngăn (12/10/2026) mở ngăn chồng phiếu thu gắn thẳng NCC, số
// tiền điền sẵn bằng số NCC đang nợ lại mình.
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  api,
  type KyXem,
  type PayableItemRow,
  type PayablePaidRow,
  type PayablesDetail,
  type PaymentReceiptRow,
  type PaymentVoucherRow,
} from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import type { NavigateFn } from "../../../../components/AppShell";
import { useChiTietCongNo } from "../../shared/chiTietCongNo";
import { tien, vietSo } from "../../shared/dinhDang";
import { LichSuCongNo, type KhoanTre } from "../../shared/LichSuCongNo";
import { nhanLocNo, TheLocNo } from "../../shared/locNoNgan";
import { RayThuocTinh } from "../../shared/LuoiGon";
import { NganCongNo, oRayCongNo } from "../../shared/NganCongNo";
import { useTabNho } from "../../shared/NganPhieu";
import { TabSaoKe } from "../../shared/TabSaoKe";
import { NccHoanTienModal } from "../../phieu-thu/modals/NccHoanTienModal";
import { PAID_PAGE } from "../shared/constants";
import { tenKhoan } from "../shared/helpers";
import type { Bucket } from "../shared/types";
import { LapPhieuChiGop } from "../../phieu-chi/components/LapPhieuChiGop";
import { DotConNoBlock } from "./DotConNoBlock";

export type QuyenCongNoTra = {
  /** Lập phiếu chi (`phieu_chi.create`) — tích đợt và trả nhiều đợt. */
  lap: boolean;
  /** Lập phiếu thu (`phieu_thu.create`) — nút "Nhà cung cấp hoàn tiền". */
  thuHoan?: boolean;
  xemDonMua: boolean;
  xemNcc: boolean;
  xemPhieuChi: boolean;
};

const TAB = ["no", "sk", "ls"];

/** Đợt có thuộc bộ lọc không: null = mọi đợt (kể cả đợt đã trả xong nằm đó để dò cọc), "overdue" =
 *  đang trễ, còn lại là khoá mốc tuổi — chỉ đợt CÒN nợ. */
function khopLoc(row: PayableItemRow, loc: string | null): boolean {
  if (loc == null) return true;
  if (row.con_no <= 0) return false;
  if (loc === "overdue") return row.overdue_days > 0;
  if (loc === "chua_toi_han") return row.overdue_days <= 0;
  return row.aging_bucket === loc;
}

export function PayablesDrawer({
  supplierId,
  supplierName,
  ma,
  bucket,
  tuoi = null,
  ky,
  eventTick = 0,
  quyen,
  navigate,
  len,
  xuong,
  onClose,
  onChanged,
}: {
  supplierId: number;
  supplierName: string;
  /** Mã nhà cung cấp (từ dòng danh sách) — thẻ dưới tên. */
  ma?: string | null;
  bucket: Bucket;
  /** Mốc tuổi nợ đang lọc ở danh sách ⇒ tab Còn nợ lọc sẵn mốc đó. */
  tuoi?: { khoa: string; nhan: string } | null;
  /** Kỳ đang xem ở trang — kỳ mặc định của tab Sao kê. */
  ky: KyXem;
  /** Sự kiện đẩy (SSE): đổi số ⇒ ngăn nạp lại (lỗi 8). */
  eventTick?: number;
  quyen: QuyenCongNoTra;
  navigate: NavigateFn;
  len?: () => void;
  xuong?: () => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { token } = useAuth();
  // Tab nhớ theo màn; bấm thẳng số Quá hạn / Đã trả ngoài bảng thì mở đúng tab đó.
  const [tabNho, setTabNho] = useTabNho("cong-no-phai-tra", "no");
  const [tab, setTabTho] = useState(
    bucket === "paid" ? "sk" : bucket === "overdue" || tuoi ? "no" : TAB.includes(tabNho) ? tabNho : "no",
  );
  const setTab = (t: string) => {
    setTabNho(t);
    setTabTho(t);
  };
  const [loc, setLocTho] = useState<string | null>(bucket === "overdue" ? "overdue" : tuoi ? tuoi.khoa : null);
  const [chon, setChon] = useState<Set<number>>(new Set());
  const [moHang, setMoHang] = useState<string | null>(null);
  const [moTra, setMoTra] = useState<PayableItemRow[] | null>(null);
  const [daLap, setDaLap] = useState<PaymentVoucherRow | null>(null);
  const [moHoan, setMoHoan] = useState(false);
  const [daThuHoan, setDaThuHoan] = useState<PaymentReceiptRow | null>(null);
  const [dangIn, setDangIn] = useState(false);
  const [soLanLap, setSoLanLap] = useState(0);

  const chonDuoc = useCallback(
    (row: PayableItemRow) => quyen.lap && row.delivery_id != null && row.con_no > 0,
    [quyen.lap],
  );

  // Tải chi tiết + sự kiện đẩy (lỗi 8): khuôn chung `useChiTietCongNo`. `reload` cũng là đường gọi
  // lại sau khi lập phiếu: `onChanged` (báo trang) KHÔNG tự kéo lại chi tiết của chính ngăn đang mở.
  // Lần trả giờ nằm ở Sao kê / Lịch sử nên phần `paid` của câu trả lời không còn dùng ở đây.
  const { detail, loading, loi, reload } = useChiTietCongNo<PayablePaidRow, PayablesDetail>({
    token,
    khoa: String(supplierId),
    coTrang: PAID_PAGE,
    goi: (t, trang) =>
      api.accounting.payablesDetail(t, supplierId, false, { tu_ngay: ky.tu, den_ngay: ky.den }, trang),
    khoaDong: (p) => p.voucher_id,
    eventTick,
    chuLoi: "Không tải được chi tiết công nợ.",
    chuLoiThem: "Không tải thêm được lần trả.",
    onTai: (d) => {
      // Đợt đã trả xong / biến mất sau khi nạp lại thì bỏ khỏi lựa chọn.
      const conChon = new Set((Array.isArray(d.items) ? d.items : []).filter(chonDuoc).map((r) => r.delivery_id as number));
      setChon((cu) => {
        const giu = [...cu].filter((id) => conChon.has(id));
        return giu.length === cu.size ? cu : new Set(giu);
      });
    },
  });

  // Thông báo "Đã lập PC-…" tự tắt sau vài giây.
  useEffect(() => {
    if (!daLap) return;
    const t = window.setTimeout(() => setDaLap(null), 8000);
    return () => window.clearTimeout(t);
  }, [daLap]);
  useEffect(() => {
    if (!daThuHoan) return;
    const t = window.setTimeout(() => setDaThuHoan(null), 8000);
    return () => window.clearTimeout(t);
  }, [daThuHoan]);

  // Backend cũ hơn giao diện có thể thiếu `items`/`aging` — báo rõ, không sập, không coi là rỗng.
  const hopLe = detail != null && Array.isArray(detail.items) && Array.isArray(detail.aging);
  const items = useMemo(() => (hopLe ? detail!.items : []), [hopLe, detail]);
  // Số trên tab = số đợt CÒN nợ (lỗi 7) — đợt đã trả xong chỉ nằm đó để dò cọc, không đếm.
  const soConNo = items.filter((x) => x.con_no > 0).length;
  const khoanNo = useMemo(() => items.filter((x) => khopLoc(x, loc)), [items, loc]);
  const dotDaChon = khoanNo.filter((row) => row.delivery_id != null && chon.has(row.delivery_id));
  const tongDaChon = dotDaChon.reduce((s, row) => s + row.con_no, 0);
  const tre = useMemo<KhoanTre[]>(
    () =>
      items
        .filter((x) => x.con_no > 0 && x.overdue_days > 0 && x.due_date)
        .map((x) => ({
          khoa: `${x.purchase_request_id}:${x.delivery_id ?? "don"}`,
          ten: x.seq_no != null ? `${x.code} đợt ${x.seq_no}` : `${x.code} ${tenKhoan(x).toLowerCase()}`,
          han: x.due_date as string,
          conNo: x.con_no,
          soNgayTre: x.overdue_days,
        })),
    [items],
  );

  // Đổi danh sách đang hiện thì xoá lựa chọn: giữ tích cũ dễ khiến người dùng tưởng đợt đang ẩn vẫn
  // được tính vào lượt trả.
  const setLoc = (k: string | null) => {
    setLocTho(k);
    setChon(new Set());
  };

  const moDon = quyen.xemDonMua
    ? (code: string) => {
        onClose();
        navigate("ke-toan-don-mua-hang", { focusRequestCode: code });
      }
    : undefined;
  const moPhieu = quyen.xemPhieuChi
    ? (code: string) => {
        onClose();
        navigate("ke-toan-phieu-chi", { focusVoucherQuery: code });
      }
    : undefined;

  const ten = detail?.supplier_name ?? supplierName;
  const lan = eventTick + soLanLap;
  const nhan = hopLe ? nhanLocNo(loc, detail!.aging, tuoi?.nhan) : null;
  const coChan = tab === "no" && dotDaChon.length > 0;
  const moHoSo = quyen.xemNcc
    ? () => {
        onClose();
        navigate("nha-cung-cap", { openSupplierId: supplierId });
      }
    : undefined;

  return (
    <>
      <NganCongNo
        nhanMan="Công nợ phải trả"
        nhanDoiTac="Nhà cung cấp"
        tieuDe={ten}
        ma={ma}
        coSo={hopLe}
        nutHoSo={moHoSo ? { nhan: "Hồ sơ nhà cung cấp", onMo: moHoSo } : undefined}
        nutTraLai={quyen.thuHoan ? { nhan: "Nhà cung cấp hoàn tiền", onMo: () => setMoHoan(true) } : undefined}
        onInSaoKe={() => {
          setTab("sk");
          setDangIn(true);
        }}
        loi={loi}
        loading={loading}
        thieu={detail != null && !hopLe}
        chuThieu="Dữ liệu trả về thiếu phần công nợ theo đợt giao: máy chủ đang chạy bản cũ hơn giao diện. Khởi động lại máy chủ rồi tải lại trang."
        onTaiLai={reload}
        cot={
          hopLe ? (
            <RayThuocTinh o={[
              ...oRayCongNo({
                tong: detail!,
                hanCacKhoan: items.filter((x) => x.con_no > 0).map((x) => x.due_date),
                choNo: detail!.credit_days,
                sauNgay: "sau mỗi đợt giao",
                chuCanh: "Chỉ là cảnh báo, vẫn đặt mua được.",
                onDatHoSo: moHoSo,
              }),
              { nhan: "Tài khoản nhận tiền", giaTri: detail!.tk_nhan || null },
            ]} />
          ) : undefined
        }
        tabs={
          hopLe
            ? [
                { id: "no", nhan: "Còn nợ", dem: soConNo },
                { id: "sk", nhan: "Sao kê" },
                { id: "ls", nhan: "Lịch sử" },
              ]
            : undefined
        }
        tab={tab}
        onTab={setTab}
        len={len}
        xuong={xuong}
        onDong={onClose}
        chanToi={coChan}
        chan={
          coChan ? (
            <>
              <span className="kt-ngan__xt">
                {`Đã chọn ${vietSo(dotDaChon.length)} đợt`}
                <b>{tien(tongDaChon)}</b>
              </span>
              <button type="button" className="kt-btn kt-btn--tron" onClick={() => setChon(new Set())}>
                Bỏ chọn
              </button>
              <button type="button" className="kt-btn kt-btn--chinh" onClick={() => setMoTra(dotDaChon)}>
                Lập phiếu chi trả
              </button>
            </>
          ) : undefined
        }
      >
        {hopLe && tab === "no" && (
          <>
            {nhan && (
              <div className="kt-hang-loc kt-ncn-loc">
                <TheLocNo nhan={nhan} so={khoanNo.length} onBo={() => setLoc(null)} />
              </div>
            )}
            <DotConNoBlock detail={detail!} khoanNo={khoanNo} dangLoc={loc != null} coChon={quyen.lap}
              chonDuoc={chonDuoc} chon={chon} onChon={setChon} moHang={moHang} onMoHang={setMoHang} onMoDon={moDon} />
          </>
        )}

        {hopLe && tab === "sk" && (
          <TabSaoKe ben="payables" id={supplierId} ten={ten} ma={ma} kyTrang={ky} lan={lan}
            dangIn={dangIn} onDongIn={() => setDangIn(false)} onMoPhieu={moPhieu} onMoDonMua={moDon} />
        )}

        {hopLe && tab === "ls" && (
          <LichSuCongNo ben="payables" id={supplierId} homNay={detail!.as_of} tre={tre} chuTre="chưa trả đủ" lan={lan}
            onMoPhieu={moPhieu} />
        )}

        {daLap && (
          <div className="kt-bao" role="status">
            <span>{`Đã lập ${daLap.code}`}</span>
            <button type="button"
              onClick={() => {
                // Phiếu vừa lập đứng đầu dòng thời gian của tab Lịch sử.
                setTab("ls");
                setDaLap(null);
              }}>
              Xem phiếu
            </button>
          </div>
        )}
        {daThuHoan && (
          <div className="kt-bao" role="status">
            <span>{`Đã lập ${daThuHoan.code}`}</span>
            <button type="button"
              onClick={() => {
                setTab("ls");
                setDaThuHoan(null);
              }}>
              Xem phiếu
            </button>
          </div>
        )}
      </NganCongNo>

      {moHoan && (
        <NccHoanTienModal
          nccId={supplierId}
          nccTen={ten}
          onClose={() => setMoHoan(false)}
          onMoTaiKhoan={() => navigate("ke-toan-tai-khoan-ngan-hang")}
          onSaved={(pt) => {
            setMoHoan(false);
            setDaThuHoan(pt);
            setSoLanLap((n) => n + 1);
            reload();
            onChanged();
          }}
        />
      )}

      {moTra && (
        <LapPhieuChiGop
          supplierId={detail?.supplier_id ?? null}
          supplierName={ten}
          conNoNcc={detail?.total_due ?? null}
          hanMuc={detail?.credit_limit ?? 0}
          khoan={moTra.map((it) => ({
            purchase_request_id: it.purchase_request_id,
            ma_don: it.code,
            delivery_id: it.delivery_id,
            nhan: tenKhoan(it),
            han: it.due_date,
            con: it.con_no,
          }))}
          onClose={() => setMoTra(null)}
          onMoTaiKhoan={() => navigate("ke-toan-tai-khoan-ngan-hang")}
          onSaved={(kq) => {
            setMoTra(null);
            setChon(new Set());
            setDaLap(kq);
            setSoLanLap((n) => n + 1);
            reload();
            onChanged();
          }}
        />
      )}
    </>
  );
}

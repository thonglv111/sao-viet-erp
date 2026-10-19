// Ngăn CHI TIẾT công nợ một khách hàng — kiểu 3 (docs/mockups/ke-toan-gon-3-phuong-an.html,
// 07/10/2026), vỏ `NganCongNo` chung hai màn công nợ.
//
// Đầu ngăn: "Công nợ phải thu > Khách hàng" — tên + thẻ mã — "In sao kê" và "Hồ sơ khách hàng" — ba
// tab. Cột thuộc tính bên phải: còn nợ tới hôm nay, quá hạn, hạn sớm nhất, hạn mức + cho nợ, người liên
// hệ, phụ trách. Ba tab:
// - "Còn nợ": một lưới hoá đơn còn nợ nhóm theo đơn bán (hoặc xếp theo hạn thu); mở từ danh sách đang
//   lọc mốc tuổi / bấm số Quá hạn ngoài bảng thì lọc sẵn (thẻ lọc + "Bỏ lọc"). "Thu" từng hoá đơn mở
//   NGĂN CHỒNG thu tiền — chưa tick nhiều hoá đơn vì máy chủ chưa có thu nhiều hoá đơn một lượt.
// - "Sao kê": số dư đầu kỳ, từng chứng từ với số dư chạy, số dư cuối kỳ; in được.
// - "Lịch sử": dòng thời gian mọi chứng từ với khách + các hoá đơn đã trễ.
// Nút "Trả lại tiền" trên đầu ngăn (12/10/2026) mở ngăn chồng phiếu chi trả lại tiền cho khách, số tiền
// điền sẵn bằng số khách đang dư.
//
// Ngăn chồng tự giữ nháp: Esc / Đóng của nó hỏi trước khi bỏ; phím chỉ thuộc lớp trên cùng nên ↑ ↓ và
// đổi tab của ngăn khách không chạm được nháp đang gõ.
import { useEffect, useMemo, useState } from "react";

import {
  api,
  type KyXem,
  type PaymentReceiptRow,
  type PaymentVoucherRow,
  type ReceivableItemRow,
  type ReceivableReceiptRow,
  type ReceivablesDetail,
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
import { TraLaiTienKhachModal, type DonTraCoc } from "../../phieu-chi/modals/TraLaiTienKhachModal";
import { PAID_PAGE } from "../shared/constants";
import type { Bucket, TuoiDangLoc } from "../shared/types";
import { TienDangDeBlock } from "./TienDangDeBlock";
import { HoaDonConNoBlock } from "./HoaDonConNoBlock";
import { ThuTienHoaDon } from "./ThuTienHoaDon";
import { LapPhieuThuGop } from "../../phieu-thu/components/LapPhieuThuGop";

export type QuyenCongNoThu = {
  /** Lập phiếu thu (`phieu_thu.create`) — nút "Thu". */
  thu: boolean;
  /** Lập phiếu chi (`phieu_chi.create`) — nút "Trả lại tiền". */
  traLai?: boolean;
  xemPhieuThu: boolean;
  xemKhach: boolean;
  xemDonBan: boolean;
};

const TAB = ["no", "sk", "ls"];

/** Hoá đơn có thuộc bộ lọc không: null = mọi hoá đơn, "overdue" = đang trễ, còn lại là khoá mốc
 *  tuổi. Máy chủ để `aging_bucket` TRỐNG khi chưa trễ, nên mốc "Chưa tới hạn" là "không trễ ngày
 *  nào" chứ không so khoá. */
function khopLoc(row: ReceivableItemRow, loc: string | null): boolean {
  if (loc == null) return true;
  if (loc === "overdue") return row.overdue_days > 0;
  if (loc === "chua_toi_han") return row.overdue_days <= 0;
  return row.aging_bucket === loc;
}

export function ReceivablesDrawer({
  customerId,
  customerName,
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
  customerId: number;
  customerName: string;
  /** Mã khách (từ dòng danh sách) — thẻ dưới tên. */
  ma?: string | null;
  bucket: Bucket;
  /** Mốc tuổi nợ đang lọc ở danh sách ⇒ tab Còn nợ lọc sẵn mốc đó. */
  tuoi?: TuoiDangLoc | null;
  /** Kỳ đang xem ở trang — kỳ mặc định của tab Sao kê. */
  ky: KyXem;
  /** Sự kiện đẩy (SSE): đổi số ⇒ ngăn nạp lại. */
  eventTick?: number;
  quyen: QuyenCongNoThu;
  navigate: NavigateFn;
  len?: () => void;
  xuong?: () => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { token } = useAuth();
  const [tabNho, setTabNho] = useTabNho("cong-no-phai-thu", "no");
  const [tab, setTabTho] = useState(
    bucket === "paid" ? "sk" : bucket === "overdue" || tuoi ? "no" : TAB.includes(tabNho) ? tabNho : "no",
  );
  const [loc, setLoc] = useState<string | null>(bucket === "overdue" ? "overdue" : tuoi ? tuoi.khoa : null);
  const [dangThu, setDangThu] = useState<ReceivableItemRow | null>(null);
  // Thu nhiều hoá đơn một phiếu: hoá đơn đã tick + ẢNH CHỤP lúc bấm "Lập một phiếu thu".
  const [chon, setChon] = useState<Set<number>>(new Set());
  const [moGop, setMoGop] = useState<ReceivableItemRow[] | null>(null);
  const [daLap, setDaLap] = useState<PaymentReceiptRow | PaymentVoucherRow | null>(null);
  // Trả lại tiền: `don` vắng = trả chung; có = trả lại cọc của đúng đơn đã huỷ đó.
  const [moTraLai, setMoTraLai] = useState<{ don: DonTraCoc | null } | null>(null);
  const [dangIn, setDangIn] = useState(false);
  const [soLanLap, setSoLanLap] = useState(0);

  // Ngăn chỉ còn cần phần NỢ của chi tiết (lần thu nằm ở Sao kê / Lịch sử); vẫn đi qua khuôn chung
  // để có nạp lại theo sự kiện đẩy và bỏ câu trả lời cũ về muộn.
  const { detail, setDetail, loading, loi, reload } = useChiTietCongNo<ReceivableReceiptRow, ReceivablesDetail>({
    token,
    khoa: String(customerId),
    coTrang: PAID_PAGE,
    goi: (t, trang) =>
      api.accounting.receivablesDetail(t, customerId, false, { tu_ngay: ky.tu, den_ngay: ky.den }, trang),
    khoaDong: (p) => p.receipt_id,
    eventTick,
    chuLoi: "Không tải được chi tiết công nợ.",
    chuLoiThem: "Không tải thêm được lần thu.",
    onTai: (d) => {
      // Hoá đơn đã thu đủ / biến mất sau khi nạp lại thì bỏ khỏi lựa chọn.
      const con = new Set((Array.isArray(d.items) ? d.items : []).filter((x) => x.remaining_amount > 0).map((x) => x.invoice_id));
      setChon((cu) => {
        const giu = [...cu].filter((id) => con.has(id));
        return giu.length === cu.size ? cu : new Set(giu);
      });
    },
  });

  // Thông báo "Đã lập PT-…" tự tắt sau vài giây.
  useEffect(() => {
    if (!daLap) return;
    const t = window.setTimeout(() => setDaLap(null), 8000);
    return () => window.clearTimeout(t);
  }, [daLap]);

  // Backend cũ hơn giao diện có thể thiếu `items`/`aging` — báo rõ, không sập, không coi là rỗng.
  const hopLe = detail != null && Array.isArray(detail.items) && Array.isArray(detail.aging);
  const conNo = useMemo(() => (hopLe ? detail!.items.filter((x) => x.remaining_amount > 0) : []), [hopLe, detail]);
  const dangHien = useMemo(() => conNo.filter((x) => khopLoc(x, loc)), [conNo, loc]);
  const hdDaChon = dangHien.filter((x) => chon.has(x.invoice_id));
  const tongDaChon = hdDaChon.reduce((s, x) => s + x.remaining_amount, 0);
  // Chân tối chỉ ở tab Còn nợ, khi đã tick và không có ngăn chồng nào đang mở.
  const coChan = tab === "no" && hdDaChon.length > 0 && !moGop;
  const tre = useMemo<KhoanTre[]>(
    () =>
      conNo
        .filter((x) => x.overdue_days > 0 && x.due_date)
        .map((x) => ({
          khoa: String(x.invoice_id),
          ten: `Hoá đơn số ${x.invoice_number}`,
          han: x.due_date as string,
          conNo: x.remaining_amount,
          soNgayTre: x.overdue_days,
        })),
    [conNo],
  );

  const setTab = (t: string) => {
    if (t === tab) return;
    setTabNho(t);
    setTabTho(t);
  };

  /** Lập xong: dòng hoá đơn đổi NGAY (không đợi nạp lại), rồi mới nạp lại cho khớp máy chủ. */
  function daLapPhieu(row: ReceivableItemRow, receipt: PaymentReceiptRow) {
    const tienThu = receipt.amount_vnd ?? receipt.amount;
    setDetail((cu) =>
      cu
        ? {
            ...cu,
            total_due: Math.max(0, cu.total_due - tienThu),
            overdue_amount: row.overdue_days > 0 ? Math.max(0, cu.overdue_amount - tienThu) : cu.overdue_amount,
            items: cu.items.map((x) =>
              x.invoice_id === row.invoice_id
                ? {
                    ...x,
                    direct_received_amount: x.direct_received_amount + tienThu,
                    received_amount: x.received_amount + tienThu,
                    remaining_amount: Math.max(0, x.remaining_amount - tienThu),
                  }
                : x,
            ),
          }
        : cu,
    );
    setDangThu(null);
    setDaLap(receipt);
    setSoLanLap((n) => n + 1);
    reload();
    onChanged();
  }

  const moDon = quyen.xemDonBan
    ? (orderId: number) => {
        onClose();
        // Từ công nợ thì cái cần xem là hoá đơn của đơn ⇒ mở thẳng chặng Hóa đơn.
        navigate("don-hang-ban", { openOrderId: orderId, openOrderChang: "hoadon" });
      }
    : undefined;
  const moPhieu = quyen.xemPhieuThu
    ? (code: string) => {
        onClose();
        navigate("ke-toan-phieu-thu", { focusReceiptQuery: code });
      }
    : undefined;

  const ten = detail?.customer_name || customerName;
  const lan = eventTick + soLanLap;
  const nhan = hopLe ? nhanLocNo(loc, detail!.aging, tuoi?.nhan) : null;
  const moHoSo = quyen.xemKhach
    ? () => {
        onClose();
        navigate("khach-hang", { openCustomerId: customerId });
      }
    : undefined;

  return (
    <>
      <NganCongNo
        nhanMan="Công nợ phải thu"
        nhanDoiTac="Khách hàng"
        tieuDe={ten}
        ma={ma}
        coSo={hopLe}
        nutHoSo={moHoSo ? { nhan: "Hồ sơ khách hàng", onMo: moHoSo } : undefined}
        nutTraLai={quyen.traLai ? { nhan: "Trả lại tiền", onMo: () => setMoTraLai({ don: null }) } : undefined}
        onInSaoKe={() => {
          setTab("sk");
          setDangIn(true);
        }}
        loi={loi}
        loading={loading}
        thieu={detail != null && !hopLe}
        chuThieu="Dữ liệu trả về thiếu phần hoá đơn hoặc tuổi nợ: máy chủ đang chạy bản cũ hơn giao diện. Khởi động lại máy chủ rồi tải lại trang."
        onTaiLai={reload}
        cot={
          hopLe ? (
            <RayThuocTinh o={[
              ...oRayCongNo({
                tong: detail!,
                hanCacKhoan: conNo.map((x) => x.due_date),
                choNo: detail!.payment_term_days,
                sauNgay: "sau mỗi hoá đơn",
                chuCanh: "Chỉ là cảnh báo, vẫn bán và thu bình thường.",
                onDatHoSo: moHoSo,
              }),
              { nhan: "Phụ trách", giaTri: detail!.phu_trach || null },
            ]} />
          ) : undefined
        }
        tabs={
          hopLe
            ? [
                { id: "no", nhan: "Còn nợ", dem: conNo.length },
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
                {`Đã chọn ${vietSo(hdDaChon.length)} hoá đơn`}
                <b>{tien(tongDaChon)}</b>
              </span>
              <button type="button" className="kt-btn kt-btn--tron" onClick={() => setChon(new Set())}>
                Bỏ chọn
              </button>
              <button type="button" className="kt-btn kt-btn--chinh" onClick={() => setMoGop(hdDaChon)}>
                Lập một phiếu thu
              </button>
            </>
          ) : undefined
        }
      >
        {hopLe && tab === "no" && (
          <>
            {nhan && (
              <div className="kt-hang-loc kt-ncn-loc">
                <TheLocNo nhan={nhan} so={dangHien.length} onBo={() => {
                  setLoc(null);
                  setChon(new Set());
                }} />
              </div>
            )}
            {(detail!.tien_dang_de?.length ?? 0) > 0 && (
              <TienDangDeBlock ds={detail!.tien_dang_de!} onMoDon={moDon}
                onTraLai={quyen.traLai
                  ? (d) => setMoTraLai({ don: { id: d.order_id, ma: d.order_code, daNhan: d.da_nhan, conLai: d.con_lai, daTraLai: d.da_tra_lai ?? 0 } })
                  : undefined} />
            )}
            <HoaDonConNoBlock items={dangHien} homNay={detail!.as_of} khachChuaDatHan={detail!.payment_term_days == null}
              dangLoc={loc != null} coThu={quyen.thu} onThu={setDangThu} onMoDon={moDon}
              chon={chon} onChon={quyen.thu ? setChon : undefined} />
          </>
        )}

        {hopLe && tab === "sk" && (
          <TabSaoKe ben="receivables" id={customerId} ten={ten} ma={ma} kyTrang={ky} lan={lan}
            dangIn={dangIn} onDongIn={() => setDangIn(false)} onMoPhieu={moPhieu} onMoDon={moDon} />
        )}

        {hopLe && tab === "ls" && (
          <LichSuCongNo ben="receivables" id={customerId} homNay={detail!.as_of} tre={tre} chuTre="chưa thu đủ" lan={lan}
            onMoPhieu={moPhieu} />
        )}

        {daLap && (
          <div className="kt-bao" role="status">
            <span>{`Đã lập ${daLap.code}`}</span>
            {"voucher_type" in daLap ? (
              <button type="button"
                onClick={() => {
                  // Phiếu chi trả lại tiền đứng đầu dòng thời gian của tab Lịch sử.
                  setTab("ls");
                  setDaLap(null);
                }}>
                Xem phiếu
              </button>
            ) : moPhieu && (
              <button type="button" onClick={() => moPhieu(daLap.code)}>
                Xem phiếu
              </button>
            )}
          </div>
        )}
      </NganCongNo>

      {dangThu && (
        <ThuTienHoaDon
          key={dangThu.invoice_id}
          item={dangThu}
          customerId={customerId}
          customerName={ten}
          onDong={() => setDangThu(null)}
          onDaLap={(r) => daLapPhieu(dangThu, r)}
          onMoDon={moDon}
          onMoPhieu={moPhieu}
          onMoTaiKhoan={() => {
            onClose();
            navigate("ke-toan-tai-khoan-ngan-hang");
          }}
        />
      )}

      {moGop && (
        <LapPhieuThuGop
          customerId={customerId}
          customerName={ten}
          conNoKhach={detail?.total_due ?? null}
          khoan={moGop.map((x) => ({
            sales_invoice_id: x.invoice_id,
            order_id: x.order_id,
            ma_don: x.order_code,
            nhan: `HĐ ${x.invoice_number}`,
            han: x.due_date,
            con: x.remaining_amount,
            ngay_hd: x.invoice_date,
          }))}
          onClose={() => setMoGop(null)}
          onMoTaiKhoan={() => {
            onClose();
            navigate("ke-toan-tai-khoan-ngan-hang");
          }}
          onSaved={(r) => {
            setMoGop(null);
            setChon(new Set());
            setDaLap(r);
            setSoLanLap((n) => n + 1);
            reload();
            onChanged();
          }}
        />
      )}

      {moTraLai && (
        <TraLaiTienKhachModal
          khachId={customerId}
          khachTen={ten}
          don={moTraLai.don}
          duongDan={moTraLai.don ? <>Công nợ phải thu &gt; {ten} &gt; {moTraLai.don.ma}</> : undefined}
          onClose={() => setMoTraLai(null)}
          onMoTaiKhoan={() => {
            onClose();
            navigate("ke-toan-tai-khoan-ngan-hang");
          }}
          onDone={(pc) => {
            setMoTraLai(null);
            setDaLap(pc);
            setSoLanLap((n) => n + 1);
            reload();
            onChanged();
          }}
        />
      )}
    </>
  );
}

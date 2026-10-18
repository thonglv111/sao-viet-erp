/** Màn PHIẾU THU (đặc tả PT-1 … PT-4, A.16 – A.18) — khuôn lưới danh sách chung `lds-*` (08/10/2026),
 *  đối xứng màn Phiếu chi.
 *
 *  Khuôn trang: đầu trang (tiêu đề + nút "Lập phiếu thu") → thẻ lọc (hàng lọc nhanh trạng thái có số;
 *  ô tìm, thanh lọc chung `ThanhLoc`: kỳ theo Ngày tạo / Ngày thu + điều kiện; nút Cột) → lưới kiểu
 *  bảng tính + dòng Cộng + chân phân trang. Bấm dòng mở ngăn chi tiết kiểu 3 bên phải.
 *  Mọi lọc chạy ở MÁY CHỦ. Số trên hàng lọc nhanh (`the_loc`) tính theo kỳ + bộ lọc, KHÔNG theo mục
 *  đang chọn. Mục "Chờ thu" chỉ hiện khi còn phiếu CŨ chờ thu (phiếu mới lập là đã thu).
 *
 *  Mục "Đơn hàng chờ thu" (17/10/2026) thay cả bảng bằng hàng việc: cọc đơn đã chốt chưa đủ + hoá đơn
 *  khách chưa trả hết, mỗi dòng lập phiếu thu ngay tại đây (cùng form với Đơn hàng bán / Công nợ phải
 *  thu). Nút đầu trang lập khoản thu khác.
 */
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError, api, type HoaDonChoThu, type PaymentReceiptRow, type PaymentVoucherRow, type ReceivableItemRow,
} from "../../../api/client";
import { useAuth } from "../../../auth/useAuth";
import { useCan } from "../../../auth/permissions";
import type { NavigateFn } from "../../../components/AppShell";
import { Button } from "../../../components/Button";
import {
  ChonCot, LocNhanhTrangThai, OTim, useCauHinhLuoi, type MucLocNhanh,
} from "../../../components/LuoiDs";
import { GoiYPhim } from "../shared/BangPhieu";
import { soPhieuCong } from "../shared/PhieuGon";
import { useTrangPhieu, type CauHinhTrangPhieu } from "../shared/trangPhieu";
import { ThuTienHoaDon } from "../cong-no-phai-thu/components/ThuTienHoaDon";
import { COT_CHO_THU, HangChoThuDon, gopDongChoThu, type DongChoThu } from "./components/HangChoThuDon";
import { LapPhieuThuGop, type KhoanThuGop } from "./components/LapPhieuThuGop";
import { ReceiptsDrawer } from "./components/ReceiptsDrawer";
import { COT_PHIEU_THU, ReceiptsTable } from "./components/ReceiptsTable";
import { DepositReceiptDialog } from "./modals/DepositReceiptDialog";
import { OtherReceiptDialog } from "./modals/OtherReceiptDialog";
import { PaymentReceiptDialog } from "./PaymentReceiptDialog";
import { PAGE_SIZE } from "./shared/constants";
import {
  CAU_HINH_LOC_PT,
  LOC_TRONG,
  MOC_PT,
  dangLoc,
  locLenUrl,
  locTuUrl,
  thamSoLoc,
  thamSoTai,
  type LocPT,
  type TheLocPT,
} from "./shared/loc";
import { dieuKienPhieu, dkTrangThaiPhieu } from "../shared/locPhieu";
import { useMucThuChi } from "../shared/OChonMuc";
import { ThanhLoc } from "../../thanh-loc/ThanhLoc";
import "../ke-toan.css";

/** Mã màn — khoá nhớ kỳ và dấu `man` trên URL (đặc tả A.18). */
const MAN = "ke-toan-phieu-thu";

export function PaymentReceiptsPage({
  navigate,
  eventTick = 0,
  focusQuery = null,
}: {
  navigate: NavigateFn;
  eventTick?: number;
  /** Liên thông từ Phiếu chi / Đơn hàng bán / Công nợ phải thu: điền sẵn ô tìm (mã phiếu). */
  focusQuery?: string | null;
}) {
  const { token } = useAuth();
  const can = useCan();
  // Khoá RIÊNG của màn Phiếu thu. `create` = LẬP/SỬA phiếu + gán chứng từ.
  const coLap = can("phieu_thu", "create");
  const coXacNhan = can("phieu_thu", "manage_status");
  const coHuy = can("phieu_thu", "cancel");
  const coIn = can("phieu_thu", "export");
  const coXemTaiKhoan = can("tk_ngan_hang", "read");
  // Link sang màn khác — theo ô Xem của CHÍNH màn đó, không mượn khoá.
  const coXemCongNo = can("cong_no_phai_thu", "read");
  const coXemDonBan = can("don_hang_ban", "read");
  const coXemPhieuChi = can("phieu_chi", "read");

  const [loiMo, setLoiMo] = useState<string | null>(null);
  const [lapKhac, setLapKhac] = useState(false);
  const [sua, setSua] = useState<{ voucher: PaymentVoucherRow; receipt: PaymentReceiptRow } | null>(null);
  const [dh, setDh] = useState<DongChoThu[] | null>(null);
  const [dhLoi, setDhLoi] = useState<string | null>(null);
  const [lapDh, setLapDh] = useState<DongChoThu | null>(null);
  // Phiếu thu gộp: các khoản đã tick cùng khách. `lanGop` đổi sau khi lập để hàng chờ bỏ hết dấu tick.
  const [lapGop, setLapGop] = useState<{ khach: { id: number; ten: string }; khoan: KhoanThuGop[] } | null>(null);
  const [lanGop, setLanGop] = useState(0);

  const taiDh = useCallback(() => {
    if (!token) return;
    api.accounting
      .donHangChoThu(token)
      .then((r) => {
        setDh(gopDongChoThu(r.coc, r.hoa_don));
        setDhLoi(null);
      })
      .catch((e: unknown) => setDhLoi(e instanceof ApiError ? e.message : "Không tải được danh sách đơn hàng chờ thu."));
  }, [token]);
  useEffect(() => {
    taiDh();
  }, [taiDh]);

  // Nối dây trang sổ (kỳ, thẻ, lọc, URL, tải + cùng kỳ, SSE, liên thông, ngăn): khuôn chung. Ngăn tự
  // nạp bản mới nhất của phiếu đang mở (route đọc MỘT phiếu thu).
  const cauHinh: CauHinhTrangPhieu<PaymentReceiptRow, TheLocPT, LocPT> = {
    man: MAN,
    moc: MOC_PT,
    locTuUrl,
    locLenUrl,
    locTrong: LOC_TRONG,
    thamSoLoc,
    thamSoTai,
    goiDanhSach: (t, p) => api.accounting.receipts(t, p),
    theKhongBang: (t) => t === "dh",
    onSuKien: taiDh,
    chuLoi: "Không tải được danh sách phiếu thu.",
    coTrang: PAGE_SIZE,
    coXemTaiKhoan,
    mucDichTaiKhoan: "receive",
  };
  const sp = useTrangPhieu(cauHinh, token, eventTick, focusQuery);
  const { the, setThe, loc, rows, mo, setMo, load, soThe } = sp;

  // Tab "Chờ thu" chỉ có khi còn phiếu cũ chờ thu: mở từ link `the=cho` lúc đã hết thì về Tất cả.
  useEffect(() => {
    if (the === "cho" && soThe && soThe.cho === 0) setThe("tat_ca");
  }, [the, soThe, setThe]);

  // Lỗi 11: "Thu hoá đơn" mở Công nợ phải thu, ngăn của đúng khách — mã khách nằm ở hoá đơn bán.
  const moCongNoCuaPhieu = useCallback(
    async (row: PaymentReceiptRow) => {
      let khach = { id: null as number | null, name: row.customer_name || row.payer_name };
      if (token && row.order_id != null && row.sales_invoice_id != null) {
        try {
          const r = await api.accounting.salesInvoices(token, row.order_id);
          const hd = r.items.find((h) => h.id === row.sales_invoice_id);
          if (hd) khach = { id: hd.customer_id, name: hd.customer_name };
        } catch {
          // Không đọc được hoá đơn: vẫn mở Công nợ phải thu, tìm theo tên khách.
        }
      }
      navigate("ke-toan-cong-no-phai-thu", { focusReceivableCustomer: khach });
    },
    [token, navigate],
  );

  const moNguon = useCallback(
    (row: PaymentReceiptRow): (() => void) | undefined => {
      if (row.source_type === "sales_invoice" && coXemCongNo) return () => void moCongNoCuaPhieu(row);
      if (row.source_type === "order_deposit" && coXemDonBan && row.order_id != null) {
        const id = row.order_id;
        return () => navigate("don-hang-ban", { openOrderId: id });
      }
      if (row.source_type === "purchase_refund" && coXemPhieuChi && row.payment_voucher_code) {
        const ma = row.payment_voucher_code;
        return () => navigate("ke-toan-phieu-chi", { focusVoucherQuery: ma });
      }
      return undefined;
    },
    [coXemCongNo, coXemDonBan, coXemPhieuChi, moCongNoCuaPhieu, navigate],
  );

  // "Sửa" phiếu cũ chờ thu từ phiếu chi (PT-4): cần phiếu chi gốc để tính "Còn được thu".
  async function moSua(row: PaymentReceiptRow) {
    if (!token || row.payment_voucher_id == null) return;
    setLoiMo(null);
    try {
      const voucher = await api.accounting.voucher(token, row.payment_voucher_id);
      setMo(null);
      setSua({ voucher, receipt: row });
    } catch (e) {
      setLoiMo(e instanceof ApiError ? e.message : "Không tải được phiếu chi gốc.");
    }
  }

  const muc = useMemo<MucLocNhanh[]>(() => [
    { key: "tat_ca", label: "Tất cả", count: soThe?.tat_ca },
    { key: "xong", label: "Đã thu", mau: "la", count: soThe?.xong },
    // Chỉ phiếu CŨ còn chờ thu; hết thì ẩn (trừ khi đang đứng ở mục đó — effect trên tự về Tất cả).
    ...(!((soThe?.cho ?? 0) > 0) && the !== "cho"
      ? []
      : [{ key: "cho", label: "Chờ thu", mau: "cam" as const, count: soThe?.cho }]),
    // Hàng việc, không phải trạng thái phiếu ⇒ số là số khoản chờ thu. Hết việc thì ẩn (trừ khi đang
    // đứng ở mục đó, hoặc tải lỗi — lỗi thì mục vẫn hiện để bấm vào thấy câu lỗi).
    ...(the !== "dh" && !dhLoi && (dh?.length ?? 0) === 0
      ? []
      : [{ key: "dh", label: "Đơn hàng chờ thu", mau: "cam" as const, count: dh?.length }]),
    { key: "da_huy", label: "Đã hủy", mau: "xam", count: soThe?.da_huy },
  ], [soThe, the, dh, dhLoi]);
  const mucLoc = useMucThuChi("thu", false).ds;
  // Trạng thái trong nút Lọc = các mục đang hiện của hàng lọc nhanh (đọc/ghi thẳng mục đang chọn).
  const dieuKien = useMemo(
    () => [
      dkTrangThaiPhieu({
        muc: muc.filter((m) => m.key !== "dh").map((m) => ({ id: m.key, nhan: m.label })),
        n: soThe, dang: the, dat: (id) => setThe(id as TheLocPT),
      }),
      ...dieuKienPhieu(CAU_HINH_LOC_PT, sp.taiKhoan, mucLoc),
    ],
    [muc, soThe, the, setThe, sp.taiKhoan, mucLoc],
  );
  // Dòng Cộng: số phiếu khớp với tổng tiền máy chủ cộng (có tính tab).
  const soXong = soPhieuCong({ the, n: soThe, tong: sp.tong });
  const luoi = useCauHinhLuoi(MAN);
  const cotHien = luoi.rongHien(luoi.xep(COT_PHIEU_THU).filter((c) => !luoi.an.has(c.key)));
  const luoiDh = useCauHinhLuoi(`${MAN}:don-hang`);
  const moDon = coXemDonBan ? (id: number) => navigate("don-hang-ban", { openOrderId: id }) : undefined;

  return (
    <main className="kt-trang lds">
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Phiếu thu</h1>
        <div className="lds-dau__nut">
          {coLap && (
            <Button variant="accent" onClick={() => setLapKhac(true)}>
              <Plus size={15} aria-hidden="true" /> Lập phiếu thu
            </Button>
          )}
        </div>
      </header>
      {loiMo && <p className="kt-o__loi" role="alert">{loiMo}</p>}

      <section className="lds-loc">
        <LocNhanhTrangThai muc={muc} dang={the} onChon={(k) => setThe(k as TheLocPT)} />
        {/* "Đơn hàng chờ thu" không có bảng phiếu ⇒ ô tìm, bộ lọc không áp vào, ẩn đi. */}
        {the === "dh" ? (
          <div className="lds-loc__thanh tl-thanh">
            <ChonCot cot={COT_CHO_THU} {...luoiDh.chonCot} />
          </div>
        ) : (
          <div className="lds-loc__thanh tl-thanh" role="search">
            <OTim value={sp.tim} onChange={sp.setTim} placeholder="Tìm số phiếu, người nộp, số hoá đơn"
              ariaLabel="Tìm phiếu thu" />
            <ThanhLoc ky={sp.ky} moc={MOC_PT} onKy={sp.setKy} dieuKien={dieuKien} loc={loc} onLoc={sp.setLoc} />
            <ChonCot cot={COT_PHIEU_THU} {...luoi.chonCot} />
          </div>
        )}
      </section>

      {the === "dh" ? (
        <HangChoThuDon key={lanGop} rows={dh} loi={dhLoi} onLap={coLap ? setLapDh : undefined}
          onLapGop={coLap ? (khach, khoan) => setLapGop({ khach, khoan }) : undefined} onMoDon={moDon} luoi={luoiDh} />
      ) : (
        <>
      <ReceiptsTable
        cot={cotHien}
        luoi={luoi}
        rows={rows}
        loading={sp.loading}
        loi={sp.loi}
        onTaiLai={load}
        dangXem={mo?.id ?? null}
        onMo={(id) => setMo(rows.find((r) => r.id === id) ?? null)}
        coLoc={dangLoc(the, loc, sp.timTre)}
        onBoLoc={sp.boLoc}
        onLap={coLap ? () => setLapKhac(true) : undefined}
        trang={sp.page}
        size={sp.size}
        tong={sp.tong}
        onTrang={sp.datTrang}
        onSize={sp.setSize}
        moNguon={moNguon}
        tongTien={sp.tongTien}
        soXong={soXong}
      />
      <GoiYPhim />
        </>
      )}

      {mo && (
        <ReceiptsDrawer
          dau={mo}
          eventTick={eventTick}
          quyen={{ lap: coLap, huy: coHuy, xacNhan: coXacNhan, in: coIn, sua: coLap }}
          len={sp.len}
          xuong={sp.xuong}
          onDong={() => setMo(null)}
          onDoi={load}
          onSua={(row) => void moSua(row)}
          onMoDonBan={coXemDonBan ? (orderId) => navigate("don-hang-ban", { openOrderId: orderId }) : undefined}
          onMoPhieuChi={coXemPhieuChi ? (code) => navigate("ke-toan-phieu-chi", { focusVoucherQuery: code }) : undefined}
          onMoCongNo={coXemCongNo ? (khach) => navigate("ke-toan-cong-no-phai-thu", { focusReceivableCustomer: khach }) : undefined}
        />
      )}
      {lapKhac && (
        <OtherReceiptDialog
          onClose={() => setLapKhac(false)}
          onMoTaiKhoan={() => navigate("ke-toan-tai-khoan-ngan-hang")}
          onSaved={(saved) => {
            setLapKhac(false);
            setMo(saved);
            load();
          }}
        />
      )}
      {lapDh?.loai === "coc" && lapDh.r.customer_id != null && (
        <DepositReceiptDialog
          order={{
            id: lapDh.r.order_id, order_no: lapDh.r.order_code, customer_id: lapDh.r.customer_id,
            customer_name: lapDh.r.customer_name ?? "", deposit_pct: lapDh.r.deposit_pct,
            deposit_required: lapDh.r.can_thu, deposit_received: lapDh.r.da_thu,
          }}
          coTheTaiTep={coLap}
          onClose={() => setLapDh(null)}
          onSaved={() => {
            setLapDh(null);
            load();
            taiDh();
          }}
        />
      )}
      {lapGop && (
        <LapPhieuThuGop
          customerId={lapGop.khach.id}
          customerName={lapGop.khach.ten}
          khoan={lapGop.khoan}
          onClose={() => setLapGop(null)}
          onMoTaiKhoan={() => navigate("ke-toan-tai-khoan-ngan-hang")}
          onSaved={(saved) => {
            setLapGop(null);
            setLanGop((n) => n + 1);
            setMo(saved);
            load();
            taiDh();
          }}
        />
      )}
      {lapDh?.loai === "hoa_don" && lapDh.r.customer_id != null && (
        <ThuTienHoaDon
          key={lapDh.r.invoice_id}
          item={hoaDonThanhDongCongNo(lapDh.r)}
          customerId={lapDh.r.customer_id}
          customerName={lapDh.r.customer_name ?? ""}
          coNganKhach={false}
          onDong={() => setLapDh(null)}
          onDaLap={(saved) => {
            setLapDh(null);
            setMo(saved);
            load();
            taiDh();
          }}
          onMoDon={moDon}
          onMoPhieu={(code) => {
            setLapDh(null);
            setThe("tat_ca");
            sp.setTim(code);
          }}
          onMoTaiKhoan={() => navigate("ke-toan-tai-khoan-ngan-hang")}
        />
      )}
      {sua && (
        <PaymentReceiptDialog
          key={sua.receipt.id}
          voucher={sua.voucher}
          receipt={sua.receipt}
          onClose={() => setSua(null)}
          onSaved={(saved) => {
            setSua(null);
            setMo(saved);
            load();
          }}
        />
      )}
    </main>
  );
}

/** Dòng "hoá đơn chờ thu" → dạng dòng hoá đơn của Công nợ phải thu mà form thu tiền hoá đơn đọc. */
function hoaDonThanhDongCongNo(h: HoaDonChoThu): ReceivableItemRow {
  return {
    invoice_id: h.invoice_id,
    invoice_symbol: h.invoice_symbol,
    invoice_number: h.invoice_number,
    invoice_date: h.invoice_date,
    order_id: h.order_id,
    order_code: h.order_code,
    customer_id: h.customer_id,
    customer_name: h.customer_name ?? "",
    due_date: h.due_date,
    chua_dat_han: h.due_date == null,
    overdue_days: 0,
    aging_bucket: null,
    amount: h.amount,
    direct_received_amount: h.direct_received_amount,
    deposit_offset_amount: h.deposit_offset_amount,
    hoan_khong_don: h.hoan_khong_don,
    received_amount: h.da_thu,
    remaining_amount: h.con_no,
  };
}

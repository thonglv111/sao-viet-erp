/** Màn PHIẾU CHI (đặc tả PC-1 … PC-6, A.16 – A.18) — khuôn lưới danh sách chung `lds-*`, giống các
 *  danh sách Kinh doanh (08/10/2026).
 *
 *  Khuôn trang: đầu trang (tiêu đề + nút "Lập phiếu chi") → thẻ lọc (hàng lọc nhanh trạng thái có số;
 *  ô tìm, thanh lọc chung `ThanhLoc`: kỳ theo Ngày tạo / Ngày chi + điều kiện; nút Cột) → lưới kiểu
 *  bảng tính + dòng Cộng + chân phân trang. Bấm dòng mở ngăn chi tiết kiểu 3 bên phải. Mục "Gia công
 *  chờ chi" và "Chờ trả lại khách" thay cả bảng (chỉ hiện khi có việc). Mục "Mua hàng chờ chi"
 *  (17/10/2026) cũng thay cả bảng: đơn mua đã duyệt còn cọc / đợt giao chưa chi — chỗ DUY NHẤT lập
 *  phiếu chi theo đơn mua (màn Đơn mua hàng chỉ còn duyệt; Công nợ phải trả vẫn chi gộp nhiều đợt).
 *  Mọi lọc chạy ở MÁY CHỦ; số trên hàng lọc nhanh (`the_loc`) tính theo kỳ + bộ lọc, KHÔNG theo mục đang chọn.
 *
 *  ⚠️ TIỀN THẬT: lập phiếu chi = tiền đã rời két, không sửa được — sai thì hủy (có lý do) rồi lập lại.
 */
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError, api, type CkKeChoChi, type GiaCongChoChi, type MuaHangChoChi, type PaymentVoucherRow, type TraLaiKhachChoChi,
} from "../../../api/client";
import { useAuth } from "../../../auth/useAuth";
import { useCan } from "../../../auth/permissions";
import type { NavigateFn } from "../../../components/AppShell";
import { Button } from "../../../components/Button";
import {
  ChonCot, LocNhanhTrangThai, OTim, useCauHinhLuoi, type MucLocNhanh,
} from "../../../components/LuoiDs";
import { BAI_GHEP_ENABLED, VOUCHER_PAGE_LABEL } from "../../../constants/features";
import { GoiYPhim } from "../shared/BangPhieu";
import { soPhieuCong } from "../shared/PhieuGon";
import { useTrangPhieu, type CauHinhTrangPhieu } from "../shared/trangPhieu";
import { COT_GIA_CONG, HangChoGiaCong } from "./components/HangChoGiaCong";
import { COT_MUA_HANG, dongMuaHang, HangChoMuaHang, type KhoanChi } from "./components/HangChoMuaHang";
import { COT_TRA_LAI, HangChoTraLai } from "./components/HangChoTraLai";
import { COT_CK_KE, HangChoCkKe } from "./components/HangChoCkKe";
import { VouchersDrawer } from "./components/VouchersDrawer";
import { COT_PHIEU_CHI, VouchersTable } from "./components/VouchersTable";
import { LapPhieuChiGop, type KhoanGop } from "./components/LapPhieuChiGop";
import { LapPhieuChiGiaCongModal } from "./modals/LapPhieuChiGiaCongModal";
import { StandaloneVoucherDialog } from "./modals/StandaloneVoucherDialog";
import { TraLaiTienKhachModal } from "./modals/TraLaiTienKhachModal";
import { LapPhieuChiCkKeModal } from "./modals/LapPhieuChiCkKeModal";
import { PaymentVoucherDialog } from "./PaymentVoucherDialog";
import { PAGE_SIZE } from "./shared/list-constants";
import {
  CAU_HINH_LOC_PC,
  LOC_TRONG,
  MOC_PC,
  dangLoc,
  locLenUrl,
  locTuUrl,
  thamSoLoc,
  thamSoTai,
  type LocPC,
  type TheLocPC,
} from "./shared/loc";
import { dieuKienPhieu, dkTrangThaiPhieu } from "../shared/locPhieu";
import { useMucThuChi } from "../shared/OChonMuc";
import { ThanhLoc } from "../../thanh-loc/ThanhLoc";
import "../ke-toan.css";

/** Mã màn — khoá nhớ kỳ và dấu `man` trên URL (đặc tả A.18). */
const MAN = "ke-toan-phieu-chi";

export function PaymentVouchersPage({
  navigate,
  eventTick = 0,
  focusQuery = null,
  focusChoChi = null,
}: {
  navigate: NavigateFn;
  eventTick?: number;
  /** Liên thông từ Phiếu thu / Tạm ứng: điền sẵn ô tìm (mã phiếu chi). */
  focusQuery?: string | null;
  /** Liên thông từ ngăn Đơn mua hàng: mở tab "Mua hàng chờ chi", bung sẵn đơn mã này. */
  focusChoChi?: string | null;
}) {
  const { token } = useAuth();
  const can = useCan();
  // Khoá RIÊNG của màn Phiếu chi. `create` = LẬP phiếu + gán chứng từ.
  const coLap = can("phieu_chi", "create");
  const coHuy = can("phieu_chi", "cancel");
  const coIn = can("phieu_chi", "export");
  // Mở đơn mua / đọc số đợt giao cần ô Xem của màn Đơn mua hàng (Kế toán) — không mượn khoá khác.
  const coXemDonMua = can("ke_toan", "read");
  const coXemTaiKhoan = can("tk_ngan_hang", "read");
  // Link mã yêu cầu mua nguồn trong ngăn — theo ô Xem của CHÍNH màn Yêu cầu mua hàng.
  const coXemYeuCau = can("yeu_cau_mua_hang", "read");
  // Link nguồn của hai hàng chờ — theo ô Xem của chính màn đích.
  const coXemDonBan = can("don_hang_ban", "read");
  const coXemSx = can("san_xuat", "read");

  const [gc, setGc] = useState<GiaCongChoChi[] | null>(null);
  const [gcLoi, setGcLoi] = useState<string | null>(null);
  const [lapRoi, setLapRoi] = useState(false);
  const [lapGc, setLapGc] = useState<GiaCongChoChi | null>(null);
  const [tl, setTl] = useState<TraLaiKhachChoChi[] | null>(null);
  const [tlLoi, setTlLoi] = useState<string | null>(null);
  const [lapTl, setLapTl] = useState<TraLaiKhachChoChi | null>(null);
  // Hàng "Chờ chi CK / kê" (20/10/2026). `lanCk` đổi sau khi lập để hàng chờ bỏ hết dấu tick.
  const [ck, setCk] = useState<CkKeChoChi[] | null>(null);
  const [ckLoi, setCkLoi] = useState<string | null>(null);
  const [lapCk, setLapCk] = useState<CkKeChoChi[] | null>(null);
  const [lanCk, setLanCk] = useState(0);

  const taiGc = useCallback(() => {
    if (!token) return;
    api.giaCongNgoai
      .choChi(token)
      .then((r) => {
        setGc(r);
        setGcLoi(null);
      })
      .catch((e: unknown) => setGcLoi(e instanceof ApiError ? e.message : "Không tải được hàng gia công chờ chi."));
  }, [token]);
  useEffect(() => {
    taiGc();
  }, [taiGc]);
  const taiTl = useCallback(() => {
    if (!token) return;
    api.accounting
      .traLaiKhachChoChi(token)
      .then((r) => {
        setTl(r);
        setTlLoi(null);
      })
      .catch((e: unknown) => setTlLoi(e instanceof ApiError ? e.message : "Không tải được danh sách chờ trả lại khách."));
  }, [token]);
  useEffect(() => {
    taiTl();
  }, [taiTl]);
  const taiCk = useCallback(() => {
    if (!token) return;
    api.accounting
      .ckKeChoChi(token)
      .then((r) => {
        setCk(r);
        setCkLoi(null);
      })
      .catch((e: unknown) => setCkLoi(e instanceof ApiError ? e.message : "Không tải được hàng chờ chi chiết khấu / kê."));
  }, [token]);
  useEffect(() => {
    taiCk();
  }, [taiCk]);
  const taiHangCho = useCallback(() => {
    taiGc();
    taiTl();
    taiCk();
  }, [taiGc, taiTl, taiCk]);

  // Hàng "Mua hàng chờ chi": nạp cả hàng (không phân trang), ô tìm lọc ngay trên máy.
  const [mh, setMh] = useState<MuaHangChoChi[] | null>(null);
  const [mhLoi, setMhLoi] = useState<string | null>(null);
  const [timMh, setTimMh] = useState("");
  const [lapMh, setLapMh] = useState<{ row: MuaHangChoChi; khoan: KhoanChi } | null>(null);
  // Phiếu chi gộp: các khoản đã tick cùng NCC. `lanGop` đổi sau khi lập để hàng chờ bỏ hết dấu tick.
  const [lapGop, setLapGop] = useState<{ ncc: { id: number | null; ten: string }; khoan: KhoanGop[] } | null>(null);
  const [lanGop, setLanGop] = useState(0);
  const taiMh = useCallback(() => {
    if (!token) return;
    api.accounting
      .muaHangChoChi(token)
      .then((r) => {
        setMh(r);
        setMhLoi(null);
      })
      .catch((e: unknown) => setMhLoi(e instanceof ApiError ? e.message : "Không tải được hàng mua hàng chờ chi."));
  }, [token]);
  useEffect(() => {
    taiMh();
  }, [taiMh]);

  // Nối dây trang sổ (kỳ, thẻ, lọc, URL, tải + cùng kỳ, SSE, liên thông, ngăn): khuôn chung. Sự kiện
  // đẩy nạp lại thêm hàng gia công chờ chi.
  const cauHinh: CauHinhTrangPhieu<PaymentVoucherRow, TheLocPC, LocPC> = {
    man: MAN,
    moc: MOC_PC,
    locTuUrl,
    locLenUrl,
    locTrong: LOC_TRONG,
    thamSoLoc,
    thamSoTai,
    goiDanhSach: (t, p) => api.accounting.vouchers(t, p),
    theKhongBang: (t) => t === "gc" || t === "tl" || t === "ck" || t === "mh",
    chuLoi: "Không tải được danh sách phiếu chi.",
    coTrang: PAGE_SIZE,
    coXemTaiKhoan,
    mucDichTaiKhoan: "pay",
    // Đơn được duyệt / đợt giao ghi mới / phiếu chi lập hay huỷ (ở đây, Công nợ, máy khác) đều đẩy
    // về nhóm `mua_ke_toan` ⇒ hàng "Mua hàng chờ chi" tự nhảy, không bắt tải lại.
    onSuKien: () => {
      taiHangCho();
      taiMh();
    },
  };
  const sp = useTrangPhieu(cauHinh, token, eventTick, focusQuery);
  const moDonMua = coXemDonMua ? (code: string) => navigate("ke-toan-don-mua-hang", { focusRequestCode: code }) : undefined;
  const { the, setThe, loc, rows, mo, setMo, load } = sp;
  // Link "Chi tiền ở Phiếu chi" từ ngăn Đơn mua hàng ⇒ đứng ngay ở tab Mua hàng chờ chi, ô tìm điền sẵn
  // mã đơn ⇒ chỉ còn các khoản của đơn đó (xoá ô tìm là thấy lại cả hàng).
  useEffect(() => {
    if (!focusChoChi) return;
    setThe("mh");
    setTimMh(focusChoChi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusChoChi]);
  const { soThe } = sp;
  const mucLoc = useMucThuChi("chi", false).ds;
  const muc = useMemo<MucLocNhanh[]>(() => [
    { key: "tat_ca", label: "Tất cả", count: soThe?.tat_ca },
    { key: "xong", label: "Đã chi", mau: "la", count: soThe?.xong },
    // Gia công không có đơn giá (chủ chốt 07/10/2026) ⇒ mục đếm việc, không cộng tiền. Không có việc
    // (hoặc đang tải) thì ẩn — trừ khi đang đứng ở mục đó (vd mở từ link) hoặc tải LỖI: lỗi thì mục vẫn
    // hiện (không số) để bấm vào thấy câu lỗi, việc chờ chi không lặng lẽ biến mất.
    ...(the !== "gc" && !gcLoi && (gc?.length ?? 0) === 0
      ? []
      : [{ key: "gc", label: "Gia công chờ chi", mau: "cam" as const, count: gc?.length }]),
    ...(the !== "tl" && !tlLoi && (tl?.length ?? 0) === 0
      ? []
      : [{ key: "tl", label: "Chờ trả lại khách", mau: "cam" as const, count: tl?.length }]),
    ...(the !== "ck" && !ckLoi && (ck?.length ?? 0) === 0
      ? []
      : [{ key: "ck", label: "Chờ chi CK / kê", mau: "cam" as const, count: ck?.length }]),
    // Đơn mua chờ chi: luôn hiện (đây là chỗ duy nhất lập phiếu theo đơn mua) — đếm ĐƠN, không cộng tiền.
    // Đếm KHOẢN (cọc, từng đợt) như dòng của hàng — cùng cách đếm "Đơn hàng chờ thu".
    { key: "mh", label: "Mua hàng chờ chi", mau: "cam", count: mh ? dongMuaHang(mh).length : undefined },
    { key: "da_huy", label: "Đã hủy", mau: "xam", count: soThe?.da_huy },
  ], [soThe, gc, gcLoi, tl, tlLoi, ck, ckLoi, the, mh]);
  // Trạng thái trong nút Lọc = các tab có bảng (các hàng chờ thay cả bảng nên không vào).
  const dieuKien = useMemo(
    () => [
      dkTrangThaiPhieu({
        muc: muc.filter((m) => m.key !== "gc" && m.key !== "tl" && m.key !== "ck" && m.key !== "mh").map((m) => ({ id: m.key, nhan: m.label })),
        n: soThe, dang: the, dat: (id) => setThe(id as TheLocPC),
      }),
      ...dieuKienPhieu(CAU_HINH_LOC_PC, sp.taiKhoan, mucLoc),
    ],
    [muc, soThe, the, setThe, sp.taiKhoan, mucLoc],
  );
  // Dòng Cộng: số phiếu khớp với tổng tiền máy chủ cộng (có tính tab).
  const soXong = soPhieuCong({ the, n: soThe, tong: sp.tong });
  const luoi = useCauHinhLuoi(MAN);
  const luoiGc = useCauHinhLuoi(`${MAN}:gia-cong`);
  const luoiTl = useCauHinhLuoi(`${MAN}:tra-lai`);
  const luoiCk = useCauHinhLuoi(`${MAN}:ck-ke`);
  const luoiMh = useCauHinhLuoi(`${MAN}:mua-hang`);
  const moDon = coXemDonBan ? (id: number) => navigate("don-hang-ban", { openOrderId: id }) : undefined;
  const moNguonGc = (r: GiaCongChoChi) => {
    if (r.bai_ghep_id != null) {
      if (BAI_GHEP_ENABLED) navigate("bai-ghep-2", { openBaiGhepId: r.bai_ghep_id });
    } else if (r.lsx_id != null) navigate("ke-hoach-sx", { openLsxId: r.lsx_id });
  };
  const coMoNguonGc = (r: GiaCongChoChi) =>
    coXemSx && (r.bai_ghep_id != null ? BAI_GHEP_ENABLED : r.lsx_id != null);
  const cotHien = luoi.rongHien(luoi.xep(COT_PHIEU_CHI).filter((c) => !luoi.an.has(c.key)));

  return (
    <main className="kt-trang lds">
      <header className="lds-dau">
        <h1 className="lds-dau__ten">{VOUCHER_PAGE_LABEL}</h1>
        <div className="lds-dau__nut">
          {coLap && (
            <Button variant="accent" onClick={() => setLapRoi(true)}>
              <Plus size={15} aria-hidden="true" /> Lập phiếu chi
            </Button>
          )}
        </div>
      </header>

      <section className="lds-loc">
        <LocNhanhTrangThai muc={muc} dang={the} onChon={(k) => setThe(k as TheLocPC)} />
        {/* Mục "Gia công chờ chi" không có bảng phiếu ⇒ ô tìm, bộ lọc không áp vào, ẩn đi; còn nút Cột
            của chính hàng gia công. */}
        {the === "gc" ? (
          <div className="lds-loc__thanh tl-thanh">
            <ChonCot cot={COT_GIA_CONG} {...luoiGc.chonCot} />
          </div>
        ) : the === "tl" ? (
          <div className="lds-loc__thanh tl-thanh">
            <ChonCot cot={COT_TRA_LAI} {...luoiTl.chonCot} />
          </div>
        ) : the === "ck" ? (
          <div className="lds-loc__thanh tl-thanh">
            <ChonCot cot={COT_CK_KE} {...luoiCk.chonCot} />
          </div>
        ) : the === "mh" ? (
          <div className="lds-loc__thanh tl-thanh" role="search">
            <OTim value={timMh} onChange={setTimMh} placeholder="Tìm mã đơn, nhà cung cấp" ariaLabel="Tìm đơn mua chờ chi" />
            <ChonCot cot={COT_MUA_HANG} {...luoiMh.chonCot} />
          </div>
        ) : (
          <div className="lds-loc__thanh tl-thanh" role="search">
            <OTim value={sp.tim} onChange={sp.setTim} placeholder="Tìm số phiếu, người nhận, lý do, mã đơn"
              ariaLabel="Tìm phiếu chi" />
            <ThanhLoc ky={sp.ky} moc={MOC_PC} onKy={sp.setKy} dieuKien={dieuKien} loc={loc} onLoc={sp.setLoc} />
            <ChonCot cot={COT_PHIEU_CHI} {...luoi.chonCot} />
          </div>
        )}
      </section>

      {the === "gc" ? (
        <HangChoGiaCong rows={gc} loi={gcLoi} onLap={coLap ? setLapGc : undefined} luoi={luoiGc}
          onMoNguon={moNguonGc} coMoNguon={coMoNguonGc} />
      ) : the === "tl" ? (
        <HangChoTraLai rows={tl} loi={tlLoi} onLap={coLap ? setLapTl : undefined} onMoDon={moDon} luoi={luoiTl} />
      ) : the === "ck" ? (
        <HangChoCkKe key={lanCk} rows={ck} loi={ckLoi} onLap={coLap ? setLapCk : undefined} onMoDon={moDon} luoi={luoiCk} />
      ) : the === "mh" ? (
        <HangChoMuaHang
          key={lanGop}
          rows={mh}
          loi={mhLoi}
          tim={timMh}
          onLap={coLap ? (row, khoan) => setLapMh({ row, khoan }) : undefined}
          onLapGop={coLap ? (ncc, khoan) => setLapGop({ ncc, khoan }) : undefined}
          onMoDon={moDonMua}
          luoi={luoiMh}
        />
      ) : (
        <>
          <VouchersTable
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
            onLap={coLap ? () => setLapRoi(true) : undefined}
            onMoDonMua={moDonMua}
            trang={sp.page}
            size={sp.size}
            tong={sp.tong}
            onTrang={sp.datTrang}
            onSize={sp.setSize}
            tongTien={sp.tongTien}
            soXong={soXong}
          />
          <GoiYPhim />
        </>
      )}

      {mo && (
        <VouchersDrawer
          dau={mo}
          eventTick={eventTick}
          quyen={{ lap: coLap, huy: coHuy, in: coIn, xemDonMua: coXemDonMua }}
          len={sp.len}
          xuong={sp.xuong}
          onDong={() => setMo(null)}
          onDoi={load}
          onMoDonMua={moDonMua}
          onMoPhieuThu={(code) => navigate("ke-toan-phieu-thu", { focusReceiptQuery: code })}
          onMoYeuCau={coXemYeuCau ? (code) => navigate("yeu-cau-mua-hang", { focusRequestCode: code }) : undefined}
        />
      )}
      {lapRoi && (
        <StandaloneVoucherDialog
          onClose={() => setLapRoi(false)}
          onMoTaiKhoan={() => navigate("ke-toan-tai-khoan-ngan-hang")}
          onSaved={(saved) => {
            setLapRoi(false);
            setMo(saved);
            load();
          }}
        />
      )}
      {lapMh && (
        <PaymentVoucherDialog
          purchase={lapMh.row.don}
          coc={lapMh.khoan.coc}
          dotId={lapMh.khoan.coc ? null : lapMh.khoan.dotId}
          onClose={() => setLapMh(null)}
          onMoTaiKhoan={() => navigate("ke-toan-tai-khoan-ngan-hang")}
          onSaved={(saved) => {
            setLapMh(null);
            setMo(saved);
            load();
            taiMh();
          }}
        />
      )}
      {lapGop && (
        <LapPhieuChiGop
          supplierId={lapGop.ncc.id ?? undefined}
          supplierName={lapGop.ncc.ten}
          khoan={lapGop.khoan}
          onClose={() => setLapGop(null)}
          onMoTaiKhoan={() => navigate("ke-toan-tai-khoan-ngan-hang")}
          onSaved={(saved) => {
            setLapGop(null);
            setLanGop((n) => n + 1);
            setMo(saved);
            load();
            taiMh();
          }}
        />
      )}
      {lapGc && (
        <LapPhieuChiGiaCongModal
          row={lapGc}
          onClose={() => setLapGc(null)}
          onMoTaiKhoan={() => navigate("ke-toan-tai-khoan-ngan-hang")}
          onDone={(saved) => {
            setLapGc(null);
            setMo(saved);
            load();
            taiGc();
          }}
        />
      )}
      {lapCk && lapCk.length > 0 && (
        <LapPhieuChiCkKeModal
          dong={lapCk}
          onClose={() => setLapCk(null)}
          onMoTaiKhoan={() => navigate("ke-toan-tai-khoan-ngan-hang")}
          onSaved={(saved) => {
            setLapCk(null);
            setLanCk((x) => x + 1);
            setMo(saved);
            load();
            taiCk();
          }}
        />
      )}
      {lapTl && lapTl.customer_id != null && (
        <TraLaiTienKhachModal
          khachId={lapTl.customer_id}
          khachTen={lapTl.customer_name ?? ""}
          don={{ id: lapTl.order_id, ma: lapTl.order_code, daNhan: 0, conLai: lapTl.con_lai, daTraLai: lapTl.da_tra_lai }}
          duongDan={<>Phiếu chi &gt; Chờ trả lại khách &gt; {lapTl.order_code}</>}
          onClose={() => setLapTl(null)}
          onMoTaiKhoan={() => navigate("ke-toan-tai-khoan-ngan-hang")}
          onDone={(saved) => {
            setLapTl(null);
            setMo(saved);
            load();
            taiTl();
          }}
        />
      )}
    </main>
  );
}

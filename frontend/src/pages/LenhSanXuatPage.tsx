// Màn "Hồ sơ lệnh sản xuất" — một dòng một LỆNH đã phát hành, kể cả lệnh đã đóng (phương án A,
// 12/10/2026). Dòng có tuyến bước ngang (lệnh trọn gói là một chấm mang tên nhà gia công); bấm dòng mở
// ngăn `LenhSxNgan` (quy cách một dòng, routing dọc, Sau xưởng). Ai thấy lệnh nào: theo luật của Đơn
// hàng bán với cấp phạm vi của module này — máy chủ gắn từ token.
// Kế hoạch: `docs/superpowers/plans/2026-10-12-theo-doi-don-ho-so-lenh.md`.
//
// ⚠️ MÀN NÀY KHÔNG GHI GÌ CẢ, KHÔNG MỘT SỐ TIỀN NÀO. Lọc, đếm tab, cắt trang đều ở MÁY CHỦ — không
// `rows.filter`, không `rows.slice`, không đếm số trên tab từ `items`.
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api } from "../api/client";
import type { LenhSxItem, LenhSxTab } from "../api/client";
import { useAuth } from "../auth/useAuth";
import type { NavigateFn } from "../components/AppShell";
import { EmptyRow } from "../components/EmptyState";
import {
  ChipTT, ChonCot, CuonLuoi, LocNhanhTrangThai, OTim, rongLuoi, soVN, tenKhachGon, ngayVN, useCauHinhLuoi, type CotLuoi, type MauTT,
} from "../components/LuoiDs";
import { trangHopLe } from "../components/Pager";
import { PhanTrangDayDu } from "../components/PhanTrangDayDu";
import { useTre } from "../lib/useTre";
import { BangLoi } from "./keHoachSxShared";
import { LenhSxNgan } from "./LenhSxNgan";
import { nhanKhau, TheGap } from "./lsxKhau";
import { TuyenBuoc } from "./lsxRoutingDoc";
import {
  LOC_HO_SO_LENH_TRONG,
  MOC_HO_SO_LENH,
  locHoSoLenhLenUrl,
  locHoSoLenhTuUrl,
  thamSoLocHoSoLenh,
  useDieuKienHoSoLenh,
  type LocHoSoLenh,
} from "./loc-san-xuat/dieu-kien-lenh-san-xuat";
import { ThanhLoc } from "./thanh-loc/ThanhLoc";
import { kyLenUrl, kyTuUrl, thamSoKy, type KyDS } from "./thanh-loc/ky-danh-sach";
import { daAp, dkTheoTab, type DieuKien } from "./thanh-loc/thanh-loc";
import { useLocMan } from "./thanh-loc/useLocMan";
// `ke-hoach-sx.css` cho `EmptyState`/`Skeleton` (lớp `.khsx-*`), rồi CSS chung của hai màn.
import "./ke-hoach-sx.css";
import "./lenh-sx-chung.css";

/** Gộp sự kiện SSE rồi mới tải lại — chuyền chạy thì sự kiện tới liên tục. */
const SSE_GOP_MS = 2000;

/** Bốn tab theo KHÂU (`trang_thai.KHAU` + "tất cả"). Khoá đi thẳng ra `?tab=` — hợp đồng. */
const TABS: { key: LenhSxTab; label: string }[] = [
  { key: "tat_ca", label: "Tất cả" },
  { key: "dang_sx", label: "Đang sản xuất" },
  { key: "sau_sx", label: "Sau sản xuất" },
  { key: "da_giao", label: "Đã giao đủ" },
];

/** Chấm màu hàng lọc nhanh — cùng hệ màu với chip khâu của dòng (`MAU_KHAU`). */
const MAU_TAB: Record<LenhSxTab, MauTT | undefined> = {
  tat_ca: undefined,
  dang_sx: "xanh",
  sau_sx: "vang",
  da_giao: "la",
};

/** Chip khâu của dòng — mỗi khâu một sắc; Sau sản xuất tách theo chi tiết (ba chặng khác việc). */
const MAU_KHAU: Record<string, MauTT> = { dang_sx: "xanh", da_giao: "la" };
const MAU_KHAU_CT: Record<string, MauTT> = { dang_kcs: "tim", cho_nhap_kho: "vang", san_sang_giao: "ngoc" };

// --- Lưới danh sách (phương án A, 12/10/2026). Thứ tự: Lệnh, Đơn, Khách hàng, Mặt hàng, Số lượng, Các bước,
// Trạng thái, Hạn giao (hạn giao khách — hạn SX nội bộ không còn là cột). Không sắp xếp ở máy chủ.
interface CotLenh extends CotLuoi { w?: number; n?: boolean }
const COT_LENH: CotLenh[] = [
  { key: "ma", label: "Lệnh", coDinh: true, w: 150 },
  { key: "don", label: "Đơn", w: 80 },
  { key: "khach", label: "Khách hàng", w: 140 },
  { key: "sp", label: "Mặt hàng", w: 170 },
  { key: "sl", label: "Số lượng", w: 96, n: true },
  { key: "buoc", label: "Các bước", w: 320 },
  { key: "tt", label: "Trạng thái", w: 140 },
  { key: "han", label: "Hạn giao" },
];

/** Thanh lọc (06/10/2026): kỳ theo ngày tạo / hạn SX / hạn giao + Khách, Đơn, Gia công ngoài.
 *  Ghi lên URL `?man=lenh-san-xuat`, nhớ theo màn. Thay hai ô Khách + Hạn SX rời cũ. */
type LocMan = { ky: KyDS; loc: LocHoSoLenh };
const LOC_MAN_TRONG: LocMan = { ky: { loai: "tat_ca", moc: "tao" }, loc: LOC_HO_SO_LENH_TRONG };
const docLocMan = (p: URLSearchParams): LocMan => ({
  ky: kyTuUrl(p, MOC_HO_SO_LENH.map(([m]) => m), "tao"),
  loc: locHoSoLenhTuUrl(p),
});
const ghiLocMan = (t: LocMan) => ({ ...kyLenUrl(t.ky, "tao"), ...locHoSoLenhLenUrl(t.loc) });

export function LenhSanXuatPage({
  eventTick,
  navigate,
  openHoSoId,
  openHoSoPv,
  openHoSoSeq,
}: {
  /** Nhích theo MỌI sự kiện SSE của AppShell; màn gộp lại rồi mới tải (xem `SSE_GOP_MS`). */
  eventTick?: number;
  /** Chỉ để hồ sơ có đường sang màn Đơn hàng bán. */
  navigate?: NavigateFn;
  /** Deep link QR phiếu công nghệ (`#lsx=&pv=`): có giá trị ⇒ mở NGAY hồ sơ đó, đè lên bảng. */
  openHoSoId?: number | null;
  /** Phiên bản in trên tờ giấy đã quét — chuyển tiếp cho băng cảnh báo của hồ sơ. */
  openHoSoPv?: number | null;
  /** `navSeq` của AppShell — tăng mỗi lượt điều hướng, để quét LẠI đúng tờ vừa đóng vẫn mở lại. */
  openHoSoSeq?: number | null;
}) {
  const { token } = useAuth();

  // --- bộ lọc (chạy ở máy chủ) ------------------------------------------------
  const timRef = useRef<HTMLInputElement | null>(null);
  const trangRef = useRef<HTMLElement | null>(null);
  const [q, setQ] = useState("");
  const luoi = useCauHinhLuoi("ho-so-lenh-a");
  const cotHien = luoi.rongHien(luoi.xep(COT_LENH).filter((c) => !luoi.an.has(c.key)));
  const qTre = useTre(q);
  const [locMan, setLocMan] = useLocMan("lenh-san-xuat", LOC_MAN_TRONG, docLocMan, ghiLocMan);
  const dieuKien = useDieuKienHoSoLenh();
  const khoaLoc = JSON.stringify({ ...thamSoKy(locMan.ky), ...thamSoLocHoSoLenh(locMan.loc) });
  const [tab, setTab] = useState<LenhSxTab>("tat_ca");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    function phim(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        timRef.current?.focus();
      }
    }
    window.addEventListener("keydown", phim);
    return () => window.removeEventListener("keydown", phim);
  }, []);

  // --- ngăn một lệnh: phủ bên phải, bảng giữ nguyên tab/lọc/trang -------------------------------
  const [hoSoId, setHoSoId] = useState<number | null>(null);
  const [hoSoPv, setHoSoPv] = useState<number | null>(null);
  useEffect(() => {
    if (openHoSoId == null) return;
    setHoSoId(openHoSoId);
    setHoSoPv(openHoSoPv ?? null);
  }, [openHoSoId, openHoSoPv, openHoSoSeq]);

  // Mở tay không có tờ giấy nào để so ⇒ xoá `pv` của lượt QR trước.
  const moHoSoTay = useCallback((id: number) => {
    setHoSoId(id);
    setHoSoPv(null);
  }, []);

  const dongHoSo = useCallback(() => {
    const id = hoSoId;
    setHoSoId(null);
    setHoSoPv(null);
    // Trả tiêu điểm về đúng dòng vừa mở; dòng có thể đã biến mất (SSE) thì về ô tìm.
    requestAnimationFrame(() => {
      const dong = trangRef.current?.querySelector<HTMLElement>(`tr[data-lsx="${id}"]`);
      if (dong) dong.focus();
      else timRef.current?.focus();
    });
  }, [hoSoId]);

  // --- dữ liệu -------------------------------------------------------------------
  const [rows, setRows] = useState<LenhSxItem[]>([]);
  const [total, setTotal] = useState(0);
  const [dem, setDem] = useState<Partial<Record<LenhSxTab, number>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [daTai, setDaTai] = useState(false);
  const [loi, setLoi] = useState<{ text: string; cam: boolean } | null>(null);

  // Đổi bộ lọc hay tab ⇒ về trang 1.
  useEffect(() => {
    setPage(1);
  }, [qTre, khoaLoc, tab]);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    api.lenhSanXuat
      .danhSach(token, {
        tab,
        q: qTre.trim() || undefined,
        // Kỳ (`tu_ngay`/`den_ngay`/`moc`) + Khách / Đơn / Gia công ngoài.
        ...JSON.parse(khoaLoc),
        page,
        page_size: pageSize,
      })
      .then((r) => {
        setRows(r.items);
        setTotal(r.total);
        setDem(r.dem_theo_tab);
        setLoi(null);
        setDaTai(true);
        const ve = trangHopLe(page, r.total, pageSize);
        if (ve !== null) setPage(ve);
      })
      .catch((e) => {
        const cam = e instanceof ApiError && e.isForbidden;
        setLoi({
          text: cam
            ? "Bạn không có quyền xem hồ sơ lệnh sản xuất."
            : e instanceof ApiError
              ? e.message
              : "Máy chủ không phản hồi.",
          cam,
        });
      })
      .finally(() => setLoading(false));
  }, [token, tab, qTre, khoaLoc, page, pageSize]);
  useEffect(() => {
    load();
  }, [load]);

  // Realtime: gộp 2 giây rồi tải lại ĐÚNG một yêu cầu danh sách; giữ trang/tab/lọc. Hồ sơ đang mở
  // nhận CÙNG nhịp đã gộp (không nhận `eventTick` thô — mỗi sự kiện là một lượt hồ sơ nặng).
  const tickTre = useTre(eventTick ?? 0, SSE_GOP_MS);
  const tickDau = useRef(tickTre);
  useEffect(() => {
    if (tickTre === tickDau.current) return;
    tickDau.current = tickTre;
    load();
  }, [tickTre, load]);

  const dangLoc = qTre.trim() !== "" || locMan.ky.loai !== "tat_ca"
    || dieuKien.some((d) => daAp(d, locMan.loc));
  const xoaLoc = useCallback(() => {
    setQ("");
    setLocMan({ ky: { loai: "tat_ca", moc: locMan.ky.moc }, loc: LOC_HO_SO_LENH_TRONG });
    setTab("tat_ca");
  }, [setLocMan, locMan.ky.moc]);

  // Trạng thái trong nút Lọc = chính hàng lọc nhanh khâu (đọc/ghi `tab`), không đẻ state thứ hai.
  const dkDu: DieuKien<LocHoSoLenh>[] = [
    dkTheoTab<LocHoSoLenh>({
      tabs: TABS.map((t) => ({ id: t.key, nhan: t.label, so: dem?.[t.key] })),
      tatCa: "tat_ca", dang: tab, dat: (id) => setTab(id as LenhSxTab),
    }),
    ...dieuKien,
  ];

  const viTri = hoSoId == null ? -1 : rows.findIndex((r) => r.id === hoSoId);
  const nhanTab = TABS.find((t) => t.key === tab)?.label ?? "Tất cả";
  // Số trên hàng lọc nhanh = `dem_theo_tab` của máy chủ (tập ĐÃ LỌC, không bị chính tab lọc lại).
  // Đang tải lần đầu ⇒ để trống chỗ số, không hiện 0.
  const muc = TABS.map((t) => ({
    key: t.key, label: t.label, count: dem ? dem[t.key] ?? 0 : undefined, mau: MAU_TAB[t.key],
  }));

  return (
    <main className="lsc lds" ref={trangRef}>
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Hồ sơ lệnh sản xuất</h1>
      </header>

      {loi && rows.length > 0 && <BangLoi text="Không làm mới được danh sách." onRetry={load} />}

      <section className="lds-loc" aria-label="Lọc lệnh">
        <LocNhanhTrangThai muc={muc} dang={tab} onChon={(k) => setTab(k as LenhSxTab)} ariaLabel="Lọc lệnh theo khâu" />
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim
            inputRef={timRef}
            value={q}
            onChange={setQ}
            placeholder="Tìm mã lệnh, sản phẩm, số đơn, khách"
            ariaLabel="Tìm mã lệnh, sản phẩm, số đơn, khách"
          />
          <ThanhLoc
            ky={locMan.ky}
            moc={MOC_HO_SO_LENH}
            onKy={(ky) => setLocMan({ ...locMan, ky })}
            dieuKien={dkDu}
            loc={locMan.loc}
            onLoc={(loc) => setLocMan({ ...locMan, loc })}
            onXoaHet={xoaLoc}
          />
          {/* Có khối điều kiện thì "Xoá bộ lọc" nằm cuối hàng khối (ThanhLoc); chỉ lọc bằng ô tìm/kỳ thì ở đây. */}
          {(dangLoc || tab !== "tat_ca") && !dkDu.some((d) => daAp(d, locMan.loc) && !d.anKhoi) && (
            <button type="button" className="lds-lk" onClick={xoaLoc}>
              Xoá bộ lọc
            </button>
          )}
          <ChonCot cot={COT_LENH} {...luoi.chonCot} />
        </div>
      </section>

      <div className="lds-sheet">
        <CuonLuoi ghim={luoi.soGhim(cotHien)}>
          <table className="lds-g" style={{ minWidth: rongLuoi(cotHien, 100) }}>
            <caption className="sr-only">Danh sách lệnh sản xuất đã phát hành</caption>
            <colgroup>
              {cotHien.map((c) => (
                <col key={c.key} style={c.w ? { width: c.w } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {cotHien.map((c) => (
                  <th key={c.key} scope="col" className={c.n ? "n" : undefined}>
                    {c.label}
                    {luoi.keo(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={loading && rows.length > 0 ? "is-mo" : undefined}>
              {loading && rows.length === 0 && !loi ? (
                <EmptyRow colSpan={cotHien.length} trangThai="dang-tai" />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    {loi ? (
                      <>
                        <span className="lds-do">{loi.cam ? loi.text : `Không tải được danh sách lệnh. ${loi.text}`}</span>
                        {loi.cam ? null : (
                          <>
                            {" "}
                            <button type="button" className="lds-lk" onClick={load}>
                              Thử lại
                            </button>
                          </>
                        )}
                      </>
                    ) : daTai && tab !== "tat_ca" && (dem?.tat_ca ?? 0) > 0 ? (
                      <>
                        {`Tab «${nhanTab}» hiện không có lệnh nào.`}{" "}
                        <button type="button" className="lds-lk" onClick={() => setTab("tat_ca")}>
                          Về tab Tất cả
                        </button>
                      </>
                    ) : daTai && dangLoc ? (
                      <>
                        Không có lệnh nào khớp điều kiện đang lọc.{" "}
                        <button type="button" className="lds-lk" onClick={xoaLoc}>
                          Xoá bộ lọc
                        </button>
                      </>
                    ) : (
                      "Chưa có lệnh sản xuất nào đã phát hành trong phạm vi của bạn. Lệnh còn đang lập nằm ở màn Lệnh sản xuất."
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`lds-dong${r.id === hoSoId ? " is-chon" : ""}`}
                    data-lsx={r.id}
                    tabIndex={0}
                    onClick={() => moHoSoTay(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        moHoSoTay(r.id);
                      }
                    }}
                  >
                    {cotHien.map((c) => (
                      <OLenh key={c.key} cot={c.key} r={r} />
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CuonLuoi>

        {total > 0 && (
          <PhanTrangDayDu
            trang={page}
            size={pageSize}
            tong={total}
            soDong={rows.length}
            onTrang={setPage}
            onSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
            loading={loading}
            donVi="lệnh"
            ariaLabel="Phân trang lệnh sản xuất"
          />
        )}
      </div>

      {hoSoId !== null && (
        <LenhSxNgan
          lsxId={hoSoId}
          pv={hoSoPv}
          onDong={dongHoSo}
          eventTick={tickTre}
          len={viTri > 0 ? () => moHoSoTay(rows[viTri - 1].id) : undefined}
          xuong={viTri >= 0 && viTri < rows.length - 1 ? () => moHoSoTay(rows[viTri + 1].id) : undefined}
          onMoDon={navigate ? (orderId) => navigate("don-hang-ban", { openOrderId: orderId }) : undefined}
        />
      )}
    </main>
  );
}

/** Một ô của dòng lệnh, theo khoá cột. Bấm dòng để mở hồ sơ. */
function OLenh({ cot, r }: { cot: string; r: LenhSxItem }) {
  switch (cot) {
    case "ma":
      return (
        <td title={r.ma}>
          {r.ma}
          {r.is_rush && <TheGap />}
        </td>
      );
    case "khach":
      return r.khach_hang ? (
        <td title={r.khach_hang}>{tenKhachGon(r.khach_hang)}</td>
      ) : (
        <td className="lds-mu3">—</td>
      );
    case "don":
      return <td className={r.order_no ? undefined : "lds-mu3"}>{r.order_no ?? "—"}</td>;
    case "sp":
      return r.ten ? <td title={r.ten}>{r.ten}</td> : <td className="lds-mu3">Chưa đặt tên</td>;
    case "sl":
      return (
        <td className="n">
          {soVN(r.so_luong_dat)}
          {r.don_vi_tinh ? <span className="lds-u">{r.don_vi_tinh}</span> : null}
        </td>
      );
    case "han":
      return <td className={r.han_giao_khach ? undefined : "lds-mu3"}>{r.han_giao_khach ? ngayVN(r.han_giao_khach) : "Chưa hẹn"}</td>;
    case "buoc":
      return (
        <td className="lsc-o-tuyen">
          <TuyenBuoc chang={r.chang ?? []} tronGoi={r.tron_goi} nhaGiaCong={r.nha_gia_cong} xong={r.khau !== "dang_sx"} />
        </td>
      );
    case "tt": {
      const mau = (r.khau === "sau_sx" && r.khau_chi_tiet && MAU_KHAU_CT[r.khau_chi_tiet]) || MAU_KHAU[r.khau] || "xam";
      return (
        <td>
          <ChipTT mau={mau}>{nhanKhau(r.khau, r.khau_chi_tiet)}</ChipTT>
          {r.da_dong ? <span className="lds-tag">Đã đóng lệnh</span> : null}
        </td>
      );
    }
    default:
      return <td />;
  }
}


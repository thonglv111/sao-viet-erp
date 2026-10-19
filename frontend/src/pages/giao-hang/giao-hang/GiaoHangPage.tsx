// Màn Giao hàng — docs/prd-giao-hang.md §10.
//
// BA TAB, MỖI TAB MỘT Ô QUYỀN (luật "một ô = một tab", chốt 15/08/2026):
//   Yêu cầu giao           ← can_plan        (tab mặc định)
//   Đơn giao hàng          ← can_read        (mặc định khi không có can_plan)
//   Nhân viên giao hàng    ← can_view_drivers
//
// Phạm vi LỌC DÒNG chứ không ẩn tab — máy chủ đã lọc, FE không tự suy lại. Và trạng thái của
// YÊU CẦU do máy chủ tính (hàm của các lần giao), FE chỉ hiển thị: tính lại ở đây là hai nơi
// hiểu khác nhau.
//
// Tab "Đơn giao hàng" là BẢNG mỗi dòng một lượt xe / một lần nhà gia công giao thẳng / một chuyến
// ngoài lượt (06/10/2026); bấm dòng mở ngăn chi tiết `NganLuot` (lộ trình, chứng từ từng đơn,
// lịch sử). Nút bước kế tiếp của cả lượt nằm ngay trên dòng.
//
// Shell (tách từ pages/GiaoHangPage.tsx): state + `load()` + `moChiTiet()` + bộ tab + chỗ mount ba
// bảng, drawer chi tiết và ba hộp thoại.
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BangGiaoItem,
  DeliveryDriver,
  DeliveryRequest,
  DeliveryRequestDetail,
  DeliveryTrip,
} from "../../../api/client";
import { api } from "../../../api/client";
import { useAuth } from "../../../auth/useAuth";
import { useCan } from "../../../auth/permissions";
import { ChonCot, LocNhanhTrangThai, OTim, useCauHinhLuoi, type MauTT } from "../../../components/LuoiDs";
import { Icon } from "../../../components/Icons";
import { PhanTrangDayDu } from "../../../components/PhanTrangDayDu";
import { DrawerChiTiet } from "./components/DrawerChiTiet";
import { NganLuot } from "./components/NganLuot";
import { DialogDoiChuyen } from "./modals/DialogDoiChuyen";
import { DialogKetQua } from "./modals/DialogKetQua";
import { DialogLenKeHoach } from "./modals/DialogLenKeHoach";
import { napNguonLenDon } from "./shared/nguonLenDon";
import { ThanhLoc } from "../../thanh-loc/ThanhLoc";
import { thamSoKy } from "../../thanh-loc/ky-danh-sach";
import { useLocMan } from "../../thanh-loc/useLocMan";
import {
  LOC_GH_TRONG,
  MOC_DON,
  MOC_YC,
  locGHLenUrl,
  locGHTuUrl,
  thamSoLocDon,
  thamSoLocYC,
  useDieuKienDonGiao,
  useDieuKienYeuCau,
} from "./shared/dieu-kien-giao-hang";
import { BangChoLenKeHoach, COT_YC } from "./tabs/BangChoLenKeHoach";
import { BangKeHoach, COT_DON, khoaKhoi } from "./tabs/BangKeHoach";
import type { BuocLuot, FormLuot } from "./shared/helpers";
import { BangNhanVien } from "./tabs/BangNhanVien";
import type { TabId } from "./shared/types";
import "../../rebuild-catalog.css";
import "../../giao-hang.css";
import "../../kho-request.css";

// Phân trang máy chủ (CLAUDE.md/best-practice, khớp Đơn hàng bán + Tính giá). Tab Đơn giao hàng
// đếm theo KHỐI (một lượt = một khối), không theo đơn. Đây là cỡ MẶC ĐỊNH — ô Dòng/trang đổi được.
const PAGE_SIZE = 25;
// Tab "Yêu cầu giao" lọc "chờ lên kế hoạch" ở MÁY CHỦ (NOT EXISTS chuyến, 06/10/2026) nên trang
// hoá + đếm thật như tab Đơn giao hàng; bỏ cửa sổ 200 dòng cắt ở trình duyệt.

// Hàng lọc nhanh tab Đơn giao hàng — mỗi nhóm là một TẬP trạng thái chuyến, khớp `NHOM_TINH_TRANG`
// ở máy chủ (routers/delivery.py). Bấm nhóm = đặt đúng tập đó vào ô "Trạng thái" của nút Lọc.
const NHOM_DON: { key: string; label: string; mau?: MauTT; tts: string[] }[] = [
  { key: "", label: "Tất cả", tts: [] },
  { key: "chuan_bi", label: "Đang chuẩn bị", mau: "vang", tts: ["da_len_ke_hoach", "dang_chuan_bi", "da_lay_hang"] },
  { key: "dang_giao", label: "Đang giao", mau: "cyan", tts: ["dang_giao"] },
  { key: "da_giao", label: "Đã giao", mau: "la", tts: ["thanh_cong"] },
  { key: "giao_thieu", label: "Giao thiếu", mau: "cam", tts: ["giao_thieu"] },
  { key: "that_bai", label: "Thất bại", mau: "do", tts: ["that_bai", "dang_tra_hang", "da_tra_hang"] },
];
/** Nhóm đang bật theo ô Trạng thái; chọn tay một tập khác mọi nhóm thì không nhóm nào sáng. */
function nhomDonDang(tts: string[]): string {
  const k = [...tts].sort().join(",");
  return NHOM_DON.find((n) => [...n.tts].sort().join(",") === k)?.key ?? "khac";
}
// Hàng lọc nhanh tab Yêu cầu giao — theo hạn cần giao, giờ Việt Nam (máy chủ lọc + đếm).
const NHOM_HAN: { key: string; label: string; mau?: MauTT }[] = [
  { key: "", label: "Tất cả" },
  { key: "qua_han", label: "Quá hẹn", mau: "do" },
  { key: "hom_nay", label: "Hôm nay", mau: "vang" },
  { key: "ngay_mai", label: "Ngày mai", mau: "xanh" },
  { key: "sau", label: "Sau đó", mau: "slate" },
];

/** Chữ ô tìm gửi máy chủ chậm một nhịp — gõ "DH-0012" không bắn bảy lượt tải cả bảng khối. */
function useTre(chu: string, ms = 300): string {
  const [tre, setTre] = useState(chu);
  useEffect(() => {
    const h = window.setTimeout(() => setTre(chu), ms);
    return () => window.clearTimeout(h);
  }, [chu, ms]);
  return tre;
}

export default function GiaoHangPage({ eventTick = 0 }: { eventTick?: number }) {
  const { token, user } = useAuth();
  const can = useCan();
  const canPlan = can("giao_hang", "plan");
  const canViewDrivers = can("giao_hang", "view_drivers");
  const canWrite = can("giao_hang", "create");
  const canCancel = can("giao_hang", "cancel");

  // Mặc định Yêu cầu giao; người không có ô `plan` thì `tabDang` rơi về Đơn giao hàng.
  const [tab, setTab] = useState<TabId>("cho-len-ke-hoach");
  const [khoi, setKhoi] = useState<BangGiaoItem[]>([]);
  const [khoiPage, setKhoiPage] = useState(1);
  const [khoiSize, setKhoiSize] = useState(PAGE_SIZE);
  const [khoiTotal, setKhoiTotal] = useState(0);
  const [soDon, setSoDon] = useState(0);
  const [demTinhTrang, setDemTinhTrang] = useState<Record<string, number>>({});
  const [demHan, setDemHan] = useState<Record<string, number>>({});
  // Hàng lọc nhanh "Cần giao" của tab Yêu cầu giao ("" = tất cả).
  const [han, setHan] = useState("");
  const luoiDon = useCauHinhLuoi("giao-hang-don");
  const luoiYc = useCauHinhLuoi("giao-hang-yc");
  const [choLenKeHoachRows, setChoLenKeHoachRows] = useState<DeliveryRequest[]>([]);
  const [reqPage, setReqPage] = useState(1);
  const [reqSize, setReqSize] = useState(PAGE_SIZE);
  const [reqTotal, setReqTotal] = useState(0);
  const [drivers, setDrivers] = useState<DeliveryDriver[]>([]);
  const [detail, setDetail] = useState<DeliveryRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Lên đơn: MỘT yêu cầu (nút ở dòng) hoặc NHIỀU yêu cầu chung một lượt xe (tick + "Lên lượt xe").
  const [planFor, setPlanFor] = useState<
    { requests: DeliveryRequest[]; theoLuot: boolean } | null
  >(null);
  // Lượt vừa lập — khối của nó được làm nổi + cuộn tới (lên đơn đã gửi kho, chờ kho xuất).
  const [luotMoi, setLuotMoi] = useState<number | null>(null);
  const [ketQuaFor, setKetQuaFor] = useState<DeliveryTrip | null>(null);
  const [doiFor, setDoiFor] = useState<DeliveryTrip | null>(null);
  // Ngăn chi tiết của MỘT dòng tab Đơn giao hàng. Giữ bản chụp cuối: bảng tải lại (SSE, lọc) mà
  // dòng rơi khỏi trang thì ngăn vẫn đứng, không tự đóng giữa lúc người ta đang đọc.
  const [ngan, setNgan] = useState<{ khoa: string; form: FormLuot | null } | null>(null);
  const [nganItem, setNganItem] = useState<BangGiaoItem | null>(null);
  // Báo của nút bước kế tiếp bấm ngay trên dòng bảng (ngăn có dòng báo riêng của nó), và báo
  // "đã gửi kho" sau khi lên đơn.
  const [tin, setTin] = useState<string | null>(null);
  const [canhBaoDong, setCanhBaoDong] = useState<string[]>([]);
  // Tháng đang xem ở tab Nhân viên. `YYYY-MM` theo giờ ĐỊA PHƯƠNG — `toISOString()` trả UTC nên
  // đầu/cuối tháng có thể nhảy sang tháng bên cạnh.
  const [thang, setThang] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  // Kỳ + điều kiện của HAI tab danh sách — ghi lên URL (`?man=giao-hang`), nhớ khi sang màn khác.
  const [locMan, setLocMan] = useLocMan("giao-hang", LOC_GH_TRONG, locGHTuUrl, locGHLenUrl);
  const dkDon = useDieuKienDonGiao();
  const dkYc = useDieuKienYeuCau();
  const [timDon, setTimDon] = useState("");
  const [timYc, setTimYc] = useState("");
  const qDon = useTre(timDon.trim());
  const qYc = useTre(timYc.trim());
  const khoaDon = JSON.stringify({
    q: qDon || undefined, ...thamSoKy(locMan.kyDon), ...thamSoLocDon(locMan.locDon),
  });
  const khoaYc = JSON.stringify({
    q: qYc || undefined, ...thamSoKy(locMan.kyYc), ...thamSoLocYC(locMan.locYc), han: han || undefined,
  });
  // Đổi lọc ⇒ về trang 1 (đang ở trang 5 mà lọc còn 2 trang là bảng trống).
  useEffect(() => setKhoiPage(1), [khoaDon]);
  useEffect(() => setReqPage(1), [khoaYc]);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const viec: Promise<unknown>[] = [
      api.giaoHang
        .bangGiao(token, { page: khoiPage, size: khoiSize, loc: JSON.parse(khoaDon) })
        .then((r) => {
          setKhoi(r.items);
          setKhoiTotal(r.total);
          setSoDon(r.so_don);
          setDemTinhTrang(r.dem_tinh_trang ?? {});
        }),
      api.giaoHang
        .requests(token, {
          choLenKeHoach: true, page: reqPage, size: reqSize, loc: JSON.parse(khoaYc),
        })
        .then((r) => {
          setReqTotal(r.total);
          setChoLenKeHoachRows(r.items);
          setDemHan(r.dem_han ?? {});
        }),
    ];
    // Tab nào không có ô thì KHÔNG gọi — gọi rồi nuốt 403 là che mất lỗi cấu hình thật.
    if (canViewDrivers)
      viec.push(api.giaoHang.nhanVien(token, { thang }).then((r) => setDrivers(r.items)));
    Promise.all(viec)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Không tải được dữ liệu"))
      .finally(() => setLoading(false));
    // `thang` PHẢI có ở đây — thiếu thì đổi tháng mà bảng đứng im.
  }, [token, canViewDrivers, thang, khoiPage, khoiSize, reqPage, reqSize, khoaDon, khoaYc]);

  // `eventTick` tăng mỗi sự kiện SSE ⇒ bảng tự tải lại. Tài xế không phải F5 để biết kho đã
  // soạn xong hàng chưa (CLAUDE.md: gửi/thông báo nội bộ phải tức thì).
  useEffect(() => {
    load();
  }, [load, eventTick]);

  // Khoá của ngăn vừa huỷ chuyến trong đó: lượt chỉ có chuyến ấy thì máy chủ xoá lượt, lần nạp sau
  // không còn khối này ⇒ đóng ngăn, đừng để nó đứng mãi ở "Chờ kho xuất" (#33, 18/10/2026). Chỉ đóng
  // theo thao tác huỷ của chính người này — khối lệch sang trang khác vì người khác lên đơn thì giữ.
  const dongKhiMat = useRef<string | null>(null);
  useEffect(() => {
    if (!ngan) return;
    const it = khoi.find((k) => khoaKhoi(k) === ngan.khoa);
    if (it) setNganItem(it);
    else if (dongKhiMat.current === ngan.khoa) {
      dongKhiMat.current = null;
      setNgan(null);
    }
  }, [ngan, khoi]);

  useEffect(() => {
    if (!tin) return;
    const h = window.setTimeout(() => setTin(null), 8000);
    return () => window.clearTimeout(h);
  }, [tin]);

  // Nổi một lúc rồi thôi — để lâu thì dòng đó trông như "có gì bất thường".
  useEffect(() => {
    if (luotMoi == null) return;
    const h = window.setTimeout(() => setLuotMoi(null), 6000);
    return () => window.clearTimeout(h);
  }, [luotMoi]);

  /** Gọi một hành động rồi tải lại; lỗi hiện lên banner thay vì nuốt im. Trả Promise để nút tự
   *  khoá tới khi lệnh xong (bấm hai lần liền là hai lệnh). */
  const lam = useCallback(
    (viec: Promise<unknown>, loiMacDinh: string) =>
      viec
        .then(load)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : loiMacDinh)),
    [load],
  );

  const lamLuot = useCallback(
    (b: Extract<BuocLuot, { lam: unknown }>) => {
      if (!token) return Promise.resolve();
      setTin(null);
      setCanhBaoDong([]);
      setError(null);
      return b.lam(token)
        .then((r) => {
          setTin(b.bao(r));
          setCanhBaoDong(r.canh_bao);
          load();
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "Không thao tác được"));
    },
    [token, load],
  );

  const moNgan = (it: BangGiaoItem, form?: FormLuot) => {
    setNgan({ khoa: khoaKhoi(it), form: form ?? null });
    setNganItem(it);
  };
  const viTriNgan = ngan ? khoi.findIndex((k) => khoaKhoi(k) === ngan.khoa) : -1;

  const moChiTiet = useCallback(
    (requestId: number) => {
      if (!token) return;
      api.giaoHang
        .request(token, requestId)
        .then(setDetail)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "Không mở được chi tiết"));
    },
    [token],
  );

  const viTriYc = detail ? choLenKeHoachRows.findIndex((r) => r.id === detail.request.id) : -1;

  const tabs: { id: TabId; label: string; count: number; hien: boolean }[] = [
    {
      id: "cho-len-ke-hoach",
      label: "Yêu cầu giao",
      count: reqTotal,
      hien: canPlan,
    },
    { id: "ke-hoach", label: "Đơn giao hàng", count: soDon, hien: true },
    { id: "nhan-vien", label: "Nhân viên giao hàng", count: drivers.length, hien: canViewDrivers },
  ];
  const tabHien = tabs.filter((t) => t.hien);
  const tabDang = tabHien.some((t) => t.id === tab) ? tab : "ke-hoach";

  // Chấm "có yêu cầu MỚI chưa xem" (luật chung: nhìn thấy bản ghi trên danh sách là đã xem).
  // Đứng ở tab Yêu cầu giao ⇒ mọi yêu cầu đang hiện coi như đã thấy, chấm tắt ngay; yêu cầu mới
  // tới (SSE) lúc đang ở tab khác thì chấm bật lại. Mốc "đã xem tới id nào" giữ theo từng người
  // trong trình duyệt — giao hàng chưa có sổ đã-xem ở máy chủ.
  const khoaDaXem = `gh-yc-da-xem:${user?.id ?? ""}`;
  const docDaXem = (khoa: string) => {
    try {
      return Number(window.localStorage.getItem(khoa)) || 0;
    } catch {
      return 0;
    }
  };
  const [daXemDen, setDaXemDen] = useState(() => docDaXem(khoaDaXem));
  useEffect(() => setDaXemDen(docDaXem(khoaDaXem)), [khoaDaXem]);
  const ycMoiNhat = choLenKeHoachRows.reduce((m, r) => Math.max(m, r.id), 0);
  useEffect(() => {
    if (tabDang !== "cho-len-ke-hoach" || ycMoiNhat <= daXemDen) return;
    setDaXemDen(ycMoiNhat);
    try {
      window.localStorage.setItem(khoaDaXem, String(ycMoiNhat));
    } catch {
      /* chế độ riêng tư chặn lưu — chấm vẫn tắt trong phiên này */
    }
  }, [tabDang, ycMoiNhat, daXemDen, khoaDaXem]);
  const coYcMoi = tabDang !== "cho-len-ke-hoach" && ycMoiNhat > daXemDen;

  // Nạp TRƯỚC nguồn của ngăn Lên đơn (xe, lượt mở, người, trạng thái) khi đứng ở tab Yêu cầu giao —
  // bấm "Lên đơn giao" là hai danh sách có ngay, không hiện sau cột phải. SSE tới thì nạp lại cho tươi.
  const oTabYc = tabDang === "cho-len-ke-hoach";
  useEffect(() => {
    if (token && canPlan && oTabYc) void napNguonLenDon(token);
  }, [token, canPlan, oTabYc, eventTick]);

  return (
    // `.rc` là KHUNG TRANG (max-width 1200 · canh giữa · padding) — màn top-level nào cũng phải
    // có. `.kho-list` chỉ là móc chỉnh bảng của ba màn Kho, KHÔNG mang layout: để mình nó thì nội
    // dung dán sát hai mép màn hình. Ba màn Kho không lộ ra lỗi này vì `KhoPage` bọc `.rc` sẵn.
    <main className="rc lds">
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Giao hàng</h1>
        <div className="gh-seg" role="tablist">
          {tabHien.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tabDang === t.id}
              className={`gh-seg__btn${tabDang === t.id ? " is-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {/* Tab không mang số đếm (luật chung): có yêu cầu mới chưa xem thì một chấm nhỏ. */}
              {t.id === "cho-len-ke-hoach" && coYcMoi && (
                <span className="gh-seg__cham" aria-label="Có yêu cầu mới chưa xem" />
              )}
            </button>
          ))}
        </div>
        <div className="lds-dau__nut">
          <button type="button" className="lds-btn" onClick={load}>
            <Icon name="refresh" size={14} /> Tải lại
          </button>
        </div>
      </header>

      {error && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {tin && (
        <div className="banner banner--success" role="status">{tin}</div>
      )}
      {tabDang === "ke-hoach" && canhBaoDong.map((c) => (
        <div key={c} className="banner banner--warn" role="status">{c}</div>
      ))}

      {/* Khung lọc của tab đang mở — mỗi tab một bộ riêng (mốc ngày, điều kiện khác). Hàng lọc nhanh:
          tab Đơn giao hàng theo nhóm tình trạng (đặt thẳng vào ô Trạng thái của nút Lọc — một state
          lọc), tab Yêu cầu giao theo hạn cần giao. Số đếm ở máy chủ. */}
      {tabDang === "ke-hoach" && (
        <section className="lds-loc">
          <LocNhanhTrangThai
            muc={NHOM_DON.map((n) => ({
              key: n.key, label: n.label, mau: n.mau,
              count: n.key ? demTinhTrang[n.key] : locMan.locDon.trang_thai.length === 0 ? soDon : undefined,
            }))}
            dang={nhomDonDang(locMan.locDon.trang_thai)}
            onChon={(k) => setLocMan({
              ...locMan, locDon: { ...locMan.locDon, trang_thai: [...(NHOM_DON.find((n) => n.key === k)?.tts ?? [])] },
            })}
            ariaLabel="Lọc nhanh theo tình trạng"
          />
          <div className="lds-loc__thanh tl-thanh" role="search">
            <OTim value={timDon} onChange={setTimDon} placeholder="Tìm mã lượt, yêu cầu, đơn, khách" ariaLabel="Tìm đơn giao hàng" />
            <ThanhLoc
              ky={locMan.kyDon}
              moc={MOC_DON}
              onKy={(kyDon) => setLocMan({ ...locMan, kyDon })}
              dieuKien={dkDon}
              loc={locMan.locDon}
              onLoc={(locDon) => setLocMan({ ...locMan, locDon })}
            />
            <ChonCot cot={COT_DON} {...luoiDon.chonCot} />
          </div>
        </section>
      )}
      {tabDang === "cho-len-ke-hoach" && (
        <section className="lds-loc">
          <LocNhanhTrangThai
            muc={NHOM_HAN.map((n) => ({
              key: n.key, label: n.label, mau: n.mau,
              count: n.key ? demHan[n.key] ?? 0 : Object.values(demHan).reduce((a, b) => a + b, 0),
            }))}
            dang={han}
            onChon={setHan}
            ariaLabel="Lọc nhanh theo hạn cần giao"
          />
          <div className="lds-loc__thanh tl-thanh" role="search">
            <OTim value={timYc} onChange={setTimYc} placeholder="Tìm mã yêu cầu, đơn, khách" ariaLabel="Tìm yêu cầu giao" />
            <ThanhLoc
              ky={locMan.kyYc}
              moc={MOC_YC}
              onKy={(kyYc) => setLocMan({ ...locMan, kyYc })}
              dieuKien={dkYc}
              loc={locMan.locYc}
              onLoc={(locYc) => setLocMan({ ...locMan, locYc })}
            />
            <ChonCot cot={COT_YC} {...luoiYc.chonCot} />
          </div>
        </section>
      )}

      {tabDang === "ke-hoach" && token && (
        <BangKeHoach items={khoi} loading={loading} coLoc={khoaDon !== "{}"}
          canWrite={canWrite} luotMoi={luotMoi}
          dangMo={ngan?.khoa ?? null} onMoNgan={moNgan} onLamLuot={lamLuot}
          luoi={luoiDon}
          cotAn={luoiDon.an}
          thuTu={luoiDon.thuTu}
          onKetQua={canWrite ? setKetQuaFor : undefined}
          onBatDau={canWrite
            ? (t) => lam(api.giaoHang.batDauGiao(token, t.id), "Không bắt đầu giao được")
            : undefined}
          onDaTra={canWrite
            ? (t) => lam(api.giaoHang.daTraHang(token, t.id), "Không lập được phiếu trả kho")
            : undefined}
          // Máy chủ cắt trang theo KHỐI (một lượt xe = một khối, chuyến ngoài lượt cũng một khối)
          // nên tổng & số trang phải đếm khối. Số đơn giao vẫn nói kèm ở ghi chú.
          pheTrang={!error && khoiTotal > 0 ? (
            <PhanTrangDayDu
              trang={khoiPage}
              size={khoiSize}
              tong={khoiTotal}
              soDong={khoi.length}
              onTrang={setKhoiPage}
              onSize={(n) => {
                setKhoiSize(n);
                setKhoiPage(1);
              }}
              loading={loading}
              donVi="lượt giao"
              ghiChu={`gồm ${soDon} đơn giao`}
              ariaLabel="Phân trang đơn giao hàng"
            />
          ) : null}
        />
      )}

      {tabDang === "cho-len-ke-hoach" && (
        <BangChoLenKeHoach rows={choLenKeHoachRows} loading={loading} coLoc={khoaYc !== "{}"}
          luoi={luoiYc}
          cotAn={luoiYc.an}
          thuTu={luoiYc.thuTu}
          onMo={moChiTiet}
          onLenKeHoach={(r) => setPlanFor({ requests: [r], theoLuot: false })}
          onLenLuot={(rs) => setPlanFor({ requests: rs, theoLuot: true })}
          pheTrang={!error && reqTotal > 0 ? (
            <PhanTrangDayDu
              trang={reqPage}
              size={reqSize}
              tong={reqTotal}
              soDong={choLenKeHoachRows.length}
              onTrang={setReqPage}
              onSize={(n) => {
                setReqSize(n);
                setReqPage(1);
              }}
              loading={loading}
              donVi="yêu cầu"
              ariaLabel="Phân trang yêu cầu giao"
            />
          ) : null}
        />
      )}

      {tabDang === "nhan-vien" && (
        <BangNhanVien rows={drivers} loading={loading} thang={thang} onDoiThang={setThang} />
      )}

      {detail && (
        <DrawerChiTiet
          key={detail.request.id}
          detail={detail}
          canCancel={canCancel}
          onClose={() => setDetail(null)}
          onHuy={
            canCancel && token
              ? (lyDo) =>
                  api.giaoHang
                    .cancelRequest(token, detail.request.id, lyDo)
                    .then(() => {
                      setDetail(null);
                      load();
                    })
              : undefined
          }
          onLenDon={
            canPlan && detail.request.trang_thai === "cho_len_ke_hoach" && detail.trips.length === 0
              ? () => {
                  setPlanFor({ requests: [detail.request], theoLuot: false });
                  setDetail(null);
                }
              : undefined
          }
          // ↑ ↓ đi theo đúng trang yêu cầu đang xem (mở từ tab Yêu cầu giao).
          len={viTriYc > 0 ? () => moChiTiet(choLenKeHoachRows[viTriYc - 1].id) : undefined}
          xuong={viTriYc >= 0 && viTriYc < choLenKeHoachRows.length - 1
            ? () => moChiTiet(choLenKeHoachRows[viTriYc + 1].id) : undefined}
        />
      )}

      {/* Ngăn đứng TRƯỚC ba hộp thoại trong DOM: cùng z-index thì hộp mở sau (Nhập kết quả, Đổi /
          huỷ…) nằm trên ngăn. */}
      {ngan && nganItem && token && (
        <NganLuot
          key={ngan.khoa}
          item={nganItem}
          token={token}
          canWrite={canWrite}
          formDau={ngan.form}
          onDoi={load}
          onDong={() => setNgan(null)}
          len={viTriNgan > 0 ? () => moNgan(khoi[viTriNgan - 1]) : undefined}
          xuong={viTriNgan >= 0 && viTriNgan < khoi.length - 1 ? () => moNgan(khoi[viTriNgan + 1]) : undefined}
          onKetQua={canWrite ? setKetQuaFor : undefined}
          onBatDau={canWrite
            ? (t) => lam(api.giaoHang.batDauGiao(token, t.id), "Không bắt đầu giao được")
            : undefined}
          onDaTra={canWrite
            ? (t) => lam(api.giaoHang.daTraHang(token, t.id), "Không lập được phiếu trả kho")
            : undefined}
          onDoiChuyen={canPlan ? setDoiFor : undefined}
        />
      )}

      {planFor && token && (
        <DialogLenKeHoach
          requests={planFor.requests}
          theoLuot={planFor.theoLuot}
          token={token}
          onClose={() => setPlanFor(null)}
          onXong={(luotId, phieu) => {
            setPlanFor(null);
            // Lên đơn = gửi kho luôn (12/10/2026) — nói mã đề nghị để điều phối biết kho đã nhận.
            setCanhBaoDong([]);
            setTin(phieu.length
              ? `Đã lên đơn và gửi kho ${phieu.length > 1 ? `${phieu.length} đề nghị xuất` : "đề nghị xuất"} ${phieu.join(", ")}. Kho ghi sổ xuất xong thì chuyến tự sang Đã lấy hàng.`
              : "Đã lên đơn giao hàng.");
            // Lên lượt xong ⇒ về tab Đơn giao hàng, dòng lượt đó nổi lên.
            if (luotId != null) {
              setTab("ke-hoach");
              setKhoiPage(1);
              setLuotMoi(luotId);
            }
            load();
          }}
        />
      )}

      {doiFor && token && (
        <DialogDoiChuyen
          trip={doiFor}
          token={token}
          onClose={() => setDoiFor(null)}
          onXong={(daHuy) => {
            if (daHuy) {
              setTin(`Đã huỷ chuyến ${doiFor.request_code}.`);
              if (ngan) dongKhiMat.current = ngan.khoa;
            }
            setDoiFor(null);
            load();
          }}
        />
      )}

      {ketQuaFor && token && (
        <DialogKetQua
          trip={ketQuaFor}
          luotCt={khoi.find((k) => k.luot?.diem.some((d) => d.id === ketQuaFor.id))?.luot ?? null}
          token={token}
          onClose={() => setKetQuaFor(null)}
          onXong={() => {
            setKetQuaFor(null);
            load();
          }}
        />
      )}
    </main>
  );
}

// XẾP LỊCH — bàn HẸN ĐẨY (08/11/2026, mockup `docs/mockups/xep-lich-hen-day-B-day-du.html`, spec
// `docs/design-go-toc-do-may-va-xep-lich.md`). Người điều phối hẹn giờ đẩy cho lệnh; tới giờ máy chủ
// tự đẩy bằng quyền người hẹn, không hỏi lại. Bốn tab có số đếm từ máy chủ; tìm, lọc, sắp xếp, cắt
// trang đều ở máy chủ. Thay cho Gantt kéo thả cũ (tốc độ máy đã gỡ nên không còn giờ chạy để vẽ).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, RotateCcw, Search, Send, X } from "lucide-react";

import {
  ApiError, api,
  type XlBan as BanData, type XlGoiPhatHanh, type XlLichSuHen, type XlLocBan, type XlLocBanDu, type XlNganHen as NganData, type XlTab,
} from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useCan } from "../auth/permissions";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PhanTrangDayDu } from "../components/PhanTrangDayDu";
import { useDebounced } from "../utils/useDebounced";
import { XlBan } from "./XlBan";
import { XlHenGio } from "./XlHenGio";
import { XlKhoangNgay } from "./XlKhoangNgay";
import { XlNganHen } from "./XlNganHen";
import { cauBaoPhatHanh } from "./cauBaoPhatHanh";
import { soNgayGiua, themNgay, ymd } from "./xlShared";
import "./ke-toan/ke-toan.css";
import "./xep-lich-a.css";
import "./xep-lich-hen.css";

const TAB: { id: XlTab; ten: string; dot?: string }[] = [
  { id: "ket", ten: "Kẹt, chưa đẩy được", dot: "var(--tt-do-dot)" },
  { id: "chua_hen", ten: "Chưa hẹn giờ" },
  { id: "da_hen", ten: "Đã hẹn, chờ tự đẩy" },
  { id: "da_day", ten: "Đã đẩy" },
];
type Loc = { gap: boolean; thieu_vat_tu: boolean; sat_han: boolean };
const LOC_TRONG: Loc = { gap: false, thieu_vat_tu: false, sat_han: false };
const LOC_NHANH: { k: keyof Loc; ten: string; dot: string }[] = [
  { k: "gap", ten: "Gấp", dot: "var(--tt-cam-dot)" },
  { k: "thieu_vat_tu", ten: "Chưa đủ vật tư", dot: "var(--tt-vang-dot)" },
  { k: "sat_han", ten: "Sát hạn giao", dot: "var(--tt-do-dot)" },
];
type Bao = { chu: string; loi?: boolean; giai?: string };

/** "08/11 – 21/11/2026" (khác năm thì ghi đủ năm cả hai đầu) — chữ trên nút khoảng ngày, như mockup B. */
export function chuKhoang(tu: string, den: string): string {
  const dm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  return tu.slice(0, 4) === den.slice(0, 4)
    ? `${dm(tu)} – ${dm(den)}/${den.slice(0, 4)}`
    : `${dm(tu)}/${tu.slice(0, 4)} – ${dm(den)}/${den.slice(0, 4)}`;
}

/** Hộp hẹn giờ đang mở cho ai: các lệnh đã tick, cả tập theo bộ lọc, hay một lệnh ở ngăn. */
type Hen = { kieu: "chon"; ids: number[] } | { kieu: "loc"; so: number } | { kieu: "mot"; id: number; cu: string | null };

export function XepLichPage({
  eventTick = 0,
  onBadgeStale,
  navigate,
}: {
  eventTick?: number;
  onBadgeStale?: () => void;
  navigate?: (id: string, params?: Record<string, unknown>) => void;
}) {
  const { token } = useAuth();
  const can = useCan();
  const duyetDuoc = can("xep_lich", "approve");
  const homNay = ymd(new Date());

  // ---------------------------------------------------------------- tab + khoảng ngày
  const [tab, setTabGoc] = useState<XlTab>("chua_hen");
  const daChonTab = useRef(false);
  // Hai khoảng riêng: ba tab chờ đẩy nhìn tới (hôm nay → +13), tab Đã đẩy nhìn lùi (−13 → hôm nay).
  const [khoangToi, setKhoangToi] = useState<[string, string]>(() => [homNay, themNgay(homNay, 13)]);
  const [khoangQua, setKhoangQua] = useState<[string, string]>(() => [themNgay(homNay, -13), homNay]);
  const [tu, den] = tab === "da_day" ? khoangQua : khoangToi;
  const setKhoang = (a: string, b: string) => (tab === "da_day" ? setKhoangQua([a, b]) : setKhoangToi([a, b]));
  const soNgay = soNgayGiua(tu, den);
  const [moKhoang, setMoKhoang] = useState(false);
  const luiTien = (h: 1 | -1) => setKhoang(themNgay(tu, h * soNgay), themNgay(den, h * soNgay));
  const veHomNay = () => (tab === "da_day"
    ? setKhoang(themNgay(homNay, -(soNgay - 1)), homNay)
    : setKhoang(homNay, themNgay(homNay, soNgay - 1)));
  const coHomNay = homNay >= tu && homNay <= den;

  // ---------------------------------------------------------------- lọc + trang
  const [tim, setTim] = useState("");
  const timCho = useDebounced(tim, 300);
  const [loc, setLoc] = useState<Loc>(LOC_TRONG);
  const [trang, setTrang] = useState(1);
  const [moiTrang, setMoiTrang] = useState(25);
  // tu/den luôn là khoảng tới (lọc giờ hẹn), day_tu/day_den luôn là khoảng lùi (lọc lúc đẩy): máy chủ
  // đếm mỗi tab theo khoảng của chính nó, nên số trên tab khớp số dòng khi bấm vào dù đang ở tab nào.
  const thamSo: XlLocBan = useMemo(
    () => ({ tab, tu: khoangToi[0], den: khoangToi[1], tim: timCho || undefined, ...loc }),
    [tab, khoangToi, timCho, loc],
  );
  const khoaLoc = JSON.stringify({ ...thamSo, day_tu: khoangQua[0], day_den: khoangQua[1] });
  useEffect(() => setTrang(1), [khoaLoc]);

  // ---------------------------------------------------------------- dữ liệu
  const [ban, setBan] = useState<BanData | null>(null);
  const [dangTai, setDangTai] = useState(false);
  const [nhip, setNhip] = useState(0);
  const lamMoi = useCallback(() => setNhip((n) => n + 1), []);
  const [bao, setBao] = useState<Bao | null>(null);
  useEffect(() => {
    if (!bao) return;
    const h = window.setTimeout(() => setBao(null), bao.loi ? 10_000 : 6_000);
    return () => window.clearTimeout(h);
  }, [bao]);

  useEffect(() => {
    if (!token) return;
    let huy = false;
    setDangTai(true);
    api.xepLich.ban(token, { ...(JSON.parse(khoaLoc) as XlLocBanDu), trang, moi_trang: moiTrang })
      .then((r) => {
        if (huy) return;
        setBan(r);
        // Mở màn: vào Kẹt nếu có lệnh kẹt, không thì Chưa hẹn giờ (người dùng đã bấm tab thì thôi).
        if (!daChonTab.current) {
          daChonTab.current = true;
          if (r.dem_tab.ket > 0 && tab !== "ket") setTabGoc("ket");
        }
      })
      .catch((e) => !huy && setBao({ chu: e instanceof ApiError ? e.message : "Không tải được bàn xếp lịch.", loi: true }))
      .finally(() => !huy && setDangTai(false));
    return () => { huy = true; };
    // SSE `xep_lich_changed` tăng eventTick ⇒ nạp lại đúng trang + bộ lọc đang xem.
  }, [token, khoaLoc, trang, moiTrang, eventTick, nhip, tab]);

  const setTab = (t: XlTab) => {
    daChonTab.current = true;
    setTabGoc(t);
    setChon(new Set());
    setTheoLoc(false);
  };

  // ---------------------------------------------------------------- chọn
  const [chon, setChon] = useState<Set<number>>(new Set());
  const [theoLoc, setTheoLoc] = useState(false);
  useEffect(() => { setChon(new Set()); setTheoLoc(false); }, [khoaLoc]);
  const dong = ban?.dong ?? [];
  const choDay = tab !== "da_day";
  const coChon = duyetDuoc && choDay;
  const daChonCaTrang = dong.length > 0 && dong.every((d) => chon.has(d.lsx_id));
  const soChon = theoLoc ? (ban?.tong ?? 0) : chon.size;
  const doiChon = (id: number) => {
    setTheoLoc(false);
    setChon((s) => { const m = new Set(s); if (m.has(id)) m.delete(id); else m.add(id); return m; });
  };
  const chonTrang = (het: boolean) => {
    setTheoLoc(false);
    setChon(het ? new Set(dong.map((d) => d.lsx_id)) : new Set());
  };
  const boChon = () => { setChon(new Set()); setTheoLoc(false); };

  // ---------------------------------------------------------------- ngăn
  const [chonId, setChonId] = useState<number | null>(null);
  const [ngan, setNgan] = useState<NganData | null>(null);
  const [lichSu, setLichSu] = useState<XlLichSuHen[] | null>(null);
  const [goi, setGoi] = useState<XlGoiPhatHanh | null>(null);
  const [taiNgan, setTaiNgan] = useState(false);
  const [loiNgan, setLoiNgan] = useState(false);
  useEffect(() => {
    if (!token || chonId === null) { setNgan(null); setLichSu(null); setGoi(null); return; }
    let huy = false;
    setTaiNgan(true);
    setLoiNgan(false);
    api.xepLich.ngan(token, chonId)
      .then((r) => {
        if (huy) return;
        setNgan(r);
        const daDay = r.dau.trang_thai === "da_phat_hanh" || r.dau.trang_thai === "da_dong";
        if (daDay) api.xepLich.goiPhatHanh(token, chonId).then((g) => !huy && setGoi(g)).catch(() => !huy && setGoi(null));
        else setGoi(null);
      })
      .catch(() => !huy && setLoiNgan(true))
      .finally(() => !huy && setTaiNgan(false));
    api.xepLich.lichSuHen(token, chonId).then((r) => !huy && setLichSu(r)).catch(() => !huy && setLichSu([]));
    return () => { huy = true; };
  }, [token, chonId, eventTick, nhip]);
  const viTri = chonId === null ? -1 : dong.findIndex((d) => d.lsx_id === chonId);

  // ---------------------------------------------------------------- ghi
  const [dangGhi, setDangGhi] = useState(false);
  const [hen, setHen] = useState<Hen | null>(null);
  const [loiHen, setLoiHen] = useState<string | null>(null);
  const xong = useCallback(() => { lamMoi(); onBadgeStale?.(); }, [lamMoi, onBadgeStale]);

  const moHen = () => {
    setLoiHen(null);
    setHen(theoLoc ? { kieu: "loc", so: ban?.tong ?? 0 } : { kieu: "chon", ids: [...chon] });
  };
  const ghiHen = async (henLuc: string) => {
    if (!token || !hen) return;
    setDangGhi(true);
    setLoiHen(null);
    try {
      const r = hen.kieu === "loc"
        ? await api.xepLich.henTheoLoc(token, thamSo, henLuc)
        : await api.xepLich.hen(token, hen.kieu === "mot" ? [hen.id] : hen.ids, henLuc);
      setBao({ chu: `Đã hẹn đẩy ${r.so_lenh} lệnh lúc ${henLuc.slice(11, 16)} ${henLuc.slice(8, 10)}/${henLuc.slice(5, 7)}.` });
      setHen(null);
      if (hen.kieu !== "mot") boChon();
      xong();
    } catch (e) {
      setLoiHen(e instanceof ApiError ? e.message : "Không hẹn được giờ.");
    } finally {
      setDangGhi(false);
    }
  };

  const dayNgay = async (ids: number[]) => {
    if (!token || ids.length === 0) return;
    setDangGhi(true);
    try {
      const r = await api.xepLich.dayNgay(token, ids);
      const ok = r.da_day.length ? cauBaoPhatHanh(r.da_day.length, r.vat_tu) : null;
      const loi = r.loi.length ? ` Chưa đẩy được ${r.loi.map((x) => `${x.ma}: ${x.ly_do}`).join("; ")}` : "";
      setBao({ chu: ((ok?.chu ?? "") + loi).trim(), loi: r.loi.length > 0, giai: ok?.giai });
      boChon();
      xong();
    } catch (e) {
      setBao({ chu: e instanceof ApiError ? e.message : "Không đẩy được lệnh.", loi: true });
    } finally {
      setDangGhi(false);
    }
  };

  const boHen = async () => {
    if (!token || chonId === null) return;
    setDangGhi(true);
    try {
      await api.xepLich.boHen(token, chonId);
      setBao({ chu: `Đã bỏ hẹn ${ngan?.dau.ma ?? ""}, lệnh về tab Chưa hẹn giờ.` });
      xong();
    } catch (e) {
      setBao({ chu: e instanceof ApiError ? e.message : "Không bỏ được hẹn.", loi: true });
    } finally {
      setDangGhi(false);
    }
  };

  // Thu hồi / Đẩy cập nhật (lệnh đã đẩy) — dùng lại đường có sẵn, bắt gõ lý do.
  const [prompt, setPrompt] = useState<"thu_hoi" | "cap_nhat" | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [loiLyDo, setLoiLyDo] = useState<string | null>(null);
  const moPrompt = (p: "thu_hoi" | "cap_nhat") => { setLyDo(""); setLoiLyDo(null); setPrompt(p); };
  const xacNhanPrompt = async () => {
    if (!token || chonId === null || !prompt) return;
    const ld = lyDo.trim();
    if (ld.length < 3) { setLoiLyDo("Vui lòng nhập lý do dài ít nhất 3 ký tự."); return; }
    setDangGhi(true);
    try {
      if (prompt === "thu_hoi") {
        const r = await api.xepLich.thuHoi(token, chonId, ld);
        const n = r.cum_lsx?.length ?? 1;
        setBao({ chu: n > 1 ? `Đã thu hồi ${n} lệnh, các lệnh về tab Chưa hẹn giờ.` : "Đã thu hồi, lệnh về tab Chưa hẹn giờ." });
      } else {
        const r = await api.xepLich.phatHanhCapNhat(token, chonId, ld);
        setBao({ chu: `Đã đẩy cập nhật: ${r.so_cong_viec_cap_nhat} việc cập nhật, ${r.so_giu_nguyen} việc đã bắt đầu giữ nguyên.` });
      }
      setPrompt(null);
      xong();
    } catch (e) {
      setLoiLyDo(e instanceof ApiError ? e.message : "Không thực hiện được.");
    } finally {
      setDangGhi(false);
    }
  };

  const coLoc = !!tim || loc.gap || loc.thieu_vat_tu || loc.sat_han;
  const dem = ban?.dem_tab;

  return (
    <div className="xa xh">
      <header className="xa-dau">
        <h1>Xếp lịch</h1>
        {/* Mockup B: ‹ Hôm nay › rồi nút khoảng ngày mở bộ chọn khoảng sẵn có của Xếp lịch. */}
        <div className="xh-dieu-huong">
          <button type="button" className="xa-btn xa-btn--o" aria-label="Khoảng trước" onClick={() => luiTien(-1)}><ChevronLeft size={16} /></button>
          <button type="button" className="xa-btn" onClick={veHomNay}
            title={coHomNay ? "Hôm nay đang nằm trong khoảng xem" : "Về khoảng có hôm nay"}>Hôm nay</button>
          <button type="button" className="xa-btn xa-btn--o" aria-label="Khoảng sau" onClick={() => luiTien(1)}><ChevronRight size={16} /></button>
        </div>
        <button type="button" className={`xa-btn${moKhoang ? " xa-btn--bat" : ""}`} aria-haspopup="dialog" aria-expanded={moKhoang}
          title={`Chọn khoảng ngày (${soNgay} ngày)`} onClick={() => setMoKhoang((m) => !m)}>
          {chuKhoang(tu, den)}<ChevronDown size={14} className="xh-mo" />
        </button>
        {moKhoang && (
          <XlKhoangNgay tu={tu} den={den} onDong={() => setMoKhoang(false)}
            onApDung={(a, b) => { setKhoang(a, b); setMoKhoang(false); }} />
        )}
        <label className="xa-o-tim xh-o-tim">
          <Search size={15} />
          <input value={tim} placeholder="Tìm mã lệnh, sản phẩm, khách" aria-label="Tìm lệnh"
            onChange={(e) => setTim(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setTim(""); }} />
          {tim && (
            <button type="button" className="xa-btn xa-btn--tron" style={{ height: 22, padding: 0 }} aria-label="Xoá ô tìm" onClick={() => setTim("")}><X size={13} /></button>
          )}
        </label>
      </header>

      <div className="xh-tabs" role="tablist" aria-label="Nhóm lệnh">
        {TAB.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
            className={`xh-tab${tab === t.id ? " is-on" : ""}`} onClick={() => setTab(t.id)}>
            {t.dot && (dem?.ket ?? 0) > 0 && <span className="xh-dot" style={{ background: t.dot }} />}
            {t.ten} <span className="xh-n">{(dem?.[t.id] ?? 0).toLocaleString("vi-VN")}</span>
          </button>
        ))}
      </div>

      <div className="xh-loc">
        {LOC_NHANH.filter((l) => l.k !== "thieu_vat_tu" || choDay).map((l) => (
          <button key={l.k} type="button" className="xa-ln" aria-pressed={loc[l.k]}
            onClick={() => setLoc({ ...loc, [l.k]: !loc[l.k] })}>
            <i style={{ background: l.dot }} />{l.ten}<span className="xh-n">{ban?.dem_loc[l.k] ?? 0}</span>
          </button>
        ))}
        {coLoc && <button type="button" className="xa-lk" onClick={() => { setTim(""); setLoc(LOC_TRONG); }}>Xoá bộ lọc</button>}
        <span className="xa-gian" />
        <span className="xh-mo">Sắp xếp</span>
        <span className="xh-sap">
          {tab === "da_hen" ? "Gấp trước, rồi giờ hẹn sớm" : tab === "da_day" ? "Gấp trước, rồi lúc đẩy mới nhất" : "Gấp trước, rồi hạn giao sớm"}
        </span>
      </div>

      {dong.length === 0 ? (
        <p className="xh-trong">
          {dangTai ? "Đang tải" : coLoc ? "Không có lệnh nào khớp bộ lọc."
            : tab === "ket" ? "Không có lệnh nào kẹt." : tab === "chua_hen" ? "Không còn lệnh nào chờ hẹn giờ."
              : tab === "da_hen" ? "Không có lệnh nào hẹn đẩy trong khoảng này." : "Không có lệnh nào đẩy trong khoảng này."}
        </p>
      ) : (
        <XlBan dong={dong} tab={tab} tu={tu} den={den} homNay={homNay} demNgay={ban?.dem_ngay ?? {}}
          coChon={coChon} chon={chon} chonId={chonId} onChon={doiChon} onChonTrang={chonTrang} onMo={setChonId} />
      )}

      {coChon && soChon > 0 && (
        <div className="xh-chon-bar" role="region" aria-label="Lệnh đã chọn">
          <span>{theoLoc ? `Đã chọn cả ${soChon} lệnh theo bộ lọc` : `Đã chọn ${soChon} lệnh trên trang này`}</span>
          {!theoLoc && daChonCaTrang && (ban?.tong ?? 0) > dong.length && (
            <button type="button" className="xa-lk" onClick={() => setTheoLoc(true)}>Chọn cả {ban?.tong} lệnh theo bộ lọc</button>
          )}
          <span className="xa-gian" />
          <button type="button" className="xa-btn" disabled={dangGhi} onClick={moHen}>Hẹn giờ</button>
          <button type="button" className="xa-btn xa-btn--den" disabled={dangGhi || theoLoc}
            title={theoLoc ? "Đẩy ngay làm theo từng trang, chọn các lệnh trên trang rồi bấm" : undefined}
            onClick={() => void dayNgay([...chon])}>Đẩy ngay</button>
          <button type="button" className="xa-btn" onClick={boChon}>Bỏ chọn</button>
        </div>
      )}

      {ban && ban.tong > 0 && (
        <PhanTrangDayDu trang={trang} size={moiTrang} tong={ban.tong} soDong={dong.length} loading={dangTai}
          onTrang={setTrang} onSize={(s) => { setMoiTrang(s); setTrang(1); }} donVi="lệnh" />
      )}

      <footer className="xh-chu-giai">
        <span><span className="xh-k"><span className="xh-cham xh-cham--hen" /></span>Hẹn đẩy, tới giờ tự đẩy</span>
        <span><span className="xh-k"><span className="xh-cham xh-cham--day" /></span>Đã đẩy</span>
        <span><span className="xh-k"><span className="xh-tamgiac" /></span>Vật tư về</span>
        <span><span className="xh-k"><span className="xh-thoi" /></span>Hạn giao khách</span>
        <span><i className="xh-vach-mau" />Còn từ 2 ngày trở xuống tới hạn giao</span>
        <span>Số dưới ngày: số lệnh hẹn đẩy ngày đó theo bộ lọc</span>
      </footer>

      {bao && (
        <div className={`xa-toast${bao.loi ? " xa-toast--loi" : ""}`} role={bao.loi ? "alert" : "status"}>
          <span title={bao.giai}>{bao.chu}</span>
          <button type="button" className="xa-toast__x" aria-label="Đóng thông báo" onClick={() => setBao(null)}><X size={14} /></button>
        </div>
      )}

      {chonId !== null && (
        <XlNganHen
          key={chonId}
          ngan={ngan && ngan.dau.lsx_id === chonId ? ngan : null}
          lichSu={lichSu}
          goi={goi}
          dangTai={taiNgan}
          loi={loiNgan}
          duyetDuoc={duyetDuoc}
          dangGhi={dangGhi}
          onBoHen={() => void boHen()}
          onDoiGio={() => { setLoiHen(null); setHen({ kieu: "mot", id: chonId, cu: ngan?.dau.hen_luc ?? null }); }}
          onDayNgay={() => void dayNgay([chonId])}
          onThuHoi={() => moPrompt("thu_hoi")}
          onCapNhat={() => moPrompt("cap_nhat")}
          onMoHoSo={navigate ? () => navigate("lenh-san-xuat", { openHoSoLsxId: chonId }) : undefined}
          onDong={() => setChonId(null)}
          len={viTri > 0 ? () => setChonId(dong[viTri - 1].lsx_id) : undefined}
          xuong={viTri >= 0 && viTri < dong.length - 1 ? () => setChonId(dong[viTri + 1].lsx_id) : undefined}
        />
      )}

      <XlHenGio
        open={hen !== null}
        soLenh={hen?.kieu === "loc" ? hen.so : hen?.kieu === "chon" ? hen.ids.length : 1}
        giaTriDau={hen?.kieu === "mot" ? hen.cu : null}
        busy={dangGhi}
        loi={loiHen}
        onHen={(g) => void ghiHen(g)}
        onHuy={() => setHen(null)}
      />


      <ConfirmDialog
        open={prompt !== null}
        title={prompt === "thu_hoi" ? "Thu hồi lệnh khỏi xưởng" : "Đẩy cập nhật"}
        icon={prompt === "thu_hoi" ? <RotateCcw size={20} /> : <Send size={20} />}
        message={prompt === "thu_hoi"
          ? `Rút lệnh ${ngan?.dau.ma ?? ""} (và các lệnh đẩy cùng cụm) khỏi xưởng. Lệnh về tab Chưa hẹn giờ, giờ hẹn cũ bỏ.`
          : `Đẩy bản mới của lệnh ${ngan?.dau.ma ?? ""} xuống xưởng cho ${goi?.so_chua_bat_dau ?? 0} việc chưa bắt đầu. ${goi?.so_da_bat_dau ?? 0} việc đã chạy giữ nguyên.`}
        confirmLabel={dangGhi ? "Đang xử lý" : prompt === "thu_hoi" ? "Thu hồi" : "Đẩy cập nhật"}
        cancelLabel="Huỷ"
        danger={prompt === "thu_hoi"}
        busy={dangGhi}
        error={loiLyDo}
        onConfirm={() => void xacNhanPrompt()}
        onCancel={() => setPrompt(null)}
      >
        <label style={{ display: "block", fontSize: 13, marginBottom: 6 }} htmlFor="xh-ly-do">
          {prompt === "thu_hoi" ? "Lý do thu hồi" : "Lý do cập nhật"}
        </label>
        <textarea id="xh-ly-do" className="xa-ly-do" autoFocus value={lyDo}
          placeholder={prompt === "thu_hoi" ? "Ví dụ: khách đổi quy cách tờ in" : "Ví dụ: đổi số lượng bước bế"}
          onChange={(e) => { setLyDo(e.target.value); if (loiLyDo && e.target.value.trim().length >= 3) setLoiLyDo(null); }} />
      </ConfirmDialog>
    </div>
  );
}

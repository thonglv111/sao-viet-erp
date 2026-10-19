/** Thanh lọc dùng chung của mọi danh sách chứng từ — phương án 2 "nút Lọc + menu" (khuôn Linear).
 *
 *  Đặt NGAY TRONG thanh công cụ của màn, sau ô tìm: [Kỳ ▾] [Lọc N]; điều kiện đã áp xuống một hàng
 *  riêng dưới thanh (mockup ban-to-ngan-A-tinh-chinh, 10/10/2026): [khối…] [Xoá bộ lọc].
 *  - Nút kỳ: "Tháng này theo ngày tạo". Mở ra chọn "Tính theo" (mốc ngày) và kỳ; "Tuỳ chọn" thêm
 *    hai ô Từ ngày / Đến ngày có nhãn.
 *  - Nút "Lọc": menu các điều kiện có ô gõ tìm; chọn một điều kiện thì cột bên phải ra các giá trị
 *    (kèm số bản ghi nếu máy chủ đếm). Chọn là ÁP NGAY, không có bước nháp.
 *  - Điều kiện đã áp thành khối "icon trường là | giá trị | ×": bấm giá trị để sửa, × để bỏ.
 *  Khổ điện thoại: lớp nổi thành tấm sát đáy màn, menu con thay chỗ menu (có nút quay lại).
 */
import { ChonNgay } from "../../components/ChonNgay";
import { ArrowLeft, CalendarDays, Check, ChevronDown, ChevronRight, ListFilter, Search, X } from "lucide-react";
import { OGoDinhDang } from "../../components/OGoDinhDang";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as PhimReact, ReactNode, RefObject } from "react";

import { laDienThoai, useLaDienThoai } from "../../utils/dienThoai";
import { loiKhoang, ngayDeDoc } from "../../utils/ky";
import { LOAI_KY_DS, khoangKy, type KyDS, type LoaiKyDS } from "./ky-danh-sach";
import {
  NGUONG_O_TIM,
  boDK,
  daAp,
  docSo,
  khopChu,
  soDaAp,
  tomTat,
  tomTatDu,
  vietSo,
  type DieuKien,
} from "./thanh-loc";
import "./thanh-loc.css";

/* ------------------------------------------------------------------ lớp nổi */

/** Đóng lớp nổi khi bấm ra ngoài vùng `ref` hoặc nhấn Esc. Esc bắt ở pha capture để không lọt
 *  xuống ngăn chi tiết đang mở bên dưới; `onEsc` trả true = đã tự xử lý (vd lùi từ menu con). */
export function useDongKhiRaNgoai(ref: RefObject<HTMLElement | null>, mo: boolean, dong: () => void, onEsc?: () => boolean) {
  const dongRef = useRef(dong);
  dongRef.current = dong;
  const escRef = useRef(onEsc);
  escRef.current = onEsc;
  useEffect(() => {
    if (!mo) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Esc khi lịch của ô ngày (ChonNgay) đang mở: để ô tự đóng lịch, đừng đóng cả menu lọc.
      if (e.target instanceof Element && e.target.closest(".cn-khung.is-mo")) return;
      e.preventDefault();
      e.stopPropagation();
      if (escRef.current?.()) return;
      dongRef.current();
    }
    function onBam(e: MouseEvent) {
      const vung = ref.current;
      // Lịch nổi của ô ngày portal ra body — bấm trong đó không tính là bấm ra ngoài.
      if (e.target instanceof Element && e.target.closest(".cn-hop")) return;
      if (vung && e.target instanceof Node && !vung.contains(e.target)) dongRef.current();
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onBam);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onBam);
    };
  }, [mo, ref]);
}

/** Mép phải còn NHÌN THẤY của phần tử: cửa sổ, hoặc khung cuộn gần nhất (vùng nội dung của khung
 *  ứng dụng là một khung cuộn riêng — lớp nổi lố mép nó là bị cắt, lại đẻ thêm thanh cuộn ngang). */
function mepPhaiNhinThay(el: HTMLElement): number {
  let mep = document.documentElement.clientWidth;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const ox = getComputedStyle(p).overflowX;
    if (ox !== "visible") mep = Math.min(mep, p.getBoundingClientRect().left + p.clientWidth);
  }
  return mep;
}

/** Lùi lớp nổi sang trái nếu tràn mép phải (chừa 12px). Tính từ vị trí NÚT NEO + bề rộng lớp nổi —
 *  cả hai không đổi theo chỗ lớp nổi đang đứng, nên đo bao nhiêu lần cũng ra một số. */
function canhMepPhai(el: HTMLElement) {
  // jsdom (bộ test) không có matchMedia.
  if (typeof window.matchMedia !== "function" || window.matchMedia("(max-width: 640px)").matches) {
    el.style.left = "";
    return;
  }
  const neo = (el.offsetParent ?? el.parentElement)?.getBoundingClientRect();
  if (!neo) return;
  const tran = neo.left + el.getBoundingClientRect().width - (mepPhaiNhinThay(el) - 12);
  el.style.left = tran > 0 ? `${-Math.min(tran, Math.max(0, neo.left - 12))}px` : "";
}

/** Đưa con trỏ vào ô vừa hiện mà KHÔNG cuộn khung chứa (`autoFocus` của React cuộn khung để ô lọt
 *  vào tầm nhìn, có lúc kéo cả trang trượt ngang). Hàm cấp module ⇒ React chỉ gọi lúc gắn / gỡ. */
// Điện thoại: KHÔNG tự đưa con trỏ vào — mỗi lần mở "Lọc" là bàn phím ảo bật lên che bảng, trong khi
// người dùng thường chỉ chạm chọn một điều kiện. Muốn gõ thì chạm vào ô.
const chonKhongCuon = (n: HTMLElement | null) => {
  if (!laDienThoai()) n?.focus({ preventScroll: true });
};

/** Lớp nổi neo dưới nút; tràn mép phải thì lùi sang trái cho vừa. Canh lại mỗi khi lớp nổi đổi cỡ
 *  (mở menu con làm nó rộng ra) hay cửa sổ đổi cỡ. */
export function LopNoi({ children, className, onDong }: { children: ReactNode; className?: string; onDong?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Điện thoại: lớp nổi là tấm trải ngang màn (styles/mobile/chung.css) — không có chỗ "bấm ra ngoài"
  // rõ ràng nên cần nút ✕ để tắt.
  const laDT = useLaDienThoai();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const canh = () => canhMepPhai(el);
    canh();
    // jsdom (bộ test) không có ResizeObserver.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(canh);
    ro?.observe(el);
    window.addEventListener("resize", canh);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", canh);
    };
  }, []);
  // Mở menu con là vẽ lại đồng bộ — canh ngay, không chờ ResizeObserver (chỉ chạy khi trang được vẽ).
  useLayoutEffect(() => {
    if (ref.current) canhMepPhai(ref.current);
  });
  return (
    <div ref={ref} className={`tl-pop${className ? ` ${className}` : ""}`}>
      {laDT && onDong && (
        <button type="button" className="tl-pop__dong" aria-label="Đóng bộ lọc" onClick={onDong}>
          <X size={18} aria-hidden="true" />
        </button>
      )}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ kỳ */

const NHAN_KY: Record<LoaiKyDS, string> = Object.fromEntries(
  LOAI_KY_DS.map(([l, t]) => [l, l === "tat_ca" ? "Mọi thời gian" : l === "tuy" ? "Tuỳ chọn…" : t]),
) as Record<LoaiKyDS, string>;

/** "01/10 – 31/12"; khoảng vắt qua hai năm (12 tháng qua) thì thêm năm: "07/10/25 – 06/10/26". */
function khoangNgan(tu: string, den: string): string {
  if (tu.slice(0, 4) === den.slice(0, 4)) return `${ngayDeDoc(tu).slice(0, 5)} – ${ngayDeDoc(den).slice(0, 5)}`;
  const ngan = (d: string) => `${ngayDeDoc(d).slice(0, 6)}${d.slice(2, 4)}`;
  return `${ngan(tu)} – ${ngan(den)}`;
}

function NutKy({ ky, moc, onKy, boLoai }: {
  ky: KyDS; moc: [string, string][]; onKy: (k: KyDS) => void; boLoai?: LoaiKyDS[];
}) {
  const [mo, setMo] = useState(false);
  const vung = useRef<HTMLDivElement>(null);
  useDongKhiRaNgoai(vung, mo, () => setMo(false));

  const khoang = khoangKy(ky);
  const nhanMoc = moc.find(([m]) => m === ky.moc)?.[1] ?? moc[0]?.[1] ?? "Ngày tạo";
  const chu =
    ky.loai === "tuy" && khoang ? `${ngayDeDoc(khoang.tu)} – ${ngayDeDoc(khoang.den)}` : NHAN_KY[ky.loai];

  const [tu, setTu] = useState(ky.tu ?? "");
  const [den, setDen] = useState(ky.den ?? "");
  useEffect(() => {
    setTu(ky.tu ?? "");
    setDen(ky.den ?? "");
  }, [ky.tu, ky.den]);
  const loi = ky.loai === "tuy" ? loiKhoang(tu, den) : null;
  // Ô gõ dở / ngày ngược thì giữ kỳ cũ, không gọi máy chủ.
  const apTuy = (a: string, b: string) => {
    if (!loiKhoang(a, b)) onKy({ ...ky, loai: "tuy", tu: a, den: b });
  };

  return (
    <div className="tl-neo" ref={vung}>
      <button type="button" className={`tl-nut tl-nut--ky${mo ? " is-mo" : ""}`} aria-haspopup="dialog" aria-expanded={mo}
        aria-label={`Kỳ: ${chu}${khoang ? ` theo ${nhanMoc.toLowerCase()}` : ""}`} onClick={() => setMo(!mo)}>
        <CalendarDays size={15} aria-hidden="true" />
        <span>{chu}</span>
        {khoang && <span className="tl-nut__phu">theo {nhanMoc.toLowerCase()}</span>}
        <ChevronDown size={15} aria-hidden="true" className="tl-nut__mui" />
      </button>
      {mo && (
        <LopNoi className="tl-pop--ky" onDong={() => setMo(false)}>
          <div role="dialog" aria-label="Kỳ xem danh sách">
            {moc.length > 1 && (
              <>
                <div className="tl-nhom">Tính theo</div>
                <div role="radiogroup" aria-label="Kỳ tính theo ngày">
                  {moc.map(([m, nhan]) => (
                    <button key={m} type="button" role="radio" aria-checked={ky.moc === m}
                      className={`tl-dong tl-dong--radio${ky.moc === m ? " on" : ""}`}
                      onClick={() => onKy({ ...ky, moc: m })}>
                      <span className="tl-dong__dau" aria-hidden="true" />
                      {nhan}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="tl-nhom">Kỳ</div>
            <div role="radiogroup" aria-label="Kỳ">
              {LOAI_KY_DS.filter(([l]) => !boLoai?.includes(l)).map(([l]) => {
                const k = l === "tat_ca" || l === "tuy" ? null : khoangKy({ loai: l, moc: ky.moc });
                return (
                  <button key={l} type="button" role="radio" aria-checked={ky.loai === l}
                    className={`tl-dong tl-dong--radio${ky.loai === l ? " on" : ""}`}
                    onClick={() => {
                      if (l !== "tuy") {
                        onKy({ moc: ky.moc, loai: l });
                        setMo(false);
                        return;
                      }
                      // "Tuỳ chọn" lấy khoảng đang xem (hoặc tháng này) làm điểm xuất phát cho hai ô ngày.
                      const goc = khoang ?? khoangKy({ loai: "thang", moc: ky.moc })!;
                      onKy({ ...ky, loai: "tuy", tu: goc.tu, den: goc.den });
                    }}>
                    <span className="tl-dong__dau" aria-hidden="true" />
                    {NHAN_KY[l]}
                    {k && <em>{khoangNgan(k.tu, k.den)}</em>}
                  </button>
                );
              })}
            </div>
            {ky.loai === "tuy" && (
              <div className="tl-khoang tl-khoang--ngay">
                <label>
                  <span>Từ ngày</span>
                  <ChonNgay aria-label="Từ ngày" min="2000-01-01" max="2100-12-31" value={tu}
                    onChange={(v) => {
                      setTu(v);
                      apTuy(v, den);
                    }} />
                </label>
                <label>
                  <span>Đến ngày</span>
                  <ChonNgay aria-label="Đến ngày" min="2000-01-01" max="2100-12-31" value={den}
                    onChange={(v) => {
                      setDen(v);
                      apTuy(tu, v);
                    }} />
                </label>
                {loi && <p className="tl-loi" role="alert">{loi}</p>}
              </div>
            )}
          </div>
        </LopNoi>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ giá trị của một điều kiện */

function BangGiaTri<L>({
  dk,
  loc,
  onLoc,
  onXong,
  onLui,
}: {
  dk: DieuKien<L>;
  loc: L;
  onLoc: (l: L) => void;
  /** Đã chọn xong (chọn một / áp khoảng) ⇒ đóng lớp nổi. */
  onXong: () => void;
  /** Có thì đầu bảng có nút quay lại menu điều kiện (khổ điện thoại). */
  onLui?: () => void;
}) {
  const [go, setGo] = useState("");
  const dau = (
    <div className="tl-con__dau">
      {onLui && (
        <button type="button" className="tl-lui" aria-label="Quay lại danh sách điều kiện" onClick={onLui}>
          <ArrowLeft size={15} aria-hidden="true" />
        </button>
      )}
      <b>{dk.nhan}</b>
    </div>
  );

  if (dk.kieu === "khoang") {
    return <BangKhoang dk={dk} loc={loc} onLoc={onLoc} onXong={onXong} dau={dau} />;
  }

  const coTim = dk.tim || dk.giaTri.length > NGUONG_O_TIM;
  const ds = dk.giaTri.filter((g) => khopChu(g.nhan, go));
  const dangChon = dk.kieu === "mot" ? (dk.doc(loc) == null ? [] : [dk.doc(loc)!]) : dk.doc(loc);

  const chon = (v: string) => {
    if (dk.kieu === "mot") {
      onLoc(dk.ghi(loc, dangChon.includes(v) ? undefined : v));
      onXong();
      return;
    }
    const cu = dk.doc(loc);
    onLoc(dk.ghi(loc, cu.includes(v) ? cu.filter((x) => x !== v) : [...cu, v]));
  };

  return (
    <div className="tl-con">
      {dau}
      {coTim && (
        <label className="tl-tim">
          <Search size={14} aria-hidden="true" />
          <input ref={chonKhongCuon} value={go} placeholder={`Gõ tên ${dk.nhan.toLowerCase()}…`} aria-label={`Tìm ${dk.nhan}`}
            onChange={(e) => setGo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ds[0]) {
                e.preventDefault();
                chon(ds[0].value);
              }
            }} />
        </label>
      )}
      <div className="tl-ds" role={dk.kieu === "mot" ? "radiogroup" : "group"} aria-label={dk.nhan}>
        {ds.map((g, i) => {
          const on = dangChon.includes(g.value);
          return (
            <button key={g.value} type="button" role={dk.kieu === "mot" ? "radio" : "checkbox"} aria-checked={on}
              ref={!coTim && i === 0 ? chonKhongCuon : undefined}
              className={`tl-dong ${dk.kieu === "mot" ? "tl-dong--radio" : "tl-dong--check"}${on ? " on" : ""}`}
              onClick={() => chon(g.value)}>
              <span className="tl-dong__dau" aria-hidden="true">{dk.kieu === "nhieu" && on && <Check size={11} />}</span>
              <span className="tl-dong__ten">{g.nhan}</span>
              {g.so != null && <em>{vietSo(g.so)}</em>}
            </button>
          );
        })}
        {ds.length === 0 && (
          <p className="tl-trong">
            {dk.giaTri.length === 0 ? "Chưa có dữ liệu để lọc theo mục này." : "Không có giá trị nào khớp."}
          </p>
        )}
      </div>
    </div>
  );
}

function BangKhoang<L>({
  dk,
  loc,
  onLoc,
  onXong,
  dau,
}: {
  dk: Extract<DieuKien<L>, { kieu: "khoang" }>;
  loc: L;
  onLoc: (l: L) => void;
  onXong: () => void;
  dau: ReactNode;
}) {
  const [tu0, den0] = dk.doc(loc);
  const [tu, setTu] = useState(vietSo(tu0));
  const [den, setDen] = useState(vietSo(den0));
  const a = docSo(tu);
  const b = docSo(den);
  const nguoc = a != null && b != null && a > b;

  const ap = () => {
    if (nguoc) return;
    onLoc(dk.ghi(loc, a, b));
    onXong();
  };
  // KHÔNG dùng <form>: thanh lọc nằm trong form tìm kiếm của màn (Báo giá) — form lồng form thì
  // Enter gửi luôn form ngoài theo kiểu trình duyệt, trang tải lại mất hết lọc.
  const enterLaAp = (e: PhimReact<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    ap();
  };

  return (
    <div className="tl-con">
      {dau}
      <div className="tl-khoang">
        <label>
          <span>Từ</span>
          <span className="tl-o">
            <OGoDinhDang ref={chonKhongCuon} inputMode="numeric" aria-label="Từ" value={tu} placeholder="Không chặn" onKeyDown={enterLaAp}
              onChange={(e) => setTu(vietSo(docSo(e.target.value)))} />
            {dk.donVi && <i>{dk.donVi}</i>}
          </span>
        </label>
        <label>
          <span>Đến</span>
          <span className="tl-o">
            <OGoDinhDang inputMode="numeric" aria-label="Đến" value={den} placeholder="Không chặn" onKeyDown={enterLaAp}
              onChange={(e) => setDen(vietSo(docSo(e.target.value)))} />
            {dk.donVi && <i>{dk.donVi}</i>}
          </span>
        </label>
        {nguoc && <p className="tl-loi" role="alert">Số "Từ" đang lớn hơn số "Đến".</p>}
      </div>
      <div className="tl-chan">
        {daAp(dk, loc) && (
          <button type="button" className="tl-nut-chu"
            onClick={() => {
              onLoc(boDK(dk, loc));
              onXong();
            }}>
            Bỏ điều kiện
          </button>
        )}
        <button type="button" className="tl-nut-chinh" disabled={nguoc} onClick={ap}>Áp dụng</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ nút Lọc + menu */

function NutLoc<L>({ dieuKien, loc, onLoc }: { dieuKien: DieuKien<L>[]; loc: L; onLoc: (l: L) => void }) {
  const [mo, setMo] = useState(false);
  const [go, setGo] = useState("");
  const [chon, setChon] = useState<string | null>(null);
  const vung = useRef<HTMLDivElement>(null);
  const dong = () => {
    setMo(false);
    setChon(null);
    setGo("");
  };
  useDongKhiRaNgoai(vung, mo, dong, () => {
    if (chon == null) return false;
    setChon(null);
    return true;
  });

  const ds = dieuKien.filter((d) => khopChu(d.nhan, go));
  const dk = dieuKien.find((d) => d.khoa === chon);
  const so = soDaAp(dieuKien, loc);

  return (
    <div className="tl-neo" ref={vung}>
      <button type="button" className={`tl-nut${mo ? " is-mo" : ""}`} aria-haspopup="menu" aria-expanded={mo}
        onClick={() => (mo ? dong() : setMo(true))}>
        <ListFilter size={15} aria-hidden="true" />
        Lọc
        {/* Số chỉ để mắt đếm — hàng khối ngay dưới đã đọc đủ từng điều kiện cho trình đọc màn hình. */}
        {so > 0 && <span className="tl-nut__so" aria-hidden="true">{so}</span>}
      </button>
      {mo && (
        <LopNoi className={`tl-pop--menu${dk ? " co-con" : ""}`} onDong={dong}>
          <div className="tl-menu" role="menu" aria-label="Lọc theo">
            <label className="tl-tim">
              <Search size={14} aria-hidden="true" />
              <input ref={chonKhongCuon} value={go} placeholder="Lọc theo…" aria-label="Tìm điều kiện lọc"
                onChange={(e) => setGo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ds[0]) {
                    e.preventDefault();
                    setChon(ds[0].khoa);
                  }
                }} />
            </label>
            {ds.map((d) => {
              const Icon = d.icon;
              return (
                <button key={d.khoa} type="button" role="menuitem" aria-haspopup="true" aria-expanded={chon === d.khoa}
                  className={`tl-dong tl-dong--menu${chon === d.khoa ? " on" : ""}`} onClick={() => setChon(d.khoa)}>
                  <Icon size={15} aria-hidden="true" />
                  <span className="tl-dong__ten">{d.nhan}</span>
                  {daAp(d, loc) && <Check size={14} aria-label="đang lọc" className="tl-dong__dat" />}
                  <ChevronRight size={15} aria-hidden="true" className="tl-dong__mui" />
                </button>
              );
            })}
            {ds.length === 0 && <p className="tl-trong">Không có điều kiện nào tên như vậy.</p>}
          </div>
          {dk && (
            <BangGiaTri key={dk.khoa} dk={dk} loc={loc} onLoc={onLoc} onXong={dong} onLui={() => setChon(null)} />
          )}
        </LopNoi>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ khối điều kiện đã áp */

function KhoiDieuKien<L>({ dk, loc, onLoc }: { dk: DieuKien<L>; loc: L; onLoc: (l: L) => void }) {
  const [mo, setMo] = useState(false);
  const vung = useRef<HTMLDivElement>(null);
  useDongKhiRaNgoai(vung, mo, () => setMo(false));
  const Icon = dk.icon;
  // "là một trong" khi chọn nhiều giá trị (mockup); khoảng số tự đọc "từ … đến …" trong giá trị.
  const nhieu = dk.kieu === "nhieu" && dk.doc(loc).length > 1;
  return (
    <div className="tl-neo" ref={vung}>
      <span className={`tl-dk${mo ? " is-mo" : ""}`}>
        <span className="tl-dk__truong">
          <Icon size={13} aria-hidden="true" />
          {dk.nhan}
        </span>
        {dk.kieu !== "khoang" && <span className="tl-dk__la">{nhieu ? "là một trong" : "là"}</span>}
        <button type="button" className="tl-dk__gt" title={tomTatDu(dk, loc)} aria-haspopup="dialog" aria-expanded={mo}
          aria-label={`${dk.nhan}: ${tomTatDu(dk, loc)}. Bấm để sửa`} onClick={() => setMo(!mo)}>
          {tomTat(dk, loc)}
        </button>
        <button type="button" className="tl-dk__bo" aria-label={`Bỏ lọc ${dk.nhan}`} title="Bỏ điều kiện này"
          onClick={() => onLoc(boDK(dk, loc))}>
          <X size={14} aria-hidden="true" />
        </button>
      </span>
      {mo && (
        <LopNoi className="tl-pop--con" onDong={() => setMo(false)}>
          <BangGiaTri dk={dk} loc={loc} onLoc={onLoc} onXong={() => setMo(false)} />
        </LopNoi>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ thanh lọc */

export function ThanhLoc<L>({
  ky,
  moc,
  onKy,
  boLoaiKy,
  dieuKien,
  loc,
  onLoc,
  onXoaHet,
}: {
  /** Bỏ trống `ky` khi màn không có trục thời gian (bảng điều phối có cửa sổ ngày riêng). */
  ky?: KyDS;
  /** [mã, nhãn] các mốc ngày kỳ tính theo; một mốc thì không hiện phần "Tính theo". */
  moc?: [string, string][];
  onKy?: (k: KyDS) => void;
  /** Loại kỳ không cho chọn — vd màn mà máy chủ chặn khoảng ngày (không có "Mọi thời gian"). */
  boLoaiKy?: LoaiKyDS[];
  dieuKien: DieuKien<L>[];
  loc: L;
  onLoc: (l: L) => void;
  /** Màn tự có "Xoá bộ lọc" xoá cả ô tìm / kỳ / tab thì truyền vào đây — link trên hàng điều kiện
   *  gọi nó, màn khỏi vẽ nút thứ hai cạnh đó. Bỏ trống: link chỉ bỏ các điều kiện đang áp. */
  onXoaHet?: () => void;
}) {
  const daDat = dieuKien.filter((d) => daAp(d, loc) && !d.anKhoi);
  return (
    <>
      {ky && onKy && <NutKy ky={ky} moc={moc ?? [["tao", "Ngày tạo"]]} onKy={onKy} boLoai={boLoaiKy} />}
      {/* Màn chỉ có kỳ (vd Phiếu tăng ca của tôi) thì không bày nút Lọc với menu rỗng. */}
      {dieuKien.length > 0 && <NutLoc dieuKien={dieuKien} loc={loc} onLoc={onLoc} />}
      {/* Trong `.tl-thanh` hàng này rớt xuống dòng riêng dưới thanh công cụ; ngoài đó nó tan vào thanh. */}
      {daDat.length > 0 && (
        <div className="tl-hang-dk" role="group" aria-label="Điều kiện đang lọc">
          {daDat.map((d) => (
            <KhoiDieuKien key={d.khoa} dk={d} loc={loc} onLoc={onLoc} />
          ))}
          <button type="button" className="tl-xoa" onClick={onXoaHet ?? (() => onLoc(daDat.reduce((l, d) => boDK(d, l), loc)))}>
            Xoá bộ lọc
          </button>
        </div>
      )}
    </>
  );
}

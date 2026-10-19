// Hộp "Ghi lỗi" ở công đoạn GIỮA (09/10/2026, `docs/design-kcs-ghi-loi-giua.md`, mockup đã duyệt
// `docs/mockups/kcs-ghi-loi-don-gian.html`). Logic theo thứ tự trên màn:
//   1. Danh sách tiêu chí của CHÍNH công đoạn (chụp vào lệnh lúc phát hành), cuối tách riêng "Lỗi khác".
//   2. Tiêu chí không đạt thì tick → ô Số lỗi tự đặt con trỏ. Ghi chú và ảnh không bắt buộc; Lỗi khác
//      thì ghi chú bắt buộc (nó là tên lỗi).
//   3. "Xong" hoặc tick dòng khác: dòng gọn lại thành vài thẻ nhỏ, bấm "Sửa" là mở lại.
//   4. Đối chiếu (chỉ xem): máy tính có khung Quy cách | Tệp của lệnh bên phải, luôn thấy; ngăn hẹp
//      (điện thoại) đổi thành ba tab Ghi lỗi | Quy cách | Tệp lệnh.
//   5. Thanh đáy luôn thấy: tổng lỗi lần này, MỘT lý do chưa lưu được, nút Lưu lỗi.
// Mỗi dòng tick là một dòng lỗi gửi máy chủ kèm `thu_tu` của tiêu chí; máy chủ ghép mô tả
// "Tên tiêu chí: ghi chú" và cất số theo tiêu chí vào kết quả lần kiểm. Công đoạn đã bắt đầu là ghi
// được, không chờ tổ ghi mẻ và không trần theo số tổ đã làm (10/10/2026).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ApiError, anhNho, api,
  type SxKcsAnh, type SxKcsCongDoan, type SxKcsKiemKetQua, type SxKcsLanKiem, type SxKcsLanKiemLoi,
  type SxKcsLenhDau,
} from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { XemTruoc } from "../../components/DinhKemTep";
import { Icon } from "../../components/Icons";
import { ChipTT } from "../../components/LuoiDs";
import type { TepXem } from "../../components/tepDinhKem";
import { nenAnh } from "../../lib/anhNen";
import { NganPhai, useDongNgan } from "../ke-toan/shared/NganPhai";
import { ngayGio, num } from "../keHoachSxShared";
import { nhanChangLenh } from "../lsxBuoc";
import { useNapTenDonVi } from "../tenDonVi";
import { KcsQuyCach, KcsTepLenh, demTep, useTepNhomKcs } from "./KcsDoiChieu";
import { CHIP_CONG_DOAN } from "./kcsSoDo";
import { type AnhCho, TOI_DA_ANH_MOI_LAN } from "./theCongDoan";
import "../ke-toan/ke-toan.css";
import "./kcs-ghi-loi.css";

/** Khoá dòng "Lỗi khác" — tiêu chí thật luôn có `thu_tu` ≥ 0. */
const KHAC = -1;
const LOI_QUA_SO_ANH = `Tối đa ${TOI_DA_ANH_MOI_LAN} ảnh mỗi lần ghi.`;
const CU_HIEN = 5;

interface Dong { tick: boolean; so: string; ghi: string; anh: AnhCho[] }
const DONG_TRONG: Dong = { tick: false, so: "", ghi: "", anh: [] };

function tenCongDoan(c: SxKcsCongDoan): string {
  return c.phan_doan_tong > 1 ? `${c.ten} (${c.phan_doan_so}/${c.phan_doan_tong})` : c.ten;
}

/** Ô số lỗi: chỉ chữ số và một dấu thập phân (phẩy gõ theo thói quen Việt đổi thành chấm). */
function chuanSo(v: string): string {
  const s = v.replace(",", ".").replace(/[^\d.]/g, "");
  const i = s.indexOf(".");
  return i < 0 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
}

/** Tách mô tả máy chủ đã ghép ("Tên tiêu chí: ghi chú") thành tiêu chí + ghi chú. Không khớp tiêu chí
 *  nào (Lỗi khác, dữ liệu trước 09/10) thì cả câu là ghi chú của "Lỗi khác". */
export function tachMoTa(moTa: string | null, tieuChi: { ten: string }[]): { tc: string | null; ghi: string } {
  const m = (moTa ?? "").trim();
  // Tên dài trước: "Màu đúng mẫu" không được ăn mất "Màu đúng mẫu đã ký".
  for (const t of [...tieuChi].sort((a, b) => b.ten.length - a.ten.length)) {
    if (!t.ten) continue;
    if (m === t.ten) return { tc: t.ten, ghi: "" };
    if (m.startsWith(`${t.ten}: `)) return { tc: t.ten, ghi: m.slice(t.ten.length + 2) };
  }
  return { tc: null, ghi: m };
}

/** Số đã ghi theo tiêu chí ở các lần trước — cộng `so_luong` trong kết quả tiêu chí của lần ghi. */
export function daGhiTheoTieuChi(cd: SxKcsCongDoan): Map<number, number> {
  const m = new Map<number, number>();
  for (const lk of cd.lan_kiem) {
    for (const k of lk.checklist) {
      if ((k.cong_viec_id ?? cd.cong_viec_id) !== cd.cong_viec_id || k.dat || !(Number(k.so_luong) > 0)) continue;
      m.set(k.thu_tu, (m.get(k.thu_tu) ?? 0) + Number(k.so_luong));
    }
  }
  return m;
}

function AnhDaGhi({ anh, onXem }: { anh: SxKcsAnh[]; onXem: (t: TepXem) => void }) {
  return (
    <>
      {anh.map((a) => (
        <button key={a.id} type="button" className="kgl-anh" title={`Xem ${a.file_name}`}
          onClick={() => onXem({ ten_tep: a.file_name, file_url: a.file_url, content_type: a.file_type ?? null })}>
          <img src={anhNho(a.file_url) ?? undefined} alt="" loading="lazy" />
        </button>
      ))}
    </>
  );
}

/** Huỷ ở thanh đáy đi cùng đường với Esc / nút ×: đang tick dở thì hỏi trước khi bỏ. */
function NutHuy({ disabled }: { disabled: boolean }) {
  const dong = useDongNgan();
  return <button type="button" className="btn btn--ghost" onClick={dong} disabled={disabled}>Huỷ</button>;
}

export function KcsGhiLoiGiua({
  lenh, cd, dinhKemDem, onClose, onSaved,
}: {
  lenh: SxKcsLenhDau;
  cd: SxKcsCongDoan;
  /** Bộ đếm sự kiện tệp lệnh đổi (AppShell) — đổi là nạp lại tab Tệp. */
  dinhKemDem?: Record<number, number>;
  onClose: () => void;
  onSaved: (r: SxKcsKiemKetQua) => void;
}) {
  const { token } = useAuth();
  useNapTenDonVi();
  const dv = nhanChangLenh(cd.don_vi, lenh.don_vi_tinh);
  const tieuChi = useMemo(() => cd.tieu_chi ?? [], [cd.tieu_chi]);
  const truoc = useMemo(() => daGhiTheoTieuChi(cd), [cd]);
  const tep = useTepNhomKcs(lenh.id, dinhKemDem);
  const tepLenh = tep.nhom?.filter((g) => g.lsx_id === lenh.id) ?? null;
  const soTep = demTep(tepLenh);

  const [dong, setDong] = useState<Map<number, Dong>>(new Map());
  const [mo, setMo] = useState<number | null>(null);
  const [tab, setTab] = useState<"ghi" | "doi">("ghi");
  const [dc, setDc] = useState<"qc" | "tep">("qc");
  const [moHetCu, setMoHetCu] = useState(false);
  const [dangNen, setDangNen] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [xem, setXem] = useState<TepXem | null>(null);

  // Tick xong thì con trỏ nhảy vào ô Số lỗi của dòng đó — đặt SAU khi dòng mở ra (ô mới có trong DOM).
  const [datConTro, setDatConTro] = useState<number | null>(null);
  const oSo = useRef(new Map<number, HTMLInputElement>());
  useEffect(() => {
    if (datConTro == null) return;
    oSo.current.get(datConTro)?.focus();
    setDatConTro(null);
  }, [datConTro]);

  const chupRef = useRef<HTMLInputElement>(null);
  const chonRef = useRef<HTMLInputElement>(null);
  const dichAnh = useRef<number>(KHAC);
  const idAnh = useRef(0);
  // URL `blob:` không tự mất khi ngăn đóng — dọn tay; ref để bản dọn lúc unmount thấy danh sách mới nhất.
  const anhRef = useRef<AnhCho[]>([]);
  useEffect(() => { anhRef.current = [...dong.values()].flatMap((d) => d.anh); }, [dong]);
  useEffect(() => () => { for (const a of anhRef.current) URL.revokeObjectURL(a.url); }, []);

  const lay = (k: number) => dong.get(k) ?? DONG_TRONG;
  function sua(k: number, f: (d: Dong) => Dong) {
    setDong((m) => new Map(m).set(k, f(m.get(k) ?? DONG_TRONG)));
    setError(null);
  }
  function tick(k: number, bat: boolean) {
    if (bat) {
      setDong((m) => new Map(m).set(k, { ...DONG_TRONG, tick: true }));
      setError(null);
      setMo(k);
      setDatConTro(k);
      return;
    }
    for (const a of lay(k).anh) URL.revokeObjectURL(a.url);
    setDong((m) => { const n = new Map(m); n.delete(k); return n; });
    if (mo === k) setMo(null);
    setError(null);
  }
  function bamTen(k: number) {
    if (!lay(k).tick) tick(k, true);
    else setMo((x) => (x === k ? null : k));
  }

  const dangTick = [...dong.entries()].filter(([, d]) => d.tick);
  const soAnh = dangTick.reduce((n, [, d]) => n + d.anh.length, 0);
  const duSoAnh = soAnh >= TOI_DA_ANH_MOI_LAN;
  const tong = dangTick.reduce((s, [, d]) => s + (Number(d.so) > 0 ? Number(d.so) : 0), 0);
  const tenDong = (k: number) => (k === KHAC ? "Lỗi khác" : tieuChi.find((t) => t.thu_tu === k)?.ten || `Tiêu chí ${k}`);

  async function themAnh(input: HTMLInputElement) {
    const k = dichAnh.current;
    const ds = Array.from(input.files ?? []);
    // Xoá giá trị ô chọn: không thì chọn lại đúng tấm vừa bỏ, trình duyệt không bắn `change`.
    input.value = "";
    setError(null);
    let conDuoc = TOI_DA_ANH_MOI_LAN - soAnh;
    for (const f of ds) {
      if (conDuoc <= 0) { setError(LOI_QUA_SO_ANH); break; }
      if (!f.type.startsWith("image/")) { setError(`"${f.name}" không phải ảnh.`); continue; }
      // Ảnh điện thoại 4–8 MB/tấm: nén ngay khi thêm để lúc Lưu không phải đẩy vài chục MB qua wifi xưởng.
      setDangNen((n) => n + 1);
      const kq = await nenAnh(f);
      setDangNen((n) => n - 1);
      conDuoc -= 1;
      const moi = { id: ++idAnh.current, file: kq.file, url: URL.createObjectURL(kq.file), goc: kq.goc };
      // Nén xong mà dòng đã bỏ tick (bấm bỏ trong lúc chờ) thì vứt ảnh, không gắn vào dòng đã xoá.
      setDong((m) => {
        const d = m.get(k);
        if (!d?.tick) { URL.revokeObjectURL(moi.url); return m; }
        return new Map(m).set(k, { ...d, anh: [...d.anh, moi] });
      });
    }
  }
  function moChonAnh(k: number, o: HTMLInputElement | null) {
    dichAnh.current = k;
    o?.click();
  }
  function boAnh(k: number, id: number) {
    const a = lay(k).anh.find((x) => x.id === id);
    if (a) URL.revokeObjectURL(a.url);
    sua(k, (d) => ({ ...d, anh: d.anh.filter((x) => x.id !== id) }));
  }

  // MỘT lý do chưa lưu được, theo thứ tự người làm gặp phải.
  // Công đoạn đã bắt đầu là ghi được: không chờ tổ ghi mẻ, không trần theo số tổ đã làm (10/10/2026).
  const lyDo = dangTick.length === 0 ? "Tick ít nhất một tiêu chí không đạt"
        : (() => {
          for (const [k, d] of dangTick) {
            if (!(Number(d.so) > 0)) return `Nhập số lỗi cho ${tenDong(k)}`;
            if (k === KHAC && !d.ghi.trim()) return "Ghi chú Lỗi khác là lỗi gì";
          }
          // Công đoạn đã xong thì trần quay lại, cùng luật máy chủ `_chi_ghi_loi` (#31, #72): Σ lỗi
          // (cũ + lần này) không vượt số tốt tổ đã ghi.
          if (cd.trang_thai === "completed") {
            const con = Math.max(0, cd.tot - cd.tong_loi);
            if (tong > con) return `Công đoạn đã xong, tổ đã làm ${num(cd.tot)} ${dv}: chỉ còn ghi được ${num(con)} ${dv} lỗi`;
          }
          if (soAnh > TOI_DA_ANH_MOI_LAN) return `${LOI_QUA_SO_ANH} Bỏ bớt ${soAnh - TOI_DA_ANH_MOI_LAN} ảnh.`;
          return null;
        })();

  async function luu() {
    if (!token || saving || dangNen > 0 || lyDo) return;
    setSaving(true);
    setError(null);
    // Giữ thứ tự trên màn: tiêu chí theo thứ tự, Lỗi khác cuối.
    const thuTu = [...tieuChi.map((t) => t.thu_tu), KHAC];
    const gui = dangTick.sort(([a], [b]) => thuTu.indexOf(a) - thuTu.indexOf(b));
    try {
      const r = await api.sanXuat.kiemCongDoan(token, cd.cong_viec_id, {
        so_loi: tong,
        lsx_id: lenh.id,
        loi: gui.map(([k, d]) => ({
          cong_viec_id: null,
          thu_tu: k === KHAC ? null : k,
          so_luong: Number(d.so),
          mo_ta: d.ghi.trim(),
          files: d.anh.map((a) => a.file),
        })),
      });
      onSaved(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không lưu được lỗi.");
      setSaving(false);
    }
  }

  // Lần ghi trước ở công đoạn này — mỗi dòng lỗi một hàng hai tầng, mới nhất trước.
  const cu = useMemo(() => {
    const out: { lk: SxKcsLanKiem; l: SxKcsLanKiemLoi }[] = [];
    for (const lk of cd.lan_kiem) for (const l of lk.loi) if (l.so_luong > 0) out.push({ lk, l });
    return out.sort((a, b) => (b.lk.luc ?? "").localeCompare(a.lk.luc ?? ""));
  }, [cd.lan_kiem]);
  const cuHien = moHetCu ? cu : cu.slice(0, CU_HIEN);

  function dongTieuChi(k: number) {
    const d = lay(k);
    const khac = k === KHAC;
    const dangMo = d.tick && mo === k;
    const daGhi = khac ? 0 : truoc.get(k) ?? 0;
    return (
      <div key={k} className={`kgl-dong${khac ? " kgl-dong--khac" : ""}`}>
        <div className="kgl-dong__h">
          <input type="checkbox" checked={d.tick} aria-label={tenDong(k)}
            onChange={(e) => tick(k, e.currentTarget.checked)} />
          <button type="button" className="kgl-dong__ten" onClick={() => bamTen(k)}>
            {khac ? "Lỗi khác, không có trong danh sách" : tenDong(k)}
            {daGhi > 0 && <span className="kgl-dong__ls">trước đã ghi {num(daGhi)} {dv}</span>}
          </button>
        </div>
        {dangMo ? (
          <div className="kgl-dong__than">
            <label>
              <span className="kgl-nhan">Số lỗi</span>
              <span className="kgl-o-so">
                <input ref={(el) => { if (el) oSo.current.set(k, el); else oSo.current.delete(k); }}
                  inputMode="decimal" value={d.so} aria-label={`Số lỗi ${tenDong(k)}`}
                  onChange={(e) => { const v = chuanSo(e.currentTarget.value); sua(k, (x) => ({ ...x, so: v })); }} />
                <span>{dv}</span>
              </span>
            </label>
            <label>
              <span className="kgl-nhan">Ghi chú <i>{khac ? "bắt buộc, ghi lỗi gì" : "không bắt buộc"}</i></span>
              <input className="kgl-o" value={d.ghi} aria-label={`Ghi chú ${tenDong(k)}`}
                placeholder={khac ? "Ví dụ: tờ bị nhăn mép" : "Ví dụ: góc phải tờ"}
                onChange={(e) => { const v = e.currentTarget.value; sua(k, (x) => ({ ...x, ghi: v })); }} />
            </label>
            <div className="kgl-dong__anh">
              <span className="kgl-nhan">Ảnh <i>không bắt buộc</i></span>
              {d.anh.map((a) => (
                <span key={a.id} className="kgl-anh">
                  <button type="button" className="kgl-anh__xem" title={`Xem ${a.file.name}`}
                    onClick={() => setXem({ ten_tep: a.file.name, file_url: a.url, content_type: a.file.type })}>
                    <img src={a.url} alt="" />
                  </button>
                  <button type="button" className="kgl-anh__bo" aria-label={`Bỏ ảnh ${a.file.name}`} title="Bỏ ảnh"
                    onClick={() => boAnh(k, a.id)}>×</button>
                </span>
              ))}
              <button type="button" className="btn btn--ghost btn--sm" disabled={duSoAnh}
                title={duSoAnh ? LOI_QUA_SO_ANH : undefined} onClick={() => moChonAnh(k, chupRef.current)}>
                <Icon name="camera" size={13} /> Chụp ảnh
              </button>
              <button type="button" className="btn btn--ghost btn--sm kgl-chon-anh" disabled={duSoAnh}
                title={duSoAnh ? LOI_QUA_SO_ANH : undefined} onClick={() => moChonAnh(k, chonRef.current)}>
                <Icon name="upload" size={13} /> Chọn ảnh
              </button>
              {dangNen > 0 && dichAnh.current === k && <span className="kgl-mu">đang xử lý ảnh…</span>}
              <span className="kgl-gian" />
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setMo(null)}>Xong</button>
            </div>
          </div>
        ) : d.tick && (
          <div className="kgl-dong__tom">
            {Number(d.so) > 0
              ? <span className="kt-tag">{num(Number(d.so))} {dv}</span>
              : <span className="kt-tag kt-tag--do">chưa nhập số</span>}
            {d.anh.length > 0 && <span className="kt-tag">{d.anh.length} ảnh</span>}
            {d.ghi.trim() && <span className="kt-tag kgl-tag-ghi" title={d.ghi.trim()}>{d.ghi.trim()}</span>}
            <button type="button" className="kgl-lk" onClick={() => { setMo(k); setDatConTro(k); }}>Sửa</button>
          </div>
        )}
      </div>
    );
  }

  const chip = CHIP_CONG_DOAN[cd.trang_thai];
  const tenCd = tenCongDoan(cd);
  const quyCach = <KcsQuyCach qc={cd.quy_cach} danDo={cd.ghi_chu_ky_thuat} />;
  const tepKhoi = <KcsTepLenh nhom={tepLenh} loi={tep.loi} onXem={setXem} />;

  return (
    <NganPhai
      tieuDe={`Ghi lỗi ${tenCd}`}
      phuDe={(
        <>
          <span className="kt-tag">{lenh.ma}</span>
          {cd.to_ten && <span className="kgl-to">{cd.to_ten}</span>}
          {chip && <ChipTT mau={chip.mau}>{chip.nhan}</ChipTT>}
        </>
      )}
      canhBao={(
        <div className="kgl-so">
          <span>{cd.gia_cong_ngoai ? "Nhà gia công trả về" : "Tổ đã làm"}<b>{num(cd.tot)} {dv}</b></span>
          <span>Đã ghi lỗi<b>{num(cd.tong_loi)} {dv}</b></span>
        </div>
      )}
      onDong={onClose}
      chanDong={() => dangTick.length > 0 && !saving}
      cauHoiBo="Bỏ lỗi đang ghi?"
      chan={(
        <div className="kgl-day">
          <span className="kgl-day__tong">Tổng lỗi lần này<b>{num(tong)} {dv}</b></span>
          <span className={`kgl-day__ly${lyDo ? "" : " is-ok"}`} role="status">
            {error ?? lyDo ?? `Lưu được. Lỗi báo ngay về ${cd.to_ten || "tổ làm công đoạn"}`}
          </span>
          <NutHuy disabled={saving} />
          <button type="button" className="btn btn--accent kgl-day__luu" onClick={luu}
            disabled={saving || dangNen > 0 || lyDo != null}>
            {saving ? "Đang lưu…" : dangNen > 0 ? "Đang xử lý ảnh…" : "Lưu lỗi"}
          </button>
        </div>
      )}
    >
      <div className="kgl" data-tab={tab}>
        {/* Chỉ hiện khi ngăn hẹp (điện thoại) — máy tính thấy cả hai cột, không cần tab. */}
        <div className="kgl-tabdt" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "ghi"} className={tab === "ghi" ? "on" : undefined}
            onClick={() => setTab("ghi")}>Ghi lỗi</button>
          <button type="button" role="tab" aria-selected={tab === "doi" && dc === "qc"}
            className={tab === "doi" && dc === "qc" ? "on" : undefined}
            onClick={() => { setTab("doi"); setDc("qc"); }}>Quy cách</button>
          <button type="button" role="tab" aria-selected={tab === "doi" && dc === "tep"}
            className={tab === "doi" && dc === "tep" ? "on" : undefined}
            onClick={() => { setTab("doi"); setDc("tep"); }}>
            Tệp lệnh{tep.nhom && <span className="kgl-dem">{soTep}</span>}
          </button>
        </div>

        <div className="kgl-trai">
          <section className="kgl-khoi" aria-label="Tiêu chí không đạt">
            <div className="kgl-khoi__h">Tick tiêu chí không đạt<span className="kgl-mu">Tiêu chí đạt thì để trống.</span></div>
            {tieuChi.length === 0 && (
              <p className="kgl-trong">
                Lệnh không giữ tiêu chí nào cho {cd.ten}. Lỗi vẫn ghi được ở dòng Lỗi khác; muốn có tiêu chí thì khai
                ở Tiêu chí KCS rồi bấm Cập nhật tiêu chí ở hồ sơ lệnh.
              </p>
            )}
            {tieuChi.map((t) => dongTieuChi(t.thu_tu))}
            <div className="kgl-khac-tach" />
            {dongTieuChi(KHAC)}
          </section>

          <section className="kgl-khoi" aria-label="Lỗi đã ghi trước">
            <div className="kgl-khoi__h">Lỗi đã ghi trước{cu.length > 0 && <span className="kgl-mu">{cu.length} dòng</span>}</div>
            {cu.length === 0 ? <p className="kgl-trong">Chưa ghi lỗi lần nào ở công đoạn này.</p> : cuHien.map(({ lk, l }) => {
              const { tc, ghi } = tachMoTa(l.mo_ta, tieuChi);
              return (
                <div key={l.id} className="kgl-cu">
                  <div className="kgl-cu__1">
                    <span className="kgl-cu__tc">{tc ?? "Lỗi khác"}</span>
                    <span className="kgl-cu__so">{num(l.so_luong)} {nhanChangLenh(l.don_vi ?? cd.don_vi, lenh.don_vi_tinh)}</span>
                    {l.da_xem_luc
                      ? <ChipTT mau="la" title={l.nguoi_xem ? `${l.nguoi_xem} ${ngayGio(l.da_xem_luc)}` : undefined}>Tổ đã xem</ChipTT>
                      : <ChipTT mau="slate">Tổ chưa xem</ChipTT>}
                  </div>
                  <div className="kgl-cu__2">
                    {ghi && <span className="kgl-cu__ghi">{ghi}</span>}
                    {l.anh.length > 0 && <span className="kgl-cu__anh"><AnhDaGhi anh={l.anh} onXem={setXem} /></span>}
                    <span className="kgl-mu4">{ngayGio(lk.luc)}</span>
                    {lk.nguoi_kiem && <span className="kgl-mu4">{lk.nguoi_kiem}</span>}
                  </div>
                </div>
              );
            })}
            {cu.length > CU_HIEN && (
              <button type="button" className="kgl-lk kgl-them" onClick={() => setMoHetCu((v) => !v)}>
                {moHetCu ? "Thu gọn" : `Xem thêm ${cu.length - CU_HIEN} dòng cũ hơn`}
              </button>
            )}
          </section>
        </div>

        <section className="kgl-khoi kgl-phai" aria-label="Đối chiếu">
          <div className="kgl-khoi__h kgl-phai__h">Đối chiếu<span className="kgl-mu">chỉ xem</span></div>
          <div className="kgl-tab" role="tablist">
            <button type="button" role="tab" aria-selected={dc === "qc"} className={dc === "qc" ? "on" : undefined}
              onClick={() => setDc("qc")}>Quy cách</button>
            <button type="button" role="tab" aria-selected={dc === "tep"} className={dc === "tep" ? "on" : undefined}
              onClick={() => setDc("tep")}>
              <Icon name="paperclip" size={13} /> Tệp của lệnh{tep.nhom && <span className="kgl-dem">{soTep}</span>}
            </button>
          </div>
          {dc === "qc" ? quyCach : tepKhoi}
        </section>
      </div>

      {/* `capture`: điện thoại mở thẳng camera sau; máy tính bỏ qua cờ này và mở hộp chọn tệp. */}
      <input ref={chupRef} type="file" accept="image/*" capture="environment" hidden
        aria-label="Chụp ảnh lỗi" onChange={(e) => void themAnh(e.currentTarget)} />
      <input ref={chonRef} type="file" accept="image/*" multiple hidden
        aria-label="Chọn ảnh lỗi" onChange={(e) => void themAnh(e.currentTarget)} />
      {xem && createPortal(<XemTruoc tep={xem} onDong={() => setXem(null)} />, document.body)}
    </NganPhai>
  );
}

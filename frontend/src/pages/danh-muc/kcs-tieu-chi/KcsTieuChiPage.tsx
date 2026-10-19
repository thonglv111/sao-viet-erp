// Danh mục "Tiêu chí KCS" — phương án A hai ô (`docs/design-tieu-chi-kcs-lam-lai.md` §6, chốt
// 08/10/2026, mockup `docs/mockups/tieu-chi-kcs-chot.html`).
//
// Ô trái: mọi công đoạn gom theo giai đoạn, kể cả công đoạn CHƯA có tiêu chí (thấy chỗ trống là
// mục đích của ô này). Ô phải: tiêu chí của công đoạn đang chọn — mỗi tiêu chí MỘT câu chữ (mg
// 0381 gỡ Hướng dẫn / Bắt buộc / Ngừng dùng), sửa tại chỗ, gõ mới bằng Enter, kéo tay nắm đổi thứ
// tự, chép sang công đoạn khác qua hộp soạn. Màu CHỈ ở chip giai đoạn.
import { Copy, Eye, GripVertical, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { ApiError, api, type KcsHangMuc } from "../../../api/client";
import { useCan } from "../../../auth/permissions";
import { useAuth } from "../../../auth/useAuth";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { laDienThoai } from "../../../utils/dienThoai";
import { useDebounced } from "../../../utils/useDebounced";
import { useLocMan } from "../../thanh-loc/useLocMan";
import { HopChepTieuChi } from "./HopChepTieuChi";
import { NganXemKcsCuoi } from "./NganXemKcsCuoi";
import { ChipGd } from "./ChipGd";
import { type CongDoanTc, doiCho, gomTheoGd } from "./kcsTieuChi";
import "./kcs-tieu-chi.css";

const MODULE = "dm_kcs_tieu_chi";

const docUrl = (p: URLSearchParams) => {
  const n = Number(p.get("cd"));
  return { cd: Number.isInteger(n) && n > 0 ? n : null };
};
const lenUrl = (t: { cd: number | null }) => ({ cd: t.cd != null ? String(t.cd) : undefined });

/** Hàng đợi thêm tiêu chí CHUNG cả màn (không theo từng công đoạn): mã `KM####` máy chủ cấp theo
 *  max + 1, hai lần thêm chạy song song — kể cả vừa gõ ở công đoạn này đã chuyển sang công đoạn
 *  khác — sẽ đụng cùng một mã. */
let hangTao: Promise<void> = Promise.resolve();

const loiCua = (e: unknown, macDinh: string) => (e instanceof ApiError ? e.message : macDinh);

export function KcsTieuChiPage() {
  const { token } = useAuth();
  const can = useCan();
  const suaDuoc = can(MODULE, "update");
  const xoaDuoc = can(MODULE, "delete");

  // Mọi công đoạn đã biết (theo id) + thứ tự đang hiện ở ô trái (máy chủ đã lọc theo ô tìm). Tách
  // hai thứ để công đoạn đang chọn vẫn hiện ở ô phải khi ô tìm lọc khuất nó.
  const [theoId, setTheoId] = useState<Map<number, CongDoanTc>>(new Map());
  const [dangHien, setDangHien] = useState<number[] | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [tim, setTim] = useState("");
  const timCham = useDebounced(tim.trim());
  const [anRong, setAnRong] = useState(false);
  const [url, setUrl] = useLocMan("kcs-tieu-chi", { cd: null as number | null }, docUrl, lenUrl);
  // Điện thoại: danh sách công đoạn ở trên, tiêu chí ở dưới — chạm công đoạn thì cuộn tới phần tiêu chí,
  // không thì chạm xong không thấy gì đổi.
  const phaiRef = useRef<HTMLElement>(null);
  const chonCd = (id: number) => {
    setUrl({ cd: id });
    if (laDienThoai()) requestAnimationFrame(() => phaiRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  const chonId = url.cd;
  const daChonDau = useRef(chonId != null);

  const [hop, setHop] = useState<{ nguon: CongDoanTc | null; dich: number | null } | null>(null);
  const [moXem, setMoXem] = useState(false);
  const [bao, setBao] = useState<string | null>(null);

  const nap = useCallback((ds: CongDoanTc[]) => {
    setTheoId((cu) => {
      const moi = new Map(cu);
      for (const c of ds) moi.set(c.cong_doan_id, c);
      return moi;
    });
  }, []);

  const tai = useCallback(async (q: string) => {
    if (!token) return;
    setLoi(null);
    try {
      const kb = await api.kcsHangMuc.khaiBao(token, q || undefined);
      const ds = kb.giai_doan.flatMap((g) => g.cong_doan);
      nap(ds);
      setDangHien(ds.map((c) => c.cong_doan_id));
      // Mở màn lần đầu (URL không chỉ công đoạn nào): chọn công đoạn đầu tiên có tiêu chí.
      if (!daChonDau.current && !q) {
        daChonDau.current = true;
        const dau = ds.find((c) => c.hang_muc.length > 0) ?? ds[0];
        if (dau) setUrl({ cd: dau.cong_doan_id });
      }
    } catch (e) {
      setDangHien((d) => d ?? []);
      setLoi(loiCua(e, "Không tải được danh mục tiêu chí."));
    }
  }, [token, nap, setUrl]);

  useEffect(() => { void tai(timCham); }, [tai, timCham]);

  useEffect(() => {
    if (!bao) return;
    const t = window.setTimeout(() => setBao(null), 4000);
    return () => window.clearTimeout(t);
  }, [bao]);

  const chon = chonId != null ? theoId.get(chonId) ?? null : null;
  const soCoTieuChi = useMemo(
    () => [...theoId.values()].filter((c) => c.hang_muc.length > 0).length, [theoId]);
  const nhomTrai = useMemo(() => {
    const ds = (dangHien ?? []).map((id) => theoId.get(id)).filter((c): c is CongDoanTc => !!c)
      .filter((c) => !anRong || c.hang_muc.length > 0);
    return gomTheoGd(ds);
  }, [dangHien, theoId, anRong]);

  /** Thay danh sách tiêu chí của một công đoạn bằng bản máy chủ vừa trả. */
  const datHangMuc = useCallback((cdId: number, f: (ds: KcsHangMuc[]) => KcsHangMuc[]) => {
    setTheoId((cu) => {
      const c = cu.get(cdId);
      if (!c) return cu;
      const moi = new Map(cu);
      moi.set(cdId, { ...c, hang_muc: f(c.hang_muc) });
      return moi;
    });
  }, []);

  return (
    <main className="ktc">
      <header className="ktc-dau">
        <h1>Tiêu chí KCS</h1>
        <span className="ktc-mo">{soCoTieuChi} công đoạn có tiêu chí</span>
        <div className="ktc-dau__phai">
          <button type="button" className="ktc-nut" onClick={() => setMoXem(true)}>
            <Eye size={16} aria-hidden /> Xem KCS cuối thấy gì
          </button>
        </div>
      </header>

      {loi && <div className="banner banner--error" role="alert"><span>{loi}</span></div>}

      <div className="ktc-hai-o">
        <aside className="ktc-trai" aria-label="Công đoạn">
          <label className="ktc-tim">
            <Search size={16} aria-hidden />
            <input value={tim} onChange={(e) => setTim(e.target.value)}
              placeholder="Tìm công đoạn hoặc tiêu chí" aria-label="Tìm công đoạn hoặc tiêu chí" />
            {tim && (
              <button type="button" className="ktc-tim__xoa" onClick={() => setTim("")} aria-label="Xoá chữ tìm">
                <X size={14} aria-hidden />
              </button>
            )}
          </label>
          <label className="ktc-an-rong">
            <input type="checkbox" checked={anRong} onChange={(e) => setAnRong(e.target.checked)} />
            Ẩn công đoạn chưa có tiêu chí
          </label>
          <div className="ktc-ds-cd" role="listbox" aria-label="Danh sách công đoạn">
            {dangHien == null ? (
              Array.from({ length: 6 }).map((_, i) => <div key={i} className="ktc-skel" />)
            ) : nhomTrai.length === 0 ? (
              <div className="ktc-trong">
                {timCham ? `Không có công đoạn nào khớp “${timCham}”.` : "Chưa có công đoạn nào."}
              </div>
            ) : nhomTrai.map((g) => (
              <div key={g.nhom || "khac"} className="ktc-nhom">
                <div className="ktc-nhom__nhan"><ChipGd nhom={g.nhom} /></div>
                {g.cong_doan.map((c) => (
                  <div key={c.cong_doan_id} role="option" tabIndex={0}
                    aria-selected={c.cong_doan_id === chonId}
                    className={`ktc-cd${c.hang_muc.length ? "" : " ktc-cd--rong"}`}
                    onClick={() => chonCd(c.cong_doan_id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chonCd(c.cong_doan_id); } }}>
                    <span className="ktc-cd__ten">{c.ten}</span>
                    {c.hang_muc.length
                      ? <span className="ktc-dem">{c.hang_muc.length}</span>
                      : <span className="ktc-dem ktc-dem--rong">chưa có</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </aside>

        <section className="ktc-phai" ref={phaiRef} aria-label="Tiêu chí của công đoạn">
          {chon ? (
            <OPhai key={chon.cong_doan_id} cd={chon} token={token} suaDuoc={suaDuoc} xoaDuoc={xoaDuoc}
              datHangMuc={datHangMuc} onLoi={setLoi}
              onChep={() => setHop(chon.hang_muc.length
                ? { nguon: chon, dich: null } : { nguon: null, dich: chon.cong_doan_id })} />
          ) : (
            <div className="ktc-trong ktc-trong--phai">
              {dangHien == null ? "Đang tải…" : "Chọn một công đoạn bên trái để xem tiêu chí."}
            </div>
          )}
        </section>
      </div>

      <footer className="ktc-chan">
        Sửa ở đây áp cho lệnh phát hành từ nay. Lệnh đã phát hành giữ bộ tiêu chí lúc phát hành: hồ sơ lệnh sẽ báo
        tiêu chí đã đổi, bấm Cập nhật tiêu chí ở đó để lấy bộ mới, kể cả công đoạn đang làm. Công đoạn mà tiêu chí
        đã có kết quả kiểm thì giữ bộ cũ.
      </footer>

      {bao && <div className="ktc-bao" role="status">{bao}</div>}

      {hop && token && (
        <HopChepTieuChi token={token} nguon={hop.nguon} dichSan={hop.dich}
          onDong={() => setHop(null)}
          onXong={async (kq, soDich) => {
            setHop(null);
            setBao(`Đã chép ${kq.da_chep} tiêu chí vào ${soDich} công đoạn`
              + (kq.bo_qua ? `, bỏ qua ${kq.bo_qua} câu đã có.` : "."));
            // Số tiêu chí của các công đoạn đích đổi: nạp lại đủ, rồi lại theo ô tìm đang gõ.
            if (timCham) {
              try { nap((await api.kcsHangMuc.khaiBao(token)).giai_doan.flatMap((g) => g.cong_doan)); }
              catch { /* ô trái vẫn đúng theo ô tìm ở lượt dưới */ }
            }
            await tai(timCham);
          }} />
      )}
      {moXem && token && (
        <NganXemKcsCuoi token={token} chonSan={chon && chon.hang_muc.length ? chon.cong_doan_id : null}
          onDong={() => setMoXem(false)} />
      )}
    </main>
  );
}

// --- Ô phải --------------------------------------------------------------------------------------
function OPhai({
  cd, token, suaDuoc, xoaDuoc, datHangMuc, onLoi, onChep,
}: {
  cd: CongDoanTc;
  token: string | null;
  suaDuoc: boolean;
  xoaDuoc: boolean;
  datHangMuc: (cdId: number, f: (ds: KcsHangMuc[]) => KcsHangMuc[]) => void;
  onLoi: (s: string | null) => void;
  onChep: () => void;
}) {
  const [sua, setSua] = useState<{ id: number; ten: string } | null>(null);
  const [moi, setMoi] = useState("");
  const [hoiXoa, setHoiXoa] = useState<KcsHangMuc | null>(null);
  const [keoTu, setKeoTu] = useState<number | null>(null);
  const [keoToi, setKeoToi] = useState<number | null>(null);
  const oMoi = useRef<HTMLInputElement>(null);
  const ds = cd.hang_muc;

  // Gõ liền tay nhiều câu: Enter xoá ô ngay để gõ câu sau, các lần lưu xếp hàng lần lượt (máy chủ
  // nối cuối theo thứ tự tới). Ô KHÔNG khoá lúc lưu — khoá là mất con trỏ, chữ gõ tiếp rơi mất.
  function themMoi() {
    const ten = moi.trim();
    if (!token || !ten) return;
    setMoi("");
    onLoi(null);
    hangTao = hangTao.then(async () => {
      try {
        const r = await api.kcsHangMuc.tao(token, { cong_doan_id: cd.cong_doan_id, ten });
        datHangMuc(cd.cong_doan_id, (x) => [...x, r]);
      } catch (e) {
        onLoi(loiCua(e, "Không thêm được tiêu chí."));
        setMoi((cu) => cu || ten);     // trả lại chữ để sửa rồi Enter lại
      }
    });
  }

  async function luuSua() {
    if (!sua) return;
    const h = ds.find((x) => x.id === sua.id);
    const ten = sua.ten.trim();
    setSua(null);
    if (!token || !h || !ten || ten === h.ten) return;   // rỗng hoặc không đổi: không lưu
    onLoi(null);
    try {
      const r = await api.kcsHangMuc.sua(token, h.id, { cong_doan_id: cd.cong_doan_id, ten });
      datHangMuc(cd.cong_doan_id, (x) => x.map((y) => (y.id === r.id ? r : y)));
    } catch (e) {
      onLoi(loiCua(e, "Không lưu được tiêu chí."));
    }
  }

  async function xoa(h: KcsHangMuc) {
    if (!token) return;
    onLoi(null);
    try {
      await api.kcsHangMuc.xoa(token, h.id);
      datHangMuc(cd.cong_doan_id, (x) => x.filter((y) => y.id !== h.id));
    } catch (e) {
      onLoi(loiCua(e, "Không xoá được tiêu chí."));
    } finally {
      setHoiXoa(null);
    }
  }

  async function doiThuTu(tu: number, den: number) {
    const sau = doiCho(ds, tu, den);
    if (!token || sau === ds) return;
    const truoc = ds;
    datHangMuc(cd.cong_doan_id, () => sau);              // hiện ngay, máy chủ trả lại thì thay
    onLoi(null);
    try {
      const r = await api.kcsHangMuc.sapXep(token, cd.cong_doan_id, sau.map((h) => h.id));
      datHangMuc(cd.cong_doan_id, () => r.hang_muc);
    } catch (e) {
      datHangMuc(cd.cong_doan_id, () => truoc);
      onLoi(loiCua(e, "Không đổi được thứ tự."));
    }
  }

  // Kéo bằng sự kiện con trỏ (không dùng kéo-thả HTML5: màn cảm ứng không bắn sự kiện đó). Tay nắm
  // giữ con trỏ suốt lúc kéo; vị trí thả = dòng có nửa trên chứa con trỏ, quá dòng cuối là cuối.
  const olRef = useRef<HTMLOListElement>(null);
  const viTriTha = (y: number): number => {
    const dong = Array.from(olRef.current?.children ?? []);
    const i = dong.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i < 0 ? dong.length - 1 : i;
  };
  const batDauKeo = (e: ReactPointerEvent<HTMLButtonElement>, i: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setKeoTu(i);
    setKeoToi(i);
  };
  const dangKeo = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (keoTu != null) setKeoToi(viTriTha(e.clientY));
  };
  const thaKeo = () => {
    const tu = keoTu;
    const den = keoToi;
    setKeoTu(null);
    setKeoToi(null);
    if (tu != null && den != null) void doiThuTu(tu, den);
  };

  // Bàn phím cho tay nắm: mũi tên lên/xuống dời tiêu chí một bậc.
  const phimTayNam = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); void doiThuTu(i, i - 1); }
    if (e.key === "ArrowDown" && i < ds.length - 1) { e.preventDefault(); void doiThuTu(i, i + 1); }
  };

  return (
    <>
      <div className="ktc-phai__dau">
        <h2>{cd.ten}</h2>
        <span className="ktc-ma">{cd.ma}</span>
        <ChipGd nhom={cd.nhom} />
        {suaDuoc && (
          <div className="ktc-dau__phai">
            {/* Nút phụ của ô sửa: nhẹ (không khung) để không tranh với nút "Xem KCS cuối thấy gì" ở đầu
                màn; chữ nói đủ việc, không bỏ lửng bằng dấu "…". */}
            <button type="button" className="ktc-nut ktc-nut--nhe" onClick={onChep}
              title={ds.length ? `Chép ${ds.length} tiêu chí của ${cd.ten} sang một hay nhiều công đoạn khác` : undefined}>
              <Copy size={15} aria-hidden /> {ds.length ? "Chép sang công đoạn khác" : "Chép từ công đoạn khác"}
            </button>
          </div>
        )}
      </div>
      <p className="ktc-phai__phu">
        {ds.length
          ? `${ds.length} tiêu chí. KCS cuối xét nhóm này ở các lệnh có chạy công đoạn ${cd.ten} phát hành từ nay.`
          : suaDuoc
            ? "Chưa có tiêu chí. Gõ tiêu chí đầu tiên bên dưới hoặc chép từ công đoạn khác."
            : "Chưa có tiêu chí."}
      </p>

      <ol className="ktc-ds-tc" ref={olRef}>
        {ds.map((h, i) => (
          <li key={h.id}
            className={`ktc-tc${keoTu === i ? " ktc-tc--keo" : ""}${keoToi === i && keoTu != null && keoTu !== i ? " ktc-tc--toi" : ""}`}>
            {suaDuoc ? (
              <button type="button" className="ktc-tc__nam" aria-label={`Kéo để đổi thứ tự tiêu chí ${i + 1}`}
                title="Kéo để đổi thứ tự (hoặc mũi tên lên/xuống)"
                onPointerDown={(e) => batDauKeo(e, i)}
                onPointerMove={dangKeo}
                onPointerUp={thaKeo}
                onPointerCancel={() => { setKeoTu(null); setKeoToi(null); }}
                onKeyDown={(e) => phimTayNam(e, i)}>
                <GripVertical size={16} aria-hidden />
              </button>
            ) : <span />}
            <span className="ktc-tc__stt">{i + 1}</span>
            {sua?.id === h.id ? (
              <input className="ktc-tc__o" autoFocus value={sua.ten} maxLength={200}
                aria-label="Sửa tiêu chí"
                onChange={(e) => setSua({ id: h.id, ten: e.target.value })}
                onBlur={() => void luuSua()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setSua(null); }
                }} />
            ) : suaDuoc ? (
              <button type="button" className="ktc-tc__cau" title="Bấm để sửa"
                onClick={() => setSua({ id: h.id, ten: h.ten })}>{h.ten}</button>
            ) : (
              <span className="ktc-tc__cau ktc-tc__cau--doc">{h.ten}</span>
            )}
            {xoaDuoc ? (
              <button type="button" className="ktc-tc__xoa" aria-label={`Xoá tiêu chí “${h.ten}”`}
                title="Xoá tiêu chí" onClick={() => setHoiXoa(h)}>
                <Trash2 size={15} aria-hidden />
              </button>
            ) : <span />}
          </li>
        ))}
      </ol>

      {suaDuoc && (
        <div className="ktc-moi">
          <span />
          <span className="ktc-moi__cong" aria-hidden>+</span>
          <input ref={oMoi} value={moi} maxLength={200}
            placeholder="Gõ tiêu chí mới rồi bấm Enter" aria-label="Tiêu chí mới"
            onChange={(e) => setMoi(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); themMoi(); } }} />
        </div>
      )}

      <ConfirmDialog open={hoiXoa != null} danger title="Xoá tiêu chí"
        message={hoiXoa ? `Xoá tiêu chí “${hoiXoa.ten}” khỏi ${cd.ten}?` : undefined}
        confirmLabel="Xoá" cancelLabel="Thôi"
        onConfirm={() => { if (hoiXoa) void xoa(hoiXoa); }} onCancel={() => setHoiXoa(null)} />
    </>
  );
}

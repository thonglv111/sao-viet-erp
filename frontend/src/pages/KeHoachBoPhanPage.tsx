// Kế hoạch bộ phận (07/11/2026, `docs/design-lenh-san-xuat-ke-hoach-bo-phan.md` mục 6, trang thử
// `docs/mockups/ke-hoach-tung-bo-phan.html` màn 2).
//
// Phát lệnh thì mỗi bước Nội bộ nằm ở khay "Lệnh mới tới" của bộ phận nhận, CHƯA tổ nào thấy. Người
// kế hoạch bộ phận kéo việc vào cột máy (hoặc "Làm tay"), chọn nhóm thợ, xếp thứ tự rồi bấm "Giao
// xuống tổ" — lúc đó Việc của tổ mới hiện việc. Việc đã giao mà nhóm chưa bắt đầu thì Rút lại được.
//
// Việc của bước In mang sẵn máy in của bài tính giá nên đứng thẳng ở cột máy đó. Rời máy ấy (sang
// máy khác, Làm tay, hay trả về khay) phải nhập lý do — máy chủ ghi vào nhật ký của lệnh.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";

import { ApiError, api } from "../api/client";
import type { KhbpBang, KhbpBoPhan, KhbpMay, KhbpViec } from "../api/client";
import { useCan } from "../auth/permissions";
import { useAuth } from "../auth/useAuth";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Select } from "../components/Select";
import { NganPhai } from "./ke-toan/shared/NganPhai";
import "./ke-toan/ke-toan.css";
import { ngayDayDu } from "./loc-san-xuat/ngay";
import { nhanDonVi } from "./lsxBuoc";
import { ThsxQuyCachThe } from "./ThsxQuyCach";
import { ThsxTepLenh } from "./ThsxTepLenh";
import { useNapTenDonVi } from "./tenDonVi";
import "./ke-hoach-bo-phan.css";

const MODULE = "ke_hoach_bo_phan";
/** Khoá cột: máy theo id, "tay" = Làm tay, "khay" = Lệnh mới tới. */
type Cot = number | "tay" | "khay";

const so = (n: number | null | undefined) => (n ?? 0).toLocaleString("vi-VN", { maximumFractionDigits: 2 });

function gioChu(phut: number | null | undefined): string | null {
  const p = Math.round(Number(phut ?? 0));
  if (p <= 0) return null;
  const h = Math.floor(p / 60);
  const m = p % 60;
  return h ? (m ? `${h} giờ ${m} phút` : `${h} giờ`) : `${m} phút`;
}

const tenMay = (m: KhbpMay | undefined) => (m ? [m.ma, m.ten].filter(Boolean).join(" ") : "");

function cotCua(v: KhbpViec): Cot {
  if (!v.da_giao_at && !v.da_xep) return "khay";
  return v.may_id ?? "tay";
}

function loiChu(e: unknown): string {
  if (e instanceof ApiError) return e.isNetwork ? "Mất kết nối tới máy chủ" : e.message;
  return "Có lỗi, thử lại";
}

/** Trạng thái thẻ ở cột máy: chưa giao, đã giao chờ nhóm, nhóm đang làm. */
function trangThai(v: KhbpViec): { chu: string; lop: string } {
  if (!v.da_giao_at) return { chu: "Đã xếp", lop: "khbp-chip--xep" };
  if (v.trang_thai === "released") return { chu: "Đã giao", lop: "khbp-chip--giao" };
  return { chu: "Đang làm", lop: "khbp-chip--lam" };
}

interface HopXep {
  v: KhbpViec;
  may: number | null;
  /** Đích là khay (bỏ cả máy lẫn nhóm). */
  veKhay: boolean;
  canLyDo: boolean;
  /** Nhóm phải chọn trong hộp (Làm tay mà bộ phận có nhiều nhóm làm được). */
  nhomChon: number[] | null;
  nhom: number | null;
  viTri: number | null;
}

export function KeHoachBoPhanPage({ eventTick = 0 }: { eventTick?: number }) {
  const { token } = useAuth();
  const can = useCan();
  const sua = can(MODULE, "update");
  useNapTenDonVi();

  const [dsBp, setDsBp] = useState<KhbpBoPhan[] | null>(null);
  const [bpId, setBpId] = useState<number | null>(null);
  const [bang, setBang] = useState<KhbpBang | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [lanNap, setLanNap] = useState(0);
  const [dangGui, setDangGui] = useState(false);
  const [bao, setBao] = useState<string | null>(null);
  const [hop, setHop] = useState<HopXep | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [loiHop, setLoiHop] = useState<string | null>(null);
  const [mo, setMo] = useState<number | null>(null);
  const [tabNgan, setTabNgan] = useState("thong_tin");
  const [keo, setKeo] = useState<KhbpViec | null>(null);
  const [choTha, setChoTha] = useState<{ cot: Cot; i: number } | null>(null);
  const baoHen = useRef<number | undefined>(undefined);

  const baoNhanh = useCallback((chu: string) => {
    setBao(chu);
    window.clearTimeout(baoHen.current);
    baoHen.current = window.setTimeout(() => setBao(null), 4500);
  }, []);

  useEffect(() => {
    if (!token) return;
    api.keHoachBoPhan.danhSach(token)
      .then((ds) => {
        setDsBp(ds);
        setBpId((cu) => (cu != null && ds.some((b) => b.id === cu) ? cu : ds[0]?.id ?? null));
      })
      .catch((e) => setLoi(loiChu(e)));
  }, [token]);

  useEffect(() => {
    if (!token || bpId == null) return;
    let bo = false;
    api.keHoachBoPhan.bang(token, bpId)
      .then((b) => { if (!bo) { setBang(b); setLoi(null); } })
      .catch((e) => { if (!bo) setLoi(loiChu(e)); });
    return () => { bo = true; };
  }, [token, bpId, eventTick, lanNap]);

  const napLai = () => setLanNap((n) => n + 1);

  const mayCua = useMemo(() => {
    const m = new Map<number, KhbpMay>();
    for (const x of [...(bang?.may ?? []), ...(bang?.may_ngoai ?? [])]) m.set(x.id, x);
    return m;
  }, [bang]);
  const tenNhom = useMemo(() => new Map((bang?.nhom ?? []).map((n) => [n.id, n.ten])), [bang]);

  const theoCot = useMemo(() => {
    const m = new Map<Cot, KhbpViec[]>();
    for (const v of bang?.viec ?? []) {
      const c = cotCua(v);
      m.set(c, [...(m.get(c) ?? []), v]);
    }
    return m;
  }, [bang]);

  // Cột: khay, máy của bộ phận, máy ngoài đang có việc, Làm tay.
  const cacCot = useMemo<Cot[]>(() => {
    if (!bang) return [];
    const ngoai = bang.may_ngoai.filter((m) => theoCot.has(m.id)).map((m) => m.id);
    return ["khay", ...bang.may.map((m) => m.id), ...ngoai, "tay"];
  }, [bang, theoCot]);

  const nhomHopLe = (v: KhbpViec, may: number | null): number[] => {
    if (may == null) return v.nhom_chon;
    const cua = mayCua.get(may)?.nhom_ids ?? [];
    const giao = v.nhom_chon.filter((n) => cua.includes(n));
    return giao.length ? giao : v.nhom_chon;
  };

  const thaDuoc = (v: KhbpViec, cot: Cot): boolean => {
    if (v.da_giao_at) return false;
    if (cot === "khay" || cot === "tay") return true;
    return v.may_chon.includes(cot) || cot === v.may_goi_y_id;
  };

  const sapLai = async (cot: Cot, ids: number[]) => {
    if (!token || bpId == null || cot === "khay") return;
    await api.keHoachBoPhan.thuTu(token, bpId, { may_id: cot === "tay" ? null : cot, ids });
  };

  const goiXep = async (h: HopXep, ly: string | null) => {
    if (!token || !bang) return;
    setDangGui(true);
    try {
      await api.keHoachBoPhan.xep(token, h.v.id, {
        may_id: h.veKhay ? null : h.may,
        department_id: h.veKhay ? null : h.nhom,
        ly_do: ly,
        version: h.v.version,
      });
      const cot: Cot = h.veKhay ? "khay" : h.may ?? "tay";
      if (h.viTri != null && cot !== "khay") {
        const ids = (theoCot.get(cot) ?? []).filter((x) => x.id !== h.v.id).map((x) => x.id);
        ids.splice(Math.min(h.viTri, ids.length), 0, h.v.id);
        await sapLai(cot, ids);
      }
      setHop(null);
      setLyDo("");
      setLoiHop(null);
      baoNhanh(h.veKhay ? `Đã trả ${h.v.lsx_ma ?? ""} ${h.v.ten_cong_doan} về khay`
        : `Đã xếp ${h.v.lsx_ma ?? ""} ${h.v.ten_cong_doan} vào ${h.may == null ? "Làm tay" : tenMay(mayCua.get(h.may))}`);
      napLai();
    } catch (e) {
      if (hop) setLoiHop(loiChu(e));
      else baoNhanh(loiChu(e));
      if (e instanceof ApiError && e.status === 409) napLai();
    } finally {
      setDangGui(false);
    }
  };

  /** Chuyển việc sang cột khác. Cần lý do hoặc phải chọn nhóm thì mở hộp, còn lại gửi luôn. */
  const chuyen = (v: KhbpViec, cot: Cot, viTri: number | null) => {
    const veKhay = cot === "khay";
    const may = cot === "khay" || cot === "tay" ? null : cot;
    // Trả về khay là "chưa xếp", không phải đổi máy: lý do chỉ đòi khi ĐẶT vào máy khác máy tính giá.
    const canLyDo = !veKhay && v.may_goi_y_id != null && may !== v.may_id && may !== v.may_goi_y_id;
    const hopLe = veKhay ? [] : nhomHopLe(v, may);
    const nhom = veKhay ? null
      : v.nhom_xep_id != null && hopLe.includes(v.nhom_xep_id) ? v.nhom_xep_id
        : hopLe.length === 1 ? hopLe[0] : null;
    // Làm tay không có máy để suy ra nhóm ⇒ phải chọn ngay, kẻo việc rơi lại khay.
    const nhomChon = cot === "tay" && nhom == null ? hopLe : null;
    const h: HopXep = { v, may, veKhay, canLyDo, nhomChon, nhom, viTri };
    if (canLyDo || nhomChon) {
      setLyDo("");
      setLoiHop(null);
      setHop(h);
    } else void goiXep(h, null);
  };

  const doiNhom = async (v: KhbpViec, nhom: number | null) => {
    if (!token) return;
    try {
      await api.keHoachBoPhan.xep(token, v.id, { may_id: v.may_id, department_id: nhom, version: v.version });
      napLai();
    } catch (e) {
      baoNhanh(loiChu(e));
      napLai();
    }
  };

  const sanGiao = (bang?.viec ?? []).filter((v) => !v.da_giao_at && v.da_xep && v.nhom_xep_id != null);

  const giao = async () => {
    if (!token || bpId == null || !sanGiao.length) return;
    setDangGui(true);
    try {
      const r = await api.keHoachBoPhan.giao(token, bpId, sanGiao.map((v) => v.id));
      const ten = r.nhom_ids.map((n) => tenNhom.get(n) ?? bang?.bo_phan.ten ?? "").filter(Boolean);
      baoNhanh(`Đã giao ${r.so_viec} việc. ${ten.join(", ")} thấy việc ngay ở Việc của tổ.`);
      napLai();
    } catch (e) {
      baoNhanh(loiChu(e));
    } finally {
      setDangGui(false);
    }
  };

  const rut = async (v: KhbpViec) => {
    if (!token) return;
    try {
      await api.keHoachBoPhan.rut(token, v.id, v.version);
      baoNhanh(`Đã rút ${v.lsx_ma ?? ""} ${v.ten_cong_doan} khỏi ${v.department_ten ?? "nhóm"}. Nhóm không còn thấy việc này.`);
      napLai();
    } catch (e) {
      baoNhanh(loiChu(e));
      napLai();
    }
  };

  // ---------------- kéo thả ----------------
  const viTriTha = (e: DragEvent<HTMLDivElement>, cot: Cot): number => {
    const the = [...e.currentTarget.querySelectorAll<HTMLElement>(".khbp-the")]
      .filter((t) => Number(t.dataset.id) !== keo?.id);
    let i = 0;
    for (const t of the) {
      const r = t.getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) i++;
    }
    // Không chen lên trước việc nhóm đang làm.
    const dau = (theoCot.get(cot) ?? []).filter((x) => x.id !== keo?.id && x.da_giao_at && x.trang_thai !== "released").length;
    return Math.max(i, dau);
  };

  const tha = (cot: Cot, i: number) => {
    const v = keo;
    setKeo(null);
    setChoTha(null);
    if (!v || !thaDuoc(v, cot)) return;
    if (cotCua(v) === cot) {
      if (cot === "khay") return;
      const ids = (theoCot.get(cot) ?? []).filter((x) => x.id !== v.id).map((x) => x.id);
      ids.splice(Math.min(i, ids.length), 0, v.id);
      sapLai(cot, ids).then(napLai).catch((e) => baoNhanh(loiChu(e)));
      return;
    }
    chuyen(v, cot, cot === "khay" ? null : i);
  };

  // ---------------- vẽ ----------------
  const tieuDeCot = (cot: Cot): { ten: string; phu: string } => {
    if (cot === "khay") return { ten: "Lệnh mới tới", phu: "Chưa xếp, nhóm chưa thấy" };
    if (cot === "tay") return { ten: "Làm tay", phu: "Không dùng máy" };
    const m = mayCua.get(cot);
    const ngoai = !bang?.may.some((x) => x.id === cot);
    return { ten: tenMay(m) || `Máy #${cot}`, phu: ngoai ? "Máy không thuộc bộ phận" : " " };
  };

  const theViec = (v: KhbpViec, cot: Cot) => {
    const keoDuoc = sua && !v.da_giao_at;
    const tt = trangThai(v);
    const gio = gioChu(v.chay_phut);
    const hopLe = nhomHopLe(v, v.may_id);
    const kt = v.khau_truoc;
    return (
      <div
        key={v.id}
        data-id={v.id}
        className={`khbp-the${keoDuoc ? "" : " khbp-the--khoa"}${keo?.id === v.id ? " khbp-the--dang" : ""}`}
        draggable={keoDuoc}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(v.id));
          setKeo(v);
        }}
        onDragEnd={() => { setKeo(null); setChoTha(null); }}
      >
        <div className="khbp-the__dong1">
          <button type="button" className="khbp-lien khbp-the__ma" onClick={() => { setMo(v.id); setTabNgan("thong_tin"); }}>
            {v.lsx_ma ?? v.bai_ghep_ma ?? `Việc #${v.id}`}
          </button>
          {cot !== "khay" && <span className={`khbp-chip ${tt.lop}`}>{tt.chu}</span>}
        </div>
        {v.khach_hang && <div className="khbp-the__hang">{v.khach_hang}</div>}
        <div className="khbp-the__cd">{v.ten_cong_doan}</div>
        <div className="khbp-the__so">
          <span className="khbp-nho">{so(v.so_luong_vao)} {nhanDonVi(v.don_vi_vao)}</span>
          {gio && <span className="khbp-nho">{gio}</span>}
          {v.han_giao && <span className="khbp-nho">Giao khách {ngayDayDu(v.han_giao)}</span>}
        </div>
        {v.may_goi_y_id != null && v.may_goi_y_id !== v.may_id && (
          <div className="khbp-the__mo">Máy tính giá: {v.may_goi_y_ten}</div>
        )}
        {kt && (
          <div className="khbp-the__mo">
            Khâu trước: {kt.ten} {kt.trang_thai === "completed" ? "xong" : kt.da_giao ? `ở ${kt.o ?? "nhóm"}` : `chờ ${kt.o ?? "bộ phận"} xếp`}
          </div>
        )}
        {cot === "khay" && sua && (
          <div className="khbp-the__chon">
            <Select
              options={[
                ...cacCot.filter((c): c is number => typeof c === "number" && thaDuoc(v, c))
                  .map((c) => ({ value: String(c), label: tenMay(mayCua.get(c)), hint: c === v.may_goi_y_id ? "máy tính giá" : undefined })),
                { value: "tay", label: "Làm tay" },
              ]}
              value=""
              onChange={(x) => x && chuyen(v, x === "tay" ? "tay" : Number(x), null)}
              placeholder="Xếp vào máy…"
              ariaLabel={`Xếp ${v.lsx_ma ?? ""} ${v.ten_cong_doan} vào máy`}
              searchable
              searchPlaceholder="Gõ tên máy…"
              portal
            />
          </div>
        )}
        {cot !== "khay" && !v.da_giao_at && (
          <>
            <div className="khbp-the__chon">
              <Select
                options={hopLe.map((n) => ({ value: String(n), label: tenNhom.get(n) ?? `Nhóm #${n}` }))}
                value={v.nhom_xep_id != null ? String(v.nhom_xep_id) : ""}
                onChange={(x) => void doiNhom(v, x ? Number(x) : null)}
                disabled={!sua}
                placeholder="Chọn nhóm làm"
                ariaLabel={`Nhóm làm ${v.lsx_ma ?? ""} ${v.ten_cong_doan}`}
                searchable
                searchPlaceholder="Gõ tên nhóm…"
                portal
                className={v.nhom_xep_id == null ? "khbp-chon--trong" : undefined}
              />
            </div>
            {sua && (
              <div className="khbp-the__duoi">
                <button type="button" className="khbp-lien" onClick={() => chuyen(v, "khay", null)}>Trả về khay</button>
              </div>
            )}
          </>
        )}
        {v.da_giao_at && (
          <div className="khbp-the__duoi">
            <span className="khbp-mo">
              {v.department_ten ?? "Nhóm"} {v.trang_thai === "released" ? "đã thấy việc" : "đang làm"}
            </span>
            {sua && v.trang_thai === "released" && (
              <button type="button" className="khbp-lien" onClick={() => void rut(v)}>Rút lại</button>
            )}
          </div>
        )}
      </div>
    );
  };

  const vMo = mo != null ? bang?.viec.find((v) => v.id === mo) ?? null : null;
  const dsMo = bang?.viec ?? [];
  const iMo = vMo ? dsMo.indexOf(vMo) : -1;

  return (
    <div className="khbp">
      <header className="khbp-dau">
        <div>
          <h1>Kế hoạch bộ phận</h1>
          <p className="khbp-mo">Kéo việc vào máy hoặc Làm tay, chọn nhóm, xếp thứ tự rồi giao. Nhóm chỉ thấy việc sau khi giao.</p>
        </div>
      </header>

      <div className="khbp-thanh">
        <div className="khbp-chon-bp">
          <Select
            options={(dsBp ?? []).map((b) => ({ value: String(b.id), label: b.ten, hint: b.tu_lam ? "tự làm" : undefined }))}
            value={bpId != null ? String(bpId) : ""}
            onChange={(x) => { setBpId(x ? Number(x) : null); setMo(null); }}
            placeholder={dsBp && !dsBp.length ? "Chưa có bộ phận nào" : "— chọn bộ phận —"}
            ariaLabel="Bộ phận"
            searchable
            searchPlaceholder="Gõ tên bộ phận…"
          />
        </div>
        <span className="khbp-gian" />
        {sua && (
          <button type="button" className="khbp-nut khbp-nut--chinh" disabled={!sanGiao.length || dangGui} onClick={() => void giao()}>
            {sanGiao.length ? `Giao xuống tổ (${sanGiao.length} việc)` : "Giao xuống tổ"}
          </button>
        )}
      </div>

      {loi && (
        <div className="banner banner--warn" role="alert">
          {loi} <button type="button" className="khbp-lien" onClick={napLai}>Thử lại</button>
        </div>
      )}

      {bang && (
        <div className={`khbp-cot-ds${keo ? " khbp-dang-keo" : ""}`}>
          {cacCot.map((cot) => {
            const ds = theoCot.get(cot) ?? [];
            const td = tieuDeCot(cot);
            const tong = cot === "khay" ? null : gioChu(ds.reduce((s, v) => s + Number(v.chay_phut ?? 0), 0));
            const duoc = keo ? thaDuoc(keo, cot) : false;
            return (
              <div
                key={String(cot)}
                className={`khbp-cot${cot === "khay" ? " khbp-cot--khay" : ""}${keo ? (duoc ? " khbp-cot--duoc" : " khbp-cot--khong") : ""}`}
                onDragOver={(e) => {
                  if (!keo || !duoc) return;
                  e.preventDefault();
                  const i = viTriTha(e, cot);
                  if (choTha?.cot !== cot || choTha.i !== i) setChoTha({ cot, i });
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setChoTha(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  tha(cot, viTriTha(e, cot));
                }}
              >
                <div className="khbp-cot__dau">
                  <h2>{td.ten}</h2>
                  <span className="khbp-mo">{cot === "khay" ? `${ds.length} việc` : tong ?? ""}</span>
                </div>
                <div className="khbp-mo khbp-cot__phu">{td.phu}</div>
                <div className="khbp-cot__vung">
                  {ds.filter((v) => v.id !== keo?.id || choTha?.cot !== cot).map((v, i) => (
                    <div key={v.id}>
                      {choTha?.cot === cot && choTha.i === i && <div className="khbp-cho-tha" />}
                      {theViec(v, cot)}
                    </div>
                  ))}
                  {choTha?.cot === cot && choTha.i >= ds.filter((v) => v.id !== keo?.id).length && <div className="khbp-cho-tha" />}
                  {!ds.length && (
                    <div className="khbp-rong">
                      {cot === "khay" ? "Không còn việc chờ xếp." : "Trống. Kéo việc vào đây."}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hop && (
        <ConfirmDialog
          open
          title={hop.veKhay ? "Trả việc về khay" : `Xếp vào ${hop.may == null ? "Làm tay" : tenMay(mayCua.get(hop.may))}`}
          confirmLabel={hop.veKhay ? "Trả về khay" : "Xếp việc"}
          cancelLabel="Huỷ"
          busy={dangGui}
          error={loiHop}
          confirmDisabled={(hop.canLyDo && !lyDo.trim()) || (!!hop.nhomChon && hop.nhom == null)}
          onCancel={() => { setHop(null); setLoiHop(null); }}
          onConfirm={() => void goiXep(hop, hop.canLyDo ? lyDo.trim() : null)}
        >
          <div className="khbp-hop">
            <p className="khbp-mo">{hop.v.lsx_ma} {hop.v.ten_cong_doan}</p>
            {hop.nhomChon && (
              <label className="khbp-hop__o">
                <span>Nhóm làm</span>
                <Select
                  options={hop.nhomChon.map((n) => ({ value: String(n), label: tenNhom.get(n) ?? `Nhóm #${n}` }))}
                  value={hop.nhom != null ? String(hop.nhom) : ""}
                  onChange={(x) => setHop({ ...hop, nhom: x ? Number(x) : null })}
                  placeholder="Chọn nhóm làm"
                  ariaLabel="Nhóm làm"
                  searchable
                  searchPlaceholder="Gõ tên nhóm…"
                  portal
                />
              </label>
            )}
            {hop.canLyDo && (
              <label className="khbp-hop__o">
                <span>Lý do rời máy tính giá ({hop.v.may_goi_y_ten})</span>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={lyDo}
                  placeholder="vd: máy 2 màu đang sửa, chạy máy 4 màu"
                  onChange={(e) => setLyDo(e.target.value)}
                />
                <small className="khbp-mo">Ghi vào nhật ký của lệnh.</small>
              </label>
            )}
          </div>
        </ConfirmDialog>
      )}

      {vMo && (
        <NganPhai
          duongDan={`Kế hoạch bộ phận > ${bang?.bo_phan.ten ?? ""}`}
          tieuDe={`${vMo.lsx_ma ?? vMo.bai_ghep_ma ?? ""} ${vMo.ten_cong_doan}`}
          tabs={[
            { id: "thong_tin", nhan: "Thông tin" },
            { id: "quy_cach", nhan: "Quy cách in" },
            { id: "tep", nhan: "Tệp của lệnh" },
          ]}
          tab={tabNgan}
          onTab={setTabNgan}
          len={iMo > 0 ? () => setMo(dsMo[iMo - 1].id) : undefined}
          xuong={iMo >= 0 && iMo < dsMo.length - 1 ? () => setMo(dsMo[iMo + 1].id) : undefined}
          onDong={() => setMo(null)}
        >
          {tabNgan === "thong_tin" && (
            <dl className="khbp-ngan">
              <div><dt>Lệnh</dt><dd>{vMo.lsx_ma}{vMo.lsx_ten && <small>{vMo.lsx_ten}</small>}</dd></div>
              {vMo.bai_ghep_ma && <div><dt>Bài ghép</dt><dd>{vMo.bai_ghep_ma}</dd></div>}
              <div><dt>Khách hàng</dt><dd>{vMo.khach_hang ?? "—"}</dd></div>
              <div><dt>Hạn giao khách</dt><dd>{vMo.han_giao ? ngayDayDu(vMo.han_giao) : "Chưa hẹn"}</dd></div>
              <div><dt>Số lượng vào</dt><dd>{so(vMo.so_luong_vao)} {nhanDonVi(vMo.don_vi_vao)}</dd></div>
              <div><dt>Số lượng ra</dt><dd>{so(vMo.so_luong_ra)} {nhanDonVi(vMo.don_vi_ra)}</dd></div>
              <div><dt>Máy</dt><dd>{vMo.may_id != null ? tenMay(mayCua.get(vMo.may_id)) : vMo.da_xep ? "Làm tay" : "Chưa xếp"}</dd></div>
              {vMo.may_goi_y_ten && <div><dt>Máy tính giá</dt><dd>{vMo.may_goi_y_ten}</dd></div>}
              <div><dt>Thời gian chạy</dt><dd>{gioChu(vMo.chay_phut) ?? "—"}</dd></div>
              <div><dt>Nhóm</dt><dd>{vMo.department_ten ?? (vMo.nhom_xep_id != null ? tenNhom.get(vMo.nhom_xep_id) : null) ?? "Chưa chọn"}</dd></div>
              {vMo.khau_truoc && <div><dt>Khâu trước</dt><dd>{vMo.khau_truoc.ten}<small>{vMo.khau_truoc.o ?? ""}</small></dd></div>}
              {vMo.khuon?.ma && <div><dt>Khuôn</dt><dd>{vMo.khuon.ma}{vMo.khuon.ten && <small>{vMo.khuon.ten}</small>}</dd></div>}
              {vMo.ghi_chu && <div><dt>Ghi chú kỹ thuật</dt><dd>{vMo.ghi_chu}</dd></div>}
            </dl>
          )}
          {tabNgan === "quy_cach" && (
            <div className="thsx-b">
              {vMo.quy_cach ? (
                <ThsxQuyCachThe qc={vMo.quy_cach} trongNgan />
              ) : (
                <p className="khbp-mo">Lệnh chưa khai quy cách.</p>
              )}
            </div>
          )}
          {tabNgan === "tep" && <ThsxTepLenh congViecId={vMo.id} nap={api.keHoachBoPhan.tep} />}
        </NganPhai>
      )}

      {bao && <div className="khbp-bao" role="status">{bao}</div>}
    </div>
  );
}

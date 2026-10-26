// Nhóm dùng chung (khối Kinh doanh) — dạng Ô NỔI NEO VÀO NÚT, thay hộp thoại cũ (04/10/2026).
//
// Hộp thoại cũ gộp "tạo nhóm mới" và "sửa nhóm có sẵn" vào một khung, ô đổi tên hiện tên cũ bằng
// chữ mờ trông như đã điền, và nhóm đã gộp không hiện ở đâu cả. Nay theo khuôn SelectPanel của
// GitHub Primer: ô nổi neo vào đúng nút vừa bấm, có ô lọc, tick là ÁP NGAY (không có nút Lưu).
//
// Hai cửa vào:
//  - `PanelThemVaoNhom`: từ thanh chọn hàng loạt — đưa người đang tick vào nhóm có sẵn hoặc tạo mới.
//  - `PopNhom`: bấm thẻ tên nhóm trên dòng nhân sự — xem ai trong nhóm, đổi tên, thêm/gỡ, xoá.
//
// Nhóm MỞ RỘNG DỮ LIỆU, KHÔNG nâng quyền — xem `repositories/org_scope.nhom_dung_chung_user_ids`.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Pencil, Plus, Search, Users } from "lucide-react";

import { api, type NhomDungChung } from "../../../api/client";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { khopGanDung } from "../../../utils/timGanDung";

/** Một người có TÀI KHOẢN (nhóm gắn theo tài khoản, không theo hồ sơ). */
export interface NguoiChon {
  userId: number;
  hoTen: string;
}

const loiCua = (e: unknown, macDinh: string) => (e instanceof Error && e.message ? e.message : macDinh);

/* ---------- khung ô nổi: neo vào nút, tự lật lên khi bên dưới thiếu chỗ ---------- */
export function OPopover({
  anchor,
  width = 300,
  onClose,
  children,
  label,
}: {
  anchor: HTMLElement;
  width?: number;
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);

  function dat() {
    const el = ref.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const h = el.scrollHeight;
    // clientWidth/Height = khung nhìn TRỪ thanh cuộn. `innerWidth` tính cả thanh cuộn nên ô nổi
    // ở nút sát mép phải bị cắt mất chữ (04/10/2026).
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const duoi = vh - a.bottom - 8;
    const tren = a.top - 8;
    const xuong = duoi >= h || duoi >= tren;
    const choCon = xuong ? duoi : tren;
    const cao = Math.min(h, choCon - 6);
    // Nút nằm nửa phải ⇒ canh MÉP PHẢI ô nổi theo mép phải nút (như menu của GitHub/Linear).
    let left = a.left + width > vw - 8 ? a.right - width : a.left;
    left = Math.max(8, Math.min(left, vw - width - 8));
    const moi = {
      top: Math.round(Math.max(8, xuong ? a.bottom + 6 : a.top - 6 - cao)),
      left: Math.round(left),
      maxH: Math.round(choCon - 6),
    };
    // Chỉ set khi ĐỔI — effect này chạy sau mọi lần vẽ, set object mới mỗi lần là lặp vô tận.
    setPos((cu) =>
      cu && cu.top === moi.top && cu.left === moi.left && cu.maxH === moi.maxH ? cu : moi,
    );
  }

  useLayoutEffect(dat);

  useEffect(() => {
    function ngoai(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      // Hộp xác nhận (ConfirmDialog) treo ngoài ô nổi — bấm trong đó không được đóng ô nổi.
      if ((t as Element).closest?.(".cfm-scrim, .confirm-dialog, [role='dialog']")) return;
      onClose();
    }
    function phim(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Nuốt Esc ở pha bắt — không thì màn Phòng ban bỏ luôn cả lựa chọn người đang tick.
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("mousedown", ngoai);
    document.addEventListener("keydown", phim, true);
    window.addEventListener("resize", dat);
    window.addEventListener("scroll", dat, true);
    return () => {
      document.removeEventListener("mousedown", ngoai);
      document.removeEventListener("keydown", phim, true);
      window.removeEventListener("resize", dat);
      window.removeEventListener("scroll", dat, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="ndc-pop"
      role="dialog"
      aria-label={label}
      style={{
        width,
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        maxHeight: pos?.maxH,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function OTick({ trangThai }: { trangThai: "on" | "mid" | "" }) {
  return (
    <span className={`ndc-pop__box${trangThai ? ` is-${trangThai}` : ""}`} aria-hidden="true">
      {trangThai === "on" && <Check size={11} strokeWidth={3} />}
    </span>
  );
}

/** Chữ cái đầu của TÊN (chữ cuối trong họ tên Việt) — vòng tròn nhỏ đầu dòng người. */
function ChuDau({ hoTen }: { hoTen: string }) {
  const ten = hoTen.trim().split(/\s+/).pop() ?? "";
  return (
    <span className="ndc-pop__avatar" aria-hidden="true">
      {ten.charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function OTim({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="ndc-pop__search">
      <Search size={14} aria-hidden="true" />
      <input autoFocus placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/* ---------- ô nổi chọn MỘT (Gán vai trò, Chuyển phòng ở thanh chọn hàng loạt) ---------- */
export interface LuaChonMot {
  value: number;
  label: string;
  /** Chữ phụ bên phải, vd mã phòng hoặc "2/3 đang có". */
  hint?: string;
  /** Mọi người đang chọn ĐÃ có sẵn lựa chọn này — hiện "✓ Đang có" thay cho hint. */
  daCo?: boolean;
}

export function PanelChonMot({
  anchor,
  tieuDe,
  ghiChu,
  icon,
  timGi,
  options,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  tieuDe: string;
  ghiChu?: string;
  /** Icon đầu mỗi dòng — cho mắt biết đang chọn loại gì (vai trò / phòng). */
  icon: ReactNode;
  /** Chữ gợi ý trong ô tìm, vd "Tìm phòng". */
  timGi: string;
  options: LuaChonMot[];
  onPick: (value: number) => void;
  onClose: () => void;
}) {
  const [loc, setLoc] = useState("");
  const hien = loc.trim() ? options.filter((o) => khopGanDung(`${o.label} ${o.hint ?? ""}`, loc)) : options;
  return (
    <OPopover anchor={anchor} onClose={onClose} label={tieuDe} width={300}>
      <div className="ndc-pop__hd">
        <b>{tieuDe}</b>
        {ghiChu && <span>{ghiChu}</span>}
      </div>
      {options.length > 6 && <OTim value={loc} onChange={setLoc} placeholder={timGi} />}
      <div className="ndc-pop__list">
        {hien.map((o) => (
          <button key={o.value} type="button" className="ndc-pop__opt" onClick={() => onPick(o.value)}>
            <span className="ndc-pop__lead" aria-hidden="true">
              {icon}
            </span>
            <span className="ndc-pop__opt-label">{o.label}</span>
            {o.daCo ? (
              <span className="ndc-pop__meta ndc-pop__meta--ok">
                <Check size={12} strokeWidth={2.5} /> Đang có
              </span>
            ) : (
              o.hint && <span className="ndc-pop__meta">{o.hint}</span>
            )}
          </button>
        ))}
        {hien.length === 0 && <div className="ndc-pop__empty">Không tìm thấy “{loc.trim()}”.</div>}
      </div>
    </OPopover>
  );
}

/* ---------- từ thanh chọn hàng loạt: thêm người đang tick vào nhóm ---------- */
export function PanelThemVaoNhom({
  token,
  anchor,
  nguoiChon,
  nhoms,
  onChanged,
  onCreated,
  onClose,
}: {
  token: string;
  anchor: HTMLElement;
  nguoiChon: NguoiChon[];
  nhoms: NhomDungChung[];
  onChanged: () => void;
  /** Tạo nhóm mới xong — màn bỏ tick, ô nổi đóng. */
  onCreated: () => void;
  onClose: () => void;
}) {
  const [loc, setLoc] = useState("");
  const [tao, setTao] = useState(false);
  const [ten, setTen] = useState("");
  const [ban, setBan] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const ids = nguoiChon.map((n) => n.userId);
  const so = ids.length;

  const hien = loc.trim() ? nhoms.filter((n) => khopGanDung(n.ten, loc)) : nhoms;

  async function batTat(n: NhomDungChung) {
    const coSan = n.thanh_viens.map((tv) => tv.user_id);
    const du = ids.every((i) => coSan.includes(i));
    const moi = du ? coSan.filter((i) => !ids.includes(i)) : [...new Set([...coSan, ...ids])];
    setBan(true);
    setLoi(null);
    try {
      await api.nhomDungChung.update(token, n.id, { userIds: moi });
      onChanged();
    } catch (e) {
      setLoi(loiCua(e, "Không cập nhật được nhóm"));
    } finally {
      setBan(false);
    }
  }

  async function taoMoi() {
    const t = ten.trim();
    if (!t) {
      setLoi("Nhập tên nhóm trước");
      return;
    }
    setBan(true);
    setLoi(null);
    try {
      await api.nhomDungChung.create(token, t, ids);
      onChanged();
      onCreated();
    } catch (e) {
      setLoi(loiCua(e, "Không tạo được nhóm"));
      setBan(false);
    }
  }

  return (
    <OPopover anchor={anchor} onClose={onClose} label="Thêm vào nhóm dùng chung">
      <div className="ndc-pop__hd">
        <b>Thêm {so} người vào nhóm</b>
        <span>Bấm lại nhóm đã tick để gỡ ra.</span>
      </div>
      {nhoms.length > 4 && <OTim value={loc} onChange={setLoc} placeholder="Tìm nhóm" />}
      <div className="ndc-pop__list">
        {hien.map((n) => {
          const co = ids.filter((i) => n.thanh_viens.some((tv) => tv.user_id === i)).length;
          const st = co === so ? "on" : co > 0 ? "mid" : "";
          return (
            <button
              key={n.id}
              type="button"
              className="ndc-pop__opt"
              disabled={ban}
              aria-pressed={st === "on"}
              onClick={() => void batTat(n)}
            >
              <OTick trangThai={st} />
              <span className="ndc-pop__opt-stack">
                <span className="ndc-pop__opt-label">{n.ten}</span>
                <span className="ndc-pop__sub">{n.thanh_viens.length} thành viên</span>
              </span>
              {st === "on" && <span className="ndc-pop__meta ndc-pop__meta--ok">Đã ở nhóm</span>}
              {st === "mid" && (
                <span className="ndc-pop__meta">
                  {co}/{so} người đã ở
                </span>
              )}
            </button>
          );
        })}
        {nhoms.length === 0 && <div className="ndc-pop__empty">Chưa có nhóm nào.</div>}
        {nhoms.length > 0 && hien.length === 0 && <div className="ndc-pop__empty">Không có nhóm khớp.</div>}
      </div>
      {loi && <div className="ndc-pop__loi">{loi}</div>}
      <div className="ndc-pop__ft">
        {tao ? (
          <div className="ndc-pop__new">
            <input
              autoFocus
              maxLength={255}
              placeholder="Tên nhóm, vd: Cặp KD 3"
              value={ten}
              onChange={(e) => {
                setTen(e.target.value);
                setLoi(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void taoMoi();
              }}
            />
            <button type="button" className="ndc-pop__btn ndc-pop__btn--primary" disabled={ban} onClick={() => void taoMoi()}>
              Tạo
            </button>
          </div>
        ) : (
          <button type="button" className="ndc-pop__opt ndc-pop__opt--accent" onClick={() => setTao(true)}>
            <span className="ndc-pop__lead" aria-hidden="true">
              <Plus size={14} />
            </span>
            Tạo nhóm mới từ {so} người này
          </button>
        )}
      </div>
    </OPopover>
  );
}

/* ---------- bấm thẻ nhóm: xem / đổi tên / thêm-gỡ / xoá ---------- */
export function PopNhom({
  token,
  anchor,
  nhom,
  ungVien,
  onChanged,
  onClose,
}: {
  token: string;
  anchor: HTMLElement;
  nhom: NhomDungChung;
  /** Người có tài khoản của phòng đang xem — nguồn để "Thêm người". */
  ungVien: NguoiChon[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [che, setChe] = useState<"xem" | "them">("xem");
  const [doiTen, setDoiTen] = useState(false);
  const [ten, setTen] = useState(nhom.ten);
  const [loc, setLoc] = useState("");
  const [ban, setBan] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [hoiXoa, setHoiXoa] = useState(false);
  const daLuuTen = useRef(false);

  const idsTrong = nhom.thanh_viens.map((tv) => tv.user_id);

  async function luuThanhVien(userIds: number[]) {
    setBan(true);
    setLoi(null);
    try {
      await api.nhomDungChung.update(token, nhom.id, { userIds });
      onChanged();
    } catch (e) {
      setLoi(loiCua(e, "Không cập nhật được nhóm"));
    } finally {
      setBan(false);
    }
  }

  async function xongDoiTen(luu: boolean) {
    if (daLuuTen.current) return;
    daLuuTen.current = true;
    const t = ten.trim();
    if (!luu || !t || t === nhom.ten) {
      setTen(nhom.ten);
      setDoiTen(false);
      return;
    }
    setBan(true);
    setLoi(null);
    try {
      await api.nhomDungChung.update(token, nhom.id, { ten: t });
      onChanged();
      setDoiTen(false);
    } catch (e) {
      setLoi(loiCua(e, "Không đổi được tên"));
      daLuuTen.current = false;
    } finally {
      setBan(false);
    }
  }

  async function xoa() {
    setBan(true);
    try {
      await api.nhomDungChung.remove(token, nhom.id);
      onChanged();
      onClose();
    } catch (e) {
      setLoi(loiCua(e, "Không xoá được nhóm"));
      setBan(false);
    }
  }

  // Ứng viên = người của phòng + người đang trong nhóm (có thể ở phòng khác) — để bỏ tick được.
  const nguon = [
    ...nhom.thanh_viens.map((tv) => ({ userId: tv.user_id, hoTen: tv.ho_ten, phu: `@${tv.username}` })),
    ...ungVien.filter((u) => !idsTrong.includes(u.userId)).map((u) => ({ ...u, phu: "" })),
  ];
  const hien = loc.trim() ? nguon.filter((n) => khopGanDung(`${n.hoTen} ${n.phu}`, loc)) : nguon;

  return (
    <OPopover anchor={anchor} onClose={onClose} label={`Nhóm dùng chung ${nhom.ten}`} width={320}>
      <div className="ndc-pop__head">
        <Users size={14} className="ndc-pop__icon" aria-hidden="true" />
        {doiTen ? (
          <input
            className="ndc-pop__rename"
            autoFocus
            maxLength={255}
            value={ten}
            aria-label="Tên nhóm"
            onFocus={(e) => e.target.select()}
            onChange={(e) => setTen(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void xongDoiTen(true);
              if (e.key === "Escape") {
                e.stopPropagation();
                void xongDoiTen(false);
              }
            }}
            onBlur={() => void xongDoiTen(true)}
          />
        ) : (
          <>
            <button
              type="button"
              className="ndc-pop__name"
              title="Bấm để đổi tên"
              aria-label={`Đổi tên nhóm ${nhom.ten}`}
              onClick={() => {
                daLuuTen.current = false;
                setTen(nhom.ten);
                setDoiTen(true);
              }}
            >
              {nhom.ten}
            </button>
            <Pencil size={12} className="ndc-pop__dim" aria-hidden="true" />
          </>
        )}
        <span className="ndc-pop__spacer" />
        <span className="ndc-pop__meta">{nhom.thanh_viens.length} người</span>
      </div>

      {che === "xem" ? (
        <>
          <div className="ndc-pop__list">
            {nhom.thanh_viens.map((tv) => (
              <div key={tv.user_id} className="ndc-pop__mem">
                <ChuDau hoTen={tv.ho_ten} />
                <span className="ndc-pop__opt-stack">
                  <span className="ndc-pop__mem-name">{tv.ho_ten}</span>
                  <span className="ndc-pop__sub">@{tv.username}</span>
                </span>
                <span className="ndc-pop__spacer" />
                <button
                  type="button"
                  className="ndc-pop__go"
                  disabled={ban}
                  title={`Gỡ ${tv.ho_ten} khỏi nhóm`}
                  onClick={() => void luuThanhVien(idsTrong.filter((i) => i !== tv.user_id))}
                >
                  Gỡ
                </button>
              </div>
            ))}
            {nhom.thanh_viens.length === 0 && <div className="ndc-pop__empty">Nhóm chưa có ai.</div>}
          </div>
          {loi && <div className="ndc-pop__loi">{loi}</div>}
          <div className="ndc-pop__ft ndc-pop__ft--row">
            <button type="button" className="ndc-pop__btn" onClick={() => setChe("them")}>
              <Plus size={13} /> Thêm người
            </button>
            <span className="ndc-pop__spacer" />
            <button type="button" className="ndc-pop__btn ndc-pop__btn--danger" disabled={ban} onClick={() => setHoiXoa(true)}>
              Xoá nhóm
            </button>
          </div>
        </>
      ) : (
        <>
          <OTim value={loc} onChange={setLoc} placeholder="Tìm tên hoặc tài khoản" />
          <div className="ndc-pop__list">
            {hien.map((n) => {
              const on = idsTrong.includes(n.userId);
              return (
                <button
                  key={n.userId}
                  type="button"
                  className="ndc-pop__opt"
                  disabled={ban}
                  aria-pressed={on}
                  onClick={() =>
                    void luuThanhVien(on ? idsTrong.filter((i) => i !== n.userId) : [...idsTrong, n.userId])
                  }
                >
                  <OTick trangThai={on ? "on" : ""} />
                  <ChuDau hoTen={n.hoTen} />
                  <span className="ndc-pop__opt-stack">
                    <span className="ndc-pop__opt-label">{n.hoTen}</span>
                    {n.phu && <span className="ndc-pop__sub">{n.phu}</span>}
                  </span>
                </button>
              );
            })}
            {hien.length === 0 && <div className="ndc-pop__empty">Không tìm thấy.</div>}
          </div>
          {loi && <div className="ndc-pop__loi">{loi}</div>}
          <div className="ndc-pop__ft ndc-pop__ft--row">
            <span className="ndc-pop__sub">Tick là lưu ngay</span>
            <span className="ndc-pop__spacer" />
            <button type="button" className="ndc-pop__btn ndc-pop__btn--primary" onClick={() => setChe("xem")}>
              Xong
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={hoiXoa}
        title={`Xoá nhóm “${nhom.ten}”?`}
        message={
          "Mọi người trong nhóm sẽ thôi dùng chung dữ liệu qua nhóm này. " +
          "Ai còn ở nhóm khác vẫn dùng chung qua nhóm đó. Dữ liệu không mất."
        }
        confirmLabel="Xoá nhóm"
        danger
        busy={ban}
        onConfirm={() => {
          setHoiXoa(false);
          void xoa();
        }}
        onCancel={() => setHoiXoa(false)}
      />
    </OPopover>
  );
}

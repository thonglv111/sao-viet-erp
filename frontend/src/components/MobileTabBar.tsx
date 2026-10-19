// ĐIỀU HƯỚNG ĐIỆN THOẠI (14/10/2026 — docs/thiet-ke-mobile.md §3).
//
// Chỉ AppShell vẽ, và chỉ khi `useLaDienThoai()` — máy lớn không có các phần tử này trong DOM.
//
// `MobileTabBar` — thanh dưới, 5 ô trong tầm ngón cái (chủ chốt 14/10):
//   Của tôi · Công của tôi · Nghỉ phép · Phiếu lương · Menu
//   Ba ô giữa mở đúng màn nguồn mà "Hồ sơ của tôi" vẫn dẫn sang (Chấm công / Nghỉ phép / Lương);
//   ai không có quyền màn đó thì ô đó tự ẩn — không mở cửa phụ nào ngoài ma trận quyền.
//
// `ChuongViec` — chuông trên thanh trên, cạnh avatar: số trên chuông = tổng badge của menu (cùng
//   nguồn real-time với sidebar nên tự nhảy); chạm mở bảng đáy liệt kê từng mục đang có việc chờ.
import { useEffect, useMemo, useState } from "react";
import type { NavParams } from "./AppShell";
import { Icon, type IconName } from "./Icons";
import { AUTHENTICATED_NAV_IDS, NAV, type NavItem } from "./Sidebar";

export interface MucNhanh {
  id: string;
  label: string;
  icon: IconName;
  nhom: string;
}

/** Bảng tra id → nhãn/icon/nhóm của MỌI mục người này được vào — cùng luật lọc với Sidebar
 *  (menu tĩnh + mục động kho/tổ + menu con, theo `readable`, bỏ `hiddenIds`). */
export function bangMuc(
  dynamicItems: Record<string, NavItem[]>,
  itemChildren: Record<string, { id: string; label: string; module?: string }[]>,
  readable: ReadonlySet<string>,
  hiddenIds: ReadonlySet<string>,
): Map<string, MucNhanh> {
  const m = new Map<string, MucNhanh>();
  for (const s of NAV) {
    for (const i of [...s.items, ...(dynamicItems[s.id] ?? [])]) {
      if (hiddenIds.has(i.id)) continue;
      if (!AUTHENTICATED_NAV_IDS.has(i.id) && !(i.modules ?? [i.module]).some((k) => readable.has(k))) continue;
      m.set(i.id, { id: i.id, label: i.label, icon: i.icon, nhom: s.label });
      for (const c of itemChildren[i.id] ?? i.children ?? []) {
        if (c.module && !readable.has(c.module)) continue;
        m.set(c.id, { id: c.id, label: c.label, icon: i.icon, nhom: i.label });
      }
    }
  }
  return m;
}

/** Ô thanh dưới: id màn · nhãn · icon. */
const O_DUOI: { id: string; nhan: string; icon: IconName; params?: NavParams }[] = [
  { id: "ho-so-cua-toi", nhan: "Của tôi", icon: "userCircle" },
  { id: "cham-cong", nhan: "Công của tôi", icon: "clock", params: { chamCongTab: "my-timesheet" } },
  { id: "nghi-phep", nhan: "Nghỉ phép", icon: "calendar" },
  { id: "luong", nhan: "Phiếu lương", icon: "wallet", params: { luongTab: "phieu" } },
];

interface TabBarProps {
  activeId: string;
  badges: Record<string, number>;
  muc: Map<string, MucNhanh>;
  menuOpen: boolean;
  onSelect: (id: string, params?: NavParams) => void;
  onMenu: () => void;
}

export function MobileTabBar({ activeId, badges, muc, menuOpen, onSelect, onMenu }: TabBarProps) {
  const cacO = O_DUOI.filter((o) => muc.has(o.id));
  return (
    <nav className="dt-tabbar" aria-label="Điều hướng nhanh" style={{ ["--dt-so-o" as string]: cacO.length + 1 }}>
      {cacO.map((o) => {
        const n = badges[o.id] ?? 0;
        return (
          <button
            key={o.id}
            type="button"
            className={`dt-tabbar__o${activeId === o.id && !menuOpen ? " is-on" : ""}`}
            onClick={() => onSelect(o.id, o.params)}
            aria-current={activeId === o.id ? "page" : undefined}
          >
            <span className="dt-tabbar__icon">
              <Icon name={o.icon} size={22} />
              {n > 0 && <span className="dt-tabbar__badge">{n > 99 ? "99+" : n}</span>}
            </span>
            <span>{o.nhan}</span>
          </button>
        );
      })}
      <button
        type="button"
        className={`dt-tabbar__o${menuOpen ? " is-on" : ""}`}
        onClick={onMenu}
        aria-expanded={menuOpen}
      >
        <Icon name={menuOpen ? "x" : "grid"} size={22} />
        <span>{menuOpen ? "Đóng" : "Menu"}</span>
      </button>
    </nav>
  );
}

interface ChuongProps {
  activeId: string;
  badges: Record<string, number>;
  muc: Map<string, MucNhanh>;
  onSelect: (id: string) => void;
}

export function ChuongViec({ activeId, badges, muc, onSelect }: ChuongProps) {
  const [mo, setMo] = useState(false);

  // Đổi màn ⇒ đóng bảng.
  useEffect(() => setMo(false), [activeId]);

  const viec = useMemo(
    () =>
      Object.entries(badges)
        .filter(([id, n]) => n > 0 && muc.has(id))
        .map(([id, n]) => ({ ...muc.get(id)!, n }))
        .sort((a, b) => b.n - a.n),
    [badges, muc],
  );
  const tong = viec.reduce((s, v) => s + v.n, 0);

  return (
    <>
      <button
        type="button"
        className={`dt-chuong${mo ? " is-on" : ""}`}
        onClick={() => setMo((v) => !v)}
        aria-label={tong ? `Việc chờ: ${tong}` : "Việc chờ"}
        aria-expanded={mo}
      >
        <Icon name="bell" size={21} />
        {tong > 0 && <span className="dt-chuong__so">{tong > 99 ? "99+" : tong}</span>}
      </button>

      {mo && (
        <div className="dt-bang" role="presentation" onClick={() => setMo(false)}>
          <div
            className="dt-bang__hop"
            role="dialog"
            aria-modal="true"
            aria-label="Việc chờ"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dt-bang__tay" aria-hidden="true" />
            <div className="dt-bang__dau">
              <h2>Việc chờ bạn</h2>
              <button type="button" className="dt-bang__x" onClick={() => setMo(false)} aria-label="Đóng">
                <Icon name="x" size={18} />
              </button>
            </div>
            <ul className="dt-bang__ds">
              {viec.length ? (
                viec.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      className="dt-bang__muc"
                      onClick={() => {
                        setMo(false);
                        onSelect(v.id);
                      }}
                    >
                      <span className="dt-bang__icon">
                        <Icon name={v.icon} size={18} />
                      </span>
                      <span className="dt-bang__chu">
                        <strong>{v.label}</strong>
                        <small>{v.nhom}</small>
                      </span>
                      <span className="dt-bang__so">{v.n > 99 ? "99+" : v.n}</span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="dt-bang__trong">Không có việc nào đang chờ bạn.</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

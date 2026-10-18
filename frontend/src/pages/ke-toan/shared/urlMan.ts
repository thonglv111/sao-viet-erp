/** Trạng thái lọc + kỳ của một màn kế toán ghi lên URL (đặc tả A.18): gửi link cho người khác thấy
 *  đúng danh sách đó, tải lại trang không mất lọc.
 *
 *  App KHÔNG định tuyến bằng URL (AppShell giữ màn đang mở trong state), nên query mang thêm dấu
 *  `man=<mã màn>`: chỉ màn trùng mã mới đọc các khoá còn lại (Phiếu thu không ăn nhầm `ky` của
 *  Phiếu chi), và AppShell đọc `man` lúc mở app để vào thẳng màn đó. Mỗi màn chỉ đụng khoá của
 *  mình — khoá lạ (của ai khác) giữ nguyên, hash (`#lsx=…` của phiếu công nghệ) giữ nguyên. Ghi
 *  bằng `history.replaceState`: đổi lọc không đẻ thêm bước "Back". Gỡ màn thì dọn khoá của mình
 *  (dấu `man` thì AppShell giữ/đổi/dọn theo màn đang mở — `datManDangMo`, `boManDangMo`).
 */
import { useEffect, useRef } from "react";

export const KHOA_MAN = "man";

/** Khoá → chuỗi; `undefined` = bỏ khoá khỏi URL (giá trị mặc định không cần ghi). */
export type GiaTriUrl = Record<string, string | undefined>;

const MA_MAN_HOP_LE = /^[a-z0-9-]+(:\d+)?$/;

const searchHienTai = () => (typeof window === "undefined" ? "" : window.location.search);

/** Mã màn đang ghi trên URL (để AppShell mở thẳng màn đó); không có hoặc rác thì null. */
export function manTrenUrl(search: string = searchHienTai()): string | null {
  const m = new URLSearchParams(search).get(KHOA_MAN);
  return m && MA_MAN_HOP_LE.test(m) ? m : null;
}

/** Query của màn `man` nếu URL đang thuộc màn đó; URL của màn khác / không có dấu thì null. */
export function docThamSoMan(man: string, search: string = searchHienTai()): URLSearchParams | null {
  const p = new URLSearchParams(search);
  return p.get(KHOA_MAN) === man ? p : null;
}

const raChuoi = (p: URLSearchParams) => (p.toString() ? `?${p.toString()}` : "");

/** Gộp giá trị của màn vào query đang có: đặt dấu `man`, ghi/bỏ từng khoá, giữ khoá lạ. */
export function ghiThamSoMan(search: string, man: string, giaTri: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams(search);
  p.set(KHOA_MAN, man);
  for (const [k, v] of Object.entries(giaTri)) {
    if (v == null || v === "") p.delete(k);
    else p.set(k, v);
  }
  return raChuoi(p);
}

/** Bỏ các khoá của màn; dấu `man` chỉ bỏ khi nó đang là của màn này (và không `giuMan`). */
export function boThamSoMan(search: string, man: string, khoa: readonly string[], giuMan = false): string {
  const p = new URLSearchParams(search);
  for (const k of khoa) p.delete(k);
  if (!giuMan && p.get(KHOA_MAN) === man) p.delete(KHOA_MAN);
  return raChuoi(p);
}

/** Đặt dấu `man` = màn đang mở, giữ nguyên mọi khoá khác. Việc của AppShell: nó biết màn nào đang mở,
 *  còn màn con chỉ ghi khoá lọc của mình (nhiều màn không ghi gì ⇒ trước đây URL trơ về `/`). */
export function datManDangMo(man: string): void {
  if (typeof window === "undefined" || !MA_MAN_HOP_LE.test(man)) return;
  const p = new URLSearchParams(window.location.search);
  if (p.get(KHOA_MAN) === man) return;
  p.set(KHOA_MAN, man);
  thayQuery(raChuoi(p));
}

/** AppShell gỡ/đổi màn: dọn dấu `man` nếu nó vẫn là của màn vừa rời. */
export function boManDangMo(man: string): void {
  if (typeof window === "undefined") return;
  if (new URLSearchParams(window.location.search).get(KHOA_MAN) !== man) return;
  thayQuery(boThamSoMan(window.location.search, man, []));
}

function thayQuery(search: string) {
  const { pathname, hash } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname}${search}${hash}`);
}

/** Đồng bộ `giaTri` của màn lên URL mỗi khi đổi; gỡ màn thì dọn mọi khoá đã từng ghi.
 *  Đọc lúc mở là việc của nơi gọi (`docThamSoMan` trong bộ khởi tạo `useState`). */
export function useDongBoUrl(man: string, giaTri: GiaTriUrl): void {
  const daGhi = useRef(new Set<string>());
  // `undefined` → null: JSON.stringify bỏ khoá undefined, mà khoá về rỗng thì phải XOÁ khỏi URL.
  const chuoi = JSON.stringify(giaTri, (_k, v) => (v === undefined ? null : v));
  useEffect(() => {
    const g = JSON.parse(chuoi) as Record<string, string | null>;
    for (const k of Object.keys(g)) daGhi.current.add(k);
    const moi = ghiThamSoMan(window.location.search, man, g);
    if (moi !== window.location.search) thayQuery(moi);
  }, [man, chuoi]);
  useEffect(() => {
    const khoa = daGhi.current;
    // Chỉ dọn KHOÁ của màn, GIỮ dấu `man`: màn con (tab Lương, danh sách phiếu tính giá) gỡ ra khi
    // người dùng đổi tab hay mở một phiếu, mà màn bao quanh vẫn đang mở. Dấu `man` do AppShell lo.
    return () => thayQuery(boThamSoMan(window.location.search, man, [...khoa], true));
  }, [man]);
}

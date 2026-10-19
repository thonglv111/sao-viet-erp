// Ô chọn NCC theo DÒNG hàng — cụm "chào giá" (tách từ pages/PurchaseRequestsPage.tsx).
// ⚠️ Hợp đồng "rẻ trước + mang giá/VAT của NCC" nằm ở `chaoGiaChoMatHang` (shared/helpers.ts)
// và ở chỗ gọi `onPick` bên PurchaseFormDrawer — ba mảnh đó phải đọc cùng nhau.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import type { DonViDungDuoc, SupplierRow } from "../../../../api/client";
import { chuanKho } from "../../../../lib/khoGiay";
import { tenDonVi } from "../../../tenDonVi";
import { chaoGiaChoMatHang, normalizeItemName, tenGon } from "../shared/helpers";
import type { ChaoGia, FormLine } from "../shared/types";

const khoaChao = (c: ChaoGia) => `${c.supplier_id}:${c.supplier_item_id}`;
const so = (n: number) => Math.round(n).toLocaleString("vi-VN");

/** Ô chọn nhà cung cấp cho MỘT dòng hàng — rẻ nhất lên trước.
 *
 * Hộp chọn TỰ DỰNG (14/10/2026), không dùng <select> gốc: ô gốc không canh được giá thành cột,
 * nhãn nhóm luôn in đậm, và phải nhét giá vào ngoặc sau tên. Ở đây tên bên trái, giá canh phải,
 * nhóm chia theo đơn vị NCC bán ("Bán theo tờ" / "Bán theo kg"). Ô đóng chỉ hiện TÊN — giá đã nằm
 * ở ô Đơn giá của dòng.
 *
 * Chưa gõ tên vật tư thì chưa biết hỏi ai ⇒ ô khoá lại và nói rõ. Gõ tên mà không ai bán thì cũng
 * nói thẳng, không để ô rỗng im lặng rồi người dùng bấm Lưu mới biết. */
export function LineSupplierPicker({
  line,
  suppliers,
  dsDonVi,
  onPick,
  loi,
}: {
  line: FormLine;
  suppliers: SupplierRow[];
  /** Danh sách đơn vị của mặt hàng — để biết NCC bán cùng họ đơn vị với dòng hay không. */
  dsDonVi?: DonViDungDuoc[];
  onPick: (chao: ChaoGia | null) => void;
  /** Đã bấm Lưu mà chưa chọn ⇒ viền đỏ. */
  loi?: boolean;
}) {
  const tatCa = chaoGiaChoMatHang(line, suppliers, dsDonVi);
  const cungHo = tatCa.filter((c) => c.cung_ho);
  const khacHo = tatCa.filter((c) => !c.cung_ho);
  const chuaGoTen = !normalizeItemName(line.item_name) && !line.hang_id;
  const laGiay = line.hang_loai === "giay";
  const [r, d] = chuanKho(line.kho_rong, line.kho_dai);
  const dv = tenDonVi(line.unit) ?? line.unit;
  // Có nhóm bán đơn vị khác thì mọi nhóm gọi theo đơn vị; không thì giấy gọi theo khổ (NCC chỉ được
  // so trong cùng khổ), hàng khác khỏi tiêu đề.
  const nhanChinh = khacHo.length > 0 && dv
    ? `Bán theo ${dv}`
    : laGiay
      ? `${r ? (d ? `Khổ ${r} × ${d} mm` : `Khổ ${r} mm`) : "Chưa ghi khổ"}${dv ? ` theo ${dv}` : ""}`
      : null;
  // Nhóm bán đơn vị khác TÁCH theo từng đơn vị. Chọn là dòng đổi đơn vị: ô Số lượng tự trống + hiện
  // số đề nghị gốc (PurchaseFormDrawer).
  const nhom: { nhan: string | null; ds: { c: ChaoGia; gia: string }[] }[] = [];
  if (cungHo.length > 0) {
    nhom.push({
      nhan: nhanChinh,
      ds: cungHo.map((c) => ({ c, gia: c.gia_dong != null ? `${so(c.gia_dong)} đ/${dv}` : "chưa quy đổi" })),
    });
  }
  for (const u of new Set(khacHo.map((c) => c.unit))) {
    const tenU = tenDonVi(u) ?? u;
    nhom.push({
      nhan: `Bán theo ${tenU}`,
      ds: khacHo.filter((c) => c.unit === u).map((c) => ({ c, gia: `${so(c.unit_price)} đ/${tenU}` })),
    });
  }
  const phang = nhom.flatMap((g) => g.ds.map((x) => x.c));
  const dangChon =
    tatCa.find((c) => c.supplier_id === line.supplier_id && c.cung_ho) ??
    tatCa.find((c) => c.supplier_id === line.supplier_id);

  const [mo, setMo] = useState(false);
  const [sang, setSang] = useState(0);
  const [viTri, setViTri] = useState<{ left: number; top: number; width: number; len: boolean } | null>(null);
  const nutRef = useRef<HTMLButtonElement>(null);
  const hopRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // Hộp gắn vào body (bảng trong ngăn có overflow, đặt tại chỗ là bị cắt) ⇒ tự đo vị trí theo nút,
  // đo lại khi cuộn/đổi cỡ. Dưới hết chỗ thì mở lên trên.
  useLayoutEffect(() => {
    if (!mo) return;
    const do_ = () => {
      const b = nutRef.current?.getBoundingClientRect();
      if (!b) return;
      const cao = hopRef.current?.offsetHeight ?? 240;
      const len = b.bottom + 4 + cao > window.innerHeight && b.top - 4 - cao > 0;
      setViTri({ left: b.left, top: len ? b.top - 4 - cao : b.bottom + 4, width: b.width, len });
    };
    do_();
    window.addEventListener("scroll", do_, true);
    window.addEventListener("resize", do_);
    return () => {
      window.removeEventListener("scroll", do_, true);
      window.removeEventListener("resize", do_);
    };
  }, [mo]);

  useEffect(() => {
    if (!mo) return;
    const dong = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!nutRef.current?.contains(t) && !hopRef.current?.contains(t)) setMo(false);
    };
    document.addEventListener("mousedown", dong);
    return () => document.removeEventListener("mousedown", dong);
  }, [mo]);

  if (chuaGoTen || tatCa.length === 0) {
    return (
      <button type="button" className="dfa-nccb" disabled aria-label="Nhà cung cấp của dòng">
        <span className="dfa-nccb__chu dfa-nccb__chu--mo">
          {chuaGoTen ? "Nhập vật tư trước" : laGiay ? "Chưa có NCC bán khổ này" : "Chưa có NCC nào bán"}
        </span>
      </button>
    );
  }

  const moHop = () => {
    const i = dangChon ? phang.findIndex((c) => khoaChao(c) === khoaChao(dangChon)) : 0;
    setSang(Math.max(0, i));
    setMo(true);
  };
  const chon = (c: ChaoGia) => {
    onPick(c);
    setMo(false);
    nutRef.current?.focus();
  };
  const phim = (e: KeyboardEvent) => {
    if (!mo) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        moHop();
      }
      return;
    }
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      setMo(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSang((s) => Math.min(phang.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSang((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (phang[sang]) chon(phang[sang]);
    }
  };

  let thuTu = -1;
  return (
    <>
      <button
        ref={nutRef}
        type="button"
        className={`dfa-nccb${mo ? " mo" : ""}${loi && !dangChon ? " loi" : ""}`}
        aria-label="Nhà cung cấp của dòng"
        aria-haspopup="listbox"
        aria-expanded={mo}
        aria-controls={mo ? id : undefined}
        aria-activedescendant={mo ? `${id}-${sang}` : undefined}
        title={dangChon?.supplier_name}
        onClick={() => (mo ? setMo(false) : moHop())}
        onKeyDown={phim}
      >
        <span className={`dfa-nccb__chu${dangChon ? "" : " dfa-nccb__chu--mo"}`}>
          {dangChon ? tenGon(dangChon.supplier_name) : "Chọn nhà cung cấp"}
        </span>
        <svg className="dfa-nccb__mui" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {/* Ô chọn tự dựng không tham gia kiểm form gốc ⇒ ô ẩn này giữ luật "bắt buộc chọn": bấm Lưu khi
          trống thì trình duyệt chặn và đưa con trỏ về nút. */}
      <input
        className="dfa-nccb__giu"
        tabIndex={-1}
        aria-hidden="true"
        required
        value={dangChon ? khoaChao(dangChon) : ""}
        onChange={() => undefined}
        onFocus={() => nutRef.current?.focus()}
      />
      {mo && createPortal(
        <div
          ref={hopRef}
          id={id}
          role="listbox"
          className="dfa-nccp"
          style={viTri ? { left: viTri.left, top: viTri.top, minWidth: viTri.width } : { visibility: "hidden" }}
        >
          {nhom.map((g, gi) => (
            <div key={gi} role="group" aria-label={g.nhan ?? undefined} className="dfa-nccp__nhom">
              {g.nhan && <div className="dfa-nccp__nhan">{g.nhan}</div>}
              {g.ds.map(({ c, gia }) => {
                thuTu += 1;
                const i = thuTu;
                const laChon = dangChon != null && khoaChao(c) === khoaChao(dangChon);
                return (
                  <div
                    key={khoaChao(c)}
                    id={`${id}-${i}`}
                    role="option"
                    aria-selected={laChon}
                    className={`dfa-nccp__dong${i === sang ? " sang" : ""}${laChon ? " chon" : ""}`}
                    onMouseEnter={() => setSang(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => chon(c)}
                  >
                    <span className="dfa-nccp__tick" aria-hidden="true">{laChon ? "✓" : ""}</span>
                    <span className="dfa-nccp__ten" title={c.supplier_name}>{tenGon(c.supplier_name)}</span>
                    <span className="dfa-nccp__gia">{gia}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

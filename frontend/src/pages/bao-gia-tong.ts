// Cộng tổng khối "Giá bán đề xuất" của chi tiết báo giá (tách ra 18/10/2026 để thử được riêng).

/** Số của MỘT dòng như bảng dòng đang hiện (có thể còn lẻ đồng — giá vốn khoá, VAT theo %). */
export interface DongTien {
  cost: number;
  ck: number;
  selling: number;
  /** Kê giá của dòng (20/10/2026) — cộng SAU giá bán; VAT tính trên giá bán + kê. */
  ke?: number;
  /** % VAT của dòng. */
  vatPct: number;
}

/** Dòng được cộng vào tổng. Khách chốt MỘT PHẦN ⇒ chỉ dòng khách lấy (#13) — đúng số đơn hàng nhận.
 *  Cờ `accepted` chỉ có nghĩa sau khi chốt; báo giá cũ chốt trước khi có cờ (không dòng nào true)
 *  thì cộng hết, giống đơn hàng kéo hết. */
export function dongDuocCong<T extends { accepted?: boolean }>(items: T[], daChot: boolean): T[] {
  return daChot && items.some((it) => it.accepted) ? items.filter((it) => it.accepted) : items;
}

/** Cộng số ĐÃ LÀM TRÒN của từng dòng (#10): người xem cộng tay các dòng đang hiện phải ra đúng tổng.
 *  Lợi nhuận = giá bán − giá vốn − chiết khấu (đã tròn). Gồm VAT = ⌊Σ giá tròn·(100 + VAT%)/100⌋ —
 *  CÙNG phép tính của máy chủ (`_cong_tong`) và của đơn hàng, nên khối tổng, lịch sử phiên bản, danh
 *  sách và đơn kéo sang khớp tới từng đồng (#62, bấm lại 19/10). */
export function congTongBaoGia(dong: DongTien[]) {
  let cost = 0, ck = 0, selling = 0, ke = 0, sauKe = 0, gomX100 = 0;
  for (const d of dong) {
    const ban = Math.round(d.selling);
    const k = Math.round(d.ke ?? 0);
    // Giá bán sau kê tròn MỘT lần như máy chủ (`round(selling + ke)`).
    const sau = Math.round(d.selling + (d.ke ?? 0));
    cost += Math.round(d.cost);
    ck += Math.round(d.ck);
    selling += ban;
    ke += k;
    sauKe += sau;
    gomX100 += sau * (100 + Math.round(d.vatPct || 0));
  }
  const grand = Math.floor(gomX100 / 100);
  // Lợi nhuận tính trên giá bán (trước kê) — kê không phải lãi của công ty.
  return { cost, ck, selling, ke, sauKe, vat: grand - sauKe, grand, profit: selling - cost - ck };
}

// Chọn sản phẩm nào của phiếu cần gọi lại `/binh-bai` (04/10/2026).
//
// Chữ ký bình bài của màn phiếu gộp CẢ phiếu, nên trước đây sửa một sản phẩm là `/binh-bai` chạy lại
// cho MỌI sản phẩm đang tự xếp con. Nay chỉ sản phẩm có số bình bài CỦA CHÍNH NÓ khác lần gửi trước.

/** Đầu vào bình bài của một sản phẩm — đúng các khoá trong chữ ký `binhBaiSig`. */
export interface DongBinhBai {
  u: string;
  a: boolean;
  kd: number;
  kr: number;
  d: number;
  r: number;
  cd: number;
  cr: number;
}

/** Sản phẩm tự xếp con, đủ khổ, và có số khác lần gửi trước. `daGui` (uid → chữ ký đã gửi) do nơi
 *  gọi giữ qua các lần render; hàm XOÁ khỏi đó sản phẩm thôi tự xếp — bật lại với đúng số cũ vẫn
 *  phải xếp lại, vì Số con có thể đã bị gõ tay trong lúc tắt. Nơi gọi tự `set` khi thật sự gửi. */
export function chonBinhBaiCanGoi(rows: DongBinhBai[], daGui: Map<string, string>): DongBinhBai[] {
  return rows.filter((x) => {
    const la = x.a && x.kd > 0 && x.kr > 0 && x.d > 0 && x.r > 0;
    if (!la) daGui.delete(x.u);
    return la && daGui.get(x.u) !== JSON.stringify(x);
  });
}

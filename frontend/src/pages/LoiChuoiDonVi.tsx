/** Lỗi chuỗi công đoạn ĐỨT ĐƠN VỊ của một sản phẩm (engine trả `loi_chuoi`, lỗi #8 18/10/2026).
 *
 *  Chuỗi đứt thì số tờ và bù hao tính ra là số sai (chia số con hai lần, bù hao âm) — máy chủ từ
 *  chối lưu phiếu. Khối này đứng ĐẦU khối Số tờ để người lập thấy vì sao chưa ra giá, trước khi
 *  bấm "Tính giá" rồi mới ăn lỗi. Không có lỗi thì không vẽ gì. */
export function LoiChuoiDonVi({ loi }: { loi?: string[] | null }) {
  if (!loi?.length) return null;
  return (
    <div className="banner banner--error" role="alert">
      Chuỗi công đoạn đứt đơn vị nên chưa ra giá được. Sửa thứ tự hoặc đơn vị vào/ra của công đoạn:
      <ul>
        {loi.map((s) => (
          <li key={s}>{s.replace(/^Thành phần '[^']*': /, "")}</li>
        ))}
      </ul>
    </div>
  );
}

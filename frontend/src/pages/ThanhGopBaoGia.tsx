// Thanh gộp dòng khi báo giá của phiếu tính giá (mục thành phần): hiện khi có dòng được tick.
// Tách khỏi `PhieuTinhGiaDetailView` để test được riêng — màn đó kéo theo cả chục lượt tải.
export function ThanhGopBaoGia({
  soChon,
  tenNhom,
  onTenNhom,
  nhomDaCo,
  onApDung,
  onBo,
}: {
  soChon: number;
  tenNhom: string;
  onTenNhom: (v: string) => void;
  /** Tên nhóm đã dùng ở các dòng khác — gợi ý khi gõ. */
  nhomDaCo: string[];
  onApDung: () => void;
  onBo: () => void;
}) {
  return (
    <div className="tg-gopbar" role="group" aria-label="Gộp dòng khi báo giá">
      <span className="tg-gopbar__count">{soChon} dòng đã chọn</span>
      <input
        className="tg-input tg-gopbar__input"
        type="text"
        list="tg-nhom-goiy"
        value={tenNhom}
        placeholder="Tên in ra báo giá, vd Sách hướng dẫn A5"
        aria-label="Tên nhóm in ra báo giá"
        onChange={(e) => onTenNhom(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onApDung();
          }
        }}
      />
      <datalist id="tg-nhom-goiy">
        {nhomDaCo.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <button
        type="button"
        className="tg-chip tg-chip--on"
        onClick={onApDung}
        disabled={!tenNhom.trim()}
        // Khoá mà không nói vì sao thì người dùng phải tự đoán ra ô "Tên in ra báo giá…" (E2E #9).
        title={tenNhom.trim() ? undefined : "Gõ tên in ra báo giá trước khi gộp"}
      >
        Gộp khi báo giá
      </button>
      <button type="button" className="tg-chip" onClick={onBo}>
        Bỏ gộp
      </button>
    </div>
  );
}

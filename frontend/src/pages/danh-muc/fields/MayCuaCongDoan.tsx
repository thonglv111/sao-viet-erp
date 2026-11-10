// MÁY chạy được công đoạn này, mỗi dòng mang cách đo GIỜ và cách tính GIÁ của riêng cặp đó.
//
// Vì sao là bảng ở đây chứ không phải cột trên máy (06/09/2026): cùng một máy chạy hai công đoạn
// thì đo khác nhau — In khổ 79×109 và In khổ 11×11 không thể chung một công thức. Cùng lẽ đó,
// đơn giá cũng theo máy: máy 5 màu khổ lớn và máy 2 màu khổ nhỏ có giá khác nhau.
//
// MÁY ĐI THEO TỔ (22/10/2026, spec máy thuộc tổ §4.4): bảng tự hiện máy của các tổ đang tick ở ô
// "Tổ phụ trách" (máy khai tổ ở danh mục Thiết bị & Máy móc) — không còn chọn tay, không xoá dòng.
// Dòng của máy ra khỏi phạm vi tổ nằm im ở máy chủ (`may_khai`), tick lại là hiện lại số cũ.
// Công đoạn chưa tick tổ nào ⇒ giữ bảng đã khai như cũ (không ràng buộc).
//
// Máy ĐẦU bảng là MÁY MẶC ĐỊNH (12/10/2026) — bước lệnh / lượt chạy chung mới ra đời tự điền máy này
// (`LsxService._may_mac_dinh`), cùng luật tổ đầu = tổ mặc định. Thứ tự lưu xuống `cong_doan_may.thu_tu`.
import { useMemo, useState } from "react";

import type { MayCongDoanRow, Row } from "../types";
import { FormulaField } from "./FormulaField";
import { FormulaPopover } from "./FormulaPopover";

/** Tổ (trong các tổ đang tick) mà máy thuộc. */
function toCuaMay(may: Row | undefined, toDangTick: number[]): number[] {
  const cua = Array.isArray(may?.to_ids) ? (may.to_ids as unknown[]).map(Number) : [];
  return toDangTick.filter((t) => cua.includes(t));
}

export function MayCuaCongDoanField({
  value, options, toDangTick = [], mayKhai = [], tenTo = {}, nhomCongDoan, congThucChung = "", onChange,
}: {
  value: MayCongDoanRow[]; options: Row[];
  /** Tổ đang tick ở ô "Tổ phụ trách" của form — bảng hiện máy của các tổ này. */
  toDangTick?: number[];
  /** Mọi dòng máy đã khai ở máy chủ, kể cả dòng nằm im — lấy lại công thức khi tick lại tổ. */
  mayKhai?: MayCongDoanRow[];
  tenTo?: Record<number, string>;
  nhomCongDoan: string;
  /** Công thức giá CHUNG của công đoạn — popup giá riêng đang trống thì mời "lấy làm gốc". */
  congThucChung?: string;
  onChange: (v: MayCongDoanRow[]) => void;
}) {
  const theoId = useMemo(() => new Map(options.map((o) => [Number(o.id), o])), [options]);
  // Dòng ĐANG HIỆN: chưa tick tổ ⇒ đúng bảng đã khai; có tổ ⇒ máy thuộc ít nhất một tổ đang tick,
  // số lấy từ form (đang sửa) rồi tới bản đã lưu (kể cả dòng nằm im), không có thì trống. Thứ tự:
  // theo form (giữ "Đặt mặc định"), rồi theo bản đã lưu, rồi máy mới vào theo mã.
  const chon = useMemo<MayCongDoanRow[]>(() => {
    const ds = Array.isArray(value) ? value : [];
    if (toDangTick.length === 0) return ds;
    const trongPhamVi = options.filter((o) => toCuaMay(o, toDangTick).length > 0);
    const coMat = new Set(trongPhamVi.map((o) => Number(o.id)));
    const theoForm = new Map(ds.map((r) => [r.may_id, r]));
    const theoKhai = new Map(mayKhai.map((r) => [r.may_id, r]));
    const thuTu = [
      ...ds.map((r) => r.may_id),
      ...mayKhai.map((r) => r.may_id),
      ...[...trongPhamVi].sort((a, b) => String(a.ma).localeCompare(String(b.ma))).map((o) => Number(o.id)),
    ];
    const ra: MayCongDoanRow[] = [];
    for (const id of new Set(thuTu)) {
      if (!coMat.has(id)) continue;
      const r = theoForm.get(id) ?? theoKhai.get(id);
      ra.push({ may_id: id, cong_thuc_gio: r?.cong_thuc_gio ?? null, cong_thuc_gia: r?.cong_thuc_gia ?? null });
    }
    return ra;
  }, [value, options, toDangTick, mayKhai]);
  // Panel đang mở khoá theo CẶP (máy, ô) chứ không theo dòng: bảng có hai ô công thức mỗi dòng,
  // khoá theo dòng thì bấm ô "Cách tính giá" của dòng 3 vẫn ra panel dòng đang mở, người khai
  // tưởng mình đang sửa dòng 3 mà thật ra đang sửa dòng 1.
  //
  // `neo` = chính cái nút vừa bấm, để panel NỔI dán vào đó (07/09/2026 — xem `FormulaPopover`).
  //
  // `banDau` = công thức lúc MỞ panel, để nút ✕ trả ô về đúng chỗ cũ. Ô công thức ghi thẳng vào form
  // theo từng nhịp gõ nên không có nó thì "bỏ sửa" chỉ còn cách đóng drawer rồi mở lại.
  const [mo, setMo] = useState<
    { may: number; neo: HTMLElement; banDau: string | null } | null>(null);
  // Chỉ còn ô GIÁ (ô giờ chạy gỡ 08/11/2026 cùng tốc độ máy).
  const bat = (may: number, neo: HTMLElement, banDau: string | null) =>
    setMo(mo && mo.may === may ? null : { may, neo, banDau });
  const patch = (i: number, p: Partial<MayCongDoanRow>) =>
    onChange(chon.map((r, j) => (j === i ? { ...r, ...p } : r)));
  // Chỉ công đoạn nhóm In mới có ô giá: phiếu tính giá chỉ chọn máy ở khối In của thành phần, nên
  // công thức giá khai cho máy bế/cán sẽ không có đường nào chảy tới. Dùng ENUM nhóm công đoạn
  // (`print`) chứ KHÔNG so tên nhóm máy — tên nhóm máy là danh mục người dùng sửa được.
  const coOGia = nhomCongDoan === "print";
  // Panel nằm NGOÀI vòng lặp bảng nên phải tra lại dòng theo `may_id`. Máy vừa bị xoá khỏi bảng
  // ⇒ `-1` ⇒ không vẽ panel (ô neo cũng đã rời DOM, `FormulaPopover` tự đóng).
  const iMo = mo ? chon.findIndex((r) => r.may_id === mo.may) : -1;
  // Tiêu đề popup phải nói đang sửa cho MÁY NÀO — popup nổi lên che mất chính dòng máy đó.
  const tenMay = (id: number) => {
    const m = theoId.get(id);
    return m ? `${String(m.ma)} · ${String(m.ten)}` : `#${id}`;
  };
  // BỎ SỬA: dùng chung cho nút "Huỷ" ở chân popup và cho phím Esc.
  const huy = () => {
    if (!mo || iMo < 0) return;
    patch(iMo, { cong_thuc_gia: mo.banDau });
    setMo(null);
  };

  return <div className="rc-bands rc-bands--dinh-muc">
    <div className="rc-dinh-muc-wrapper">
      <table className={`rc-dinh-muc-table rc-dinh-muc-table--may ${coOGia ? "rc-dinh-muc-table--may-gia" : ""}`}>
        <thead>
          {/* Cột Tốc độ chạy, Canh máy, Cách đo giờ chạy GỠ 08/11/2026 (bỏ tốc độ máy): lệnh thôi
              tính giờ chạy theo tốc độ. Câu `cong_thuc_gio` cũ vẫn đi theo dòng, không bị xoá. */}
          <tr className="rc-dinh-muc-table__group-row">
            <th className="rc-col--left">Máy</th>
            {coOGia && <th className="rc-col--left">Cách tính giá</th>}
          </tr>
        </thead>
        <tbody>
          {chon.length === 0 && <tr><td colSpan={coOGia ? 2 : 1} className="rc-bands__empty">
            {toDangTick.length === 0
              ? "Chưa tick tổ nào ở ô Tổ phụ trách."
              : "Các tổ đã tick chưa có máy nào."}
          </td></tr>}
          {chon.map((r, i) => {
            const may = theoId.get(r.may_id);
            const moGia = mo?.may === r.may_id;
            return (
              <tr key={r.may_id}>
                <td className="rc-col--left rc-dinh-muc-name">
                  <span className="rc-dm-vt__pill">
                    {may ? `${String(may.ma)} · ${String(may.ten)}` : `#${r.may_id}`}
                  </span>
                  {toCuaMay(may, toDangTick).map((t) =>
                    <span key={t} className="lds-tag">{tenTo[t] ?? `Tổ #${t}`}</span>)}
                  {/* Một máy thì chẳng có gì để chọn — nhãn chỉ hiện khi có từ hai máy, như chip tổ. */}
                  {chon.length > 1 && (i === 0
                    ? <span className="rc-may-mac-dinh">mặc định</span>
                    : <button type="button" className="rc-may-dat-mac-dinh"
                        title="Đưa máy này lên đầu: bước lệnh mới tự gán máy này"
                        onClick={() => onChange([r, ...chon.filter((_, j) => j !== i)])}>
                        Đặt mặc định
                      </button>)}
                </td>
                {coOGia && <td className="rc-col--left rc-dinh-muc-unit rc-ct-td">
                  <button type="button" title="Sửa cách tính giá của máy này"
                    className={`rc-ct-cell ${moGia ? "is-open" : ""} ${r.cong_thuc_gia ? "" : "is-empty"}`}
                    onClick={(e) => bat(r.may_id, e.currentTarget, r.cong_thuc_gia ?? null)}>{r.cong_thuc_gia || "—"}</button>
                </td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <div className="rc-dinh-muc-note">
      Máy hiện theo tổ đã tick. Thêm máy vào tổ ở danh mục Thiết bị &amp; Máy móc.
    </div>
    {mo && iMo >= 0 && <FormulaPopover neo={mo.neo} onClose={() => setMo(null)} onHuy={huy}
      nhan="Công thức giá">
      {/* Popup TRỐNG có lối vào: 5 máy cùng công đoạn thường chung một khung công thức, chỉ khác vài
          con số — chép công thức chung hoặc của máy khác làm gốc rồi sửa số, khỏi đi vòng bộ nhớ tạm.
          Chỉ bày khi ô đang trống để không ai lỡ tay đè mất công thức đang có. */}
      {(() => {
        const cot = "cong_thuc_gia";
        if ((chon[iMo][cot] ?? "").trim()) return null;
        const chung = congThucChung.trim();
        const nguon = chon.filter((r, j) => j !== iMo && (r[cot] ?? "").trim());
        if (!chung && !nguon.length) return null;
        return <div className="rc-ct-pop__goc">
          <span className="rc-ct-pop__goc-nhan">Bắt đầu từ:</span>
          {chung && <button type="button" className="rc-ct-pop__goc-btn"
            onClick={() => patch(iMo, { [cot]: chung })}>Công thức chung của công đoạn</button>}
          {nguon.length > 0 && <select className="rc-ct-pop__goc-chon" value="" aria-label="Chép từ máy"
            onChange={(e) => {
              const r = chon.find((x) => x.may_id === Number(e.target.value));
              if (r) patch(iMo, { [cot]: r[cot] ?? "" });
            }}>
            <option value="">Chép từ máy…</option>
            {nguon.map((r) => {
              const m = theoId.get(r.may_id);
              return <option key={r.may_id} value={r.may_id}>
                {m ? `${String(m.ma)} · ${String(m.ten)}` : `#${r.may_id}`}</option>;
            })}
          </select>}
        </div>;
      })()}
      {/* `id` phải DUY NHẤT: drawer còn những ô công thức khác, trùng id là hai ô dính nhau. */}
      <FormulaField
        id={`ct-gia-${mo.may}`} configPrefix="/api/cong-doan" loaiO="cong_doan"
        nhanO={`Công thức giá riêng — ${tenMay(mo.may)}`}
        goY="Ghi đè công thức giá của công đoạn khi phiếu tính giá chọn đúng máy này. Bỏ trống = dùng công thức chung."
        value={chon[iMo].cong_thuc_gia ?? ""}
        onChange={(v) => patch(iMo, { cong_thuc_gia: v })} />
    </FormulaPopover>}
  </div>;
}

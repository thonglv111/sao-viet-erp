import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { HangLoaiBuoc } from "../api/client";
import type { Row } from "../api/rebuildCatalog";
import { HoverTip } from "../components/HoverTip";
import { Select } from "../components/Select";
import { tenDonVi, useNapTenDonVi } from "./tenDonVi";

/** Một dòng vật tư của bước. Giấy + sóng chọn ở SẢN PHẨM (mục Giấy nguyên, 24/10/2026) nên bước
 *  chỉ còn `vat_tu`; khoá vẫn đi theo CẶP (`khoaVatTu`) để khớp định mức engine trả. */
export interface BuocVatTuDong {
  uid: string; hang_loai: HangLoaiBuoc; vat_tu_id: number; gia_tri_chip: Record<string, number>;
}
export interface Chip { ma: string; ten: string; don_vi?: string | null }

/** Khoá ghép một dòng với danh mục / định mức: "vat_tu:12". */
export const khoaVatTu = (hang: HangLoaiBuoc, id: number) => `${hang}:${id}`;
export const chipsCua = (vt: Row | undefined): Chip[] =>
  Array.isArray(vt?.chips) ? (vt!.chips as Chip[]) : [];

/** Chuẩn hoá để SO tên: thường hoá, bỏ dấu, đ→d. Chỉ dùng để so, không bao giờ in ra. */
const chuanHoa = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

/** Nhãn ngắn của ô chip: bỏ cụm trùng TÊN VẬT TƯ khỏi tên chip ("Dài support" của vật tư
 *  "Support" → "Dài"). So theo TỪ, không phân biệt hoa thường/dấu. Bỏ xong mà rỗng (chip tên
 *  đúng bằng tên vật tư) hoặc không thấy cụm trùng thì giữ nguyên tên chip. */
export function nhanNgan(tenChip: string, tenVatTu: string): string {
  const tu = tenChip.trim().split(/\s+/).filter(Boolean);
  const mau = chuanHoa(tenVatTu).trim().split(/\s+/).filter(Boolean);
  if (mau.length === 0 || tu.length === 0) return tenChip;
  const tuCh = tu.map(chuanHoa);
  for (let i = 0; i + mau.length <= tu.length; i++) {
    if (mau.every((m, k) => tuCh[i + k] === m)) {
      const con = [...tu.slice(0, i), ...tu.slice(i + mau.length)].join(" ")
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      return con === "" ? tenChip : con;
    }
  }
  return tenChip;
}

/** Số ô chip CHƯA nhập của một bước — đếm trên đúng những chip mà danh mục vật tư đang khai (vắng
 *  mã trong `gia_tri_chip` = chưa nhập; đã nhập 0 vẫn tính là ĐÃ nhập). Dòng tiêu đề công đoạn hiện
 *  "· còn N ô chưa nhập" theo số này. */
export function soOChipTrong(dong: BuocVatTuDong[], vatTuDm: Row[]): number {
  let n = 0;
  for (const d of dong) {
    const vt = vatTuDm.find((v) => v.id === d.vat_tu_id);
    for (const c of chipsCua(vt)) if (d.gia_tri_chip[c.ma] === undefined) n++;
  }
  return n;
}

/** Một ô chip trên hàng vật tư: NHÃN NHỎ đứng trước, liền sau là khung chữ nhật bo nhẹ chứa ô số
 *  (căn phải) + đơn vị đứng cuối. Ô chữ + bàn phím số (gõ "3,5" hay "3.5" đều ăn — dấu thập phân của
 *  `type="number"` phụ thuộc ngôn ngữ trình duyệt). CHƯA nhập (vắng mã trong `gia_tri_chip`) thì ô
 *  để trống + CHỈ viền đổi màu cảnh báo; đã nhập 0 thì hiện "0", viền thường — không placeholder
 *  "0" để hai ca không lẫn vào nhau. Tên đầy đủ ở tooltip + aria-label. */
function OChip({ nhan, nhanDu, don_vi, value, onChange }: {
  nhan: string; nhanDu: string; don_vi: string; value: number | undefined; onChange: (raw: string) => void;
}) {
  const [chu, setChu] = useState(value === undefined ? "" : String(value));
  useEffect(() => {
    if ((chu === "" ? undefined : Number(chu)) !== value) setChu(value === undefined ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const trong = value === undefined;
  return (
    <label
      className={`tg-bvt__o${trong ? " tg-bvt__o--trong" : ""}`}
      title={trong ? `${nhanDu} — chưa nhập số` : nhanDu}
    >
      <span className="tg-bvt__o-nhan" title={nhanDu}>{nhan}</span>
      <span className="tg-bvt__o-khung">
        <input
          className="tg-bvt__o-so"
          type="text"
          inputMode="decimal"
          aria-label={nhanDu}
          aria-invalid={trong || undefined}
          value={chu}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const raw = e.target.value.replace(",", ".").replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
            setChu(raw);
            onChange(raw);
          }}
        />
        {don_vi ? <span className="tg-bvt__o-dv">{don_vi}</span> : null}
      </span>
    </label>
  );
}

/** Lượng vật tư bước này ăn — engine chạy công thức định mức của vật tư (`dinh_muc` ở dòng NVL).
 *  `so=null` = không tính ra được, `lyDo` nói vì sao (chưa khai công thức, ra 0, lỗi). */
export interface DinhMuc {
  so: number | null;
  donVi: string;
  lyDo: string | null;
  /** Công thức định mức đọc bằng chữ ("Số bản kẽm") và bản đã thế số ("32 bản") — nơi gọi dịch sẵn
   *  bằng từ điển biến + chip của vật tư, cùng cách dòng tiền ở bảng giá vốn. Rỗng = không có. */
  dienGiai?: string;
  thaySo?: string;
}

/** Số định mức kiểu Việt: lượng dưới 1 giữ 4 chữ số lẻ để không thành 0 (0,0012 kg), còn lại 2
 *  (1.706,4 m² — bỏ lẻ là mất cả 0,4 m² màng). */
export function soDinhMuc(v: number): string {
  const le = v < 1 ? 4 : 2;
  return v.toLocaleString("vi-VN", { maximumFractionDigits: le });
}

/** Ô lượng + bong bóng công thức khi rê chuột / chạm — cùng khuôn bong bóng trắng của dòng tiền ở
 *  khối Giá vốn (09/10/2026): thẻ "Công thức" bằng chữ, thẻ "Thế số" "= thế số = kết quả". Công thức
 *  chỉ là một biến ("Số bản kẽm") thì thế số chỉ "= 32 bản", khỏi lặp kết quả hai lần. Ô nhận focus
 *  để bàn phím / chạm cũng mở. */
function OLuong({ ten, dm, dvMacDinh }: { ten: string; dm: DinhMuc | undefined; dvMacDinh: string }) {
  const dv = (dm?.donVi ? tenDonVi(dm.donVi) : undefined) ?? dvMacDinh;
  const co = dm?.so != null;
  const ketQua = co ? `${soDinhMuc(dm!.so!)}${dv ? ` ${dv}` : ""}` : "";
  const thaySo = (dm?.thaySo ?? "").trim();
  const coPhepTinh = /[×÷+−()]/.test(thaySo);
  const dong2 = !co ? "" : thaySo && coPhepTinh ? `= ${thaySo} = ${ketQua}` : `= ${thaySo || ketQua}`;
  return (
    <HoverTip
      tieuDe={ten}
      rong={420}
      lopNeo={`tg-bvt__luong${co ? "" : " tg-bvt__luong--chua"}`}
      neo={
        <>
          <span className="tg-bvt__luong-so">{co ? soDinhMuc(dm!.so!) : "—"}</span>
          {dv ? <span className="tg-bvt__dv">{dv}</span> : null}
        </>
      }
    >
      {co ? (
        <dl className="hover-tip__dong">
          {dm?.dienGiai ? (
            <div className="hover-tip__hang">
              <dt>Công thức</dt>
              <dd>{dm.dienGiai}</dd>
            </div>
          ) : null}
          <div className="hover-tip__hang">
            <dt>Thế số</dt>
            <dd className="hover-tip__so">{dong2}</dd>
          </div>
        </dl>
      ) : (
        <p className="hover-tip__dan">
          {dm ? `Chưa tính được: ${dm.lyDo ?? "không rõ lý do"}` : "Đang chờ tính…"}
        </p>
      )}
    </HoverTip>
  );
}

interface Props {
  tenBuoc: string;
  dong: BuocVatTuDong[];
  vatTuDm: Row[];
  onChange: (next: BuocVatTuDong[]) => void;
  taoUid: () => string;
  /** Định mức theo `khoaVatTu` của CHÍNH bước này. Vắng (chưa có kết quả tính) ⇒ hiện gạch. */
  dinhMuc?: Map<string, DinhMuc>;
}

export default function BuocVatTu({ tenBuoc, dong, vatTuDm, onChange, taoUid, dinhMuc }: Props) {
  useNapTenDonVi();   // đơn vị hiện bằng TÊN trong danh mục, không in mã trần
  // Dựng một lần theo danh mục — danh mục đứng yên trong khi người dùng gõ chip, mỗi nhịp gõ chỉ `dong` đổi.
  const tra = useMemo(() => new Map<string, Row>(
    vatTuDm.map((v) => [khoaVatTu("vat_tu", v.id), v] as const),
  ), [vatTuDm]);
  const daCo = new Set(dong.map((d) => khoaVatTu(d.hang_loai, d.vat_tu_id)));
  // Ô thêm chỉ mời vật tư (giấy/sóng chọn ở sản phẩm). Mã đang dùng không mời lại.
  const luaChon = vatTuDm.filter((v) => !daCo.has(khoaVatTu("vat_tu", v.id)))
    .map((v) => ({ value: String(v.id), label: String(v.ten) }));

  const setChip = (i: number, ma: string, raw: string) =>
    onChange(dong.map((d, j) => {
      if (j !== i) return d;
      const { [ma]: _bo, ...con } = d.gia_tri_chip;
      const so = Number(raw);
      return { ...d, gia_tri_chip: raw.trim() === "" || !Number.isFinite(so) ? con : { ...con, [ma]: so } };
    }));

  const nutXoa = (i: number, ten: string) => (
    <button
      type="button"
      className="tg-bvt__xoa"
      aria-label={`Xóa ${ten}`}
      title="Bỏ vật tư khỏi bước này"
      onClick={() => onChange(dong.filter((_, j) => j !== i))}
    >
      <X aria-hidden="true" />
    </button>
  );

  // Cột LƯỢNG bên phải mọi hàng (04/10/2026): số định mức engine tính + đơn vị, thẳng cột giữa các
  // vật tư. Chưa tính ra thì gạch, rê chuột đọc lý do — không bịa số.
  const oLuong = (khoa: string, dvDm: string, ten: string) => (
    <OLuong ten={ten} dm={dinhMuc?.get(khoa)} dvMacDinh={dvDm} />
  );

  // Danh sách GỌN (thiết kế B, 04/10/2026): mỗi vật tư một hàng [tên, lượng + đơn vị, ×]. Vật tư có
  // chip đứng trước, ô chip nằm ở dòng dưới của chính hàng đó, dồn về mép phải. Cuối cùng là ô nét
  // đứt "+ Thêm vật tư".
  const ds = dong.map((d, i) => {
    const khoa = khoaVatTu(d.hang_loai, d.vat_tu_id);
    const vt = tra.get(khoa);
    const ten = vt ? String(vt.ten) : `Vật tư #${d.vat_tu_id} (đã ngừng dùng)`;
    const dv = vt?.don_vi_gia ? (tenDonVi(String(vt.don_vi_gia)) ?? "") : "";
    return { d, i, khoa, ten, dv, chips: chipsCua(vt) };
  });
  const sapXep = [...ds.filter((x) => x.chips.length > 0), ...ds.filter((x) => x.chips.length === 0)];

  return (
    <div className="tg-bvt" role="group" aria-label={`Vật tư của bước ${tenBuoc}`}>
      {sapXep.length === 0 ? (
        <p className="tg-bvt__rong">Chưa có vật tư.</p>
      ) : (
        <ul className="tg-bvt__ds">
          {sapXep.map(({ d, i, khoa, ten, dv, chips }) =>
            chips.length > 0 ? (
              <li className="tg-bvt__dong tg-bvt__dong--chip" key={d.uid}>
                <span className="tg-bvt__ten" title={ten}>{ten}</span>
                {oLuong(khoa, dv, ten)}
                {nutXoa(i, ten)}
                <div className="tg-bvt__luoi">
                  {chips.map((c) => (
                    <OChip
                      key={c.ma}
                      nhan={nhanNgan(c.ten, ten)}
                      nhanDu={c.ten}
                      don_vi={c.don_vi ? (tenDonVi(c.don_vi) ?? "") : ""}
                      value={d.gia_tri_chip[c.ma]}
                      onChange={(raw) => setChip(i, c.ma, raw)}
                    />
                  ))}
                </div>
              </li>
            ) : (
              <li className="tg-bvt__dong" key={d.uid}>
                <span className="tg-bvt__ten" title={ten}>{ten}</span>
                {oLuong(khoa, dv, ten)}
                {nutXoa(i, ten)}
              </li>
            ),
          )}
        </ul>
      )}
      {luaChon.length > 0 && (
        <Select
          options={luaChon}
          value=""
          placeholder="+ Thêm vật tư — gõ tên…"
          onChange={(v) => {
            const id = Number(v);
            if (id) onChange([...dong, { uid: taoUid(), hang_loai: "vat_tu", vat_tu_id: id, gia_tri_chip: {} }]);
          }}
          ariaLabel={`Thêm vật tư vào bước ${tenBuoc}`}
          searchable
          portal
          className="tg-bvt__them"
          listClassName="tg-pop"
        />
      )}
    </div>
  );
}

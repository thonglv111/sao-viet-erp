/** Khung chung của mọi form lập phiếu chi / phiếu thu (đặc tả PC-3, PT-3, PT-4, A.2, A.3, A.6).
 *
 *  - Vỏ `NganPhai` (cùng độ rộng chung với mọi ngăn); form đang gõ dở thì Esc / đóng hỏi trước (`chanDong`).
 *  - Lỗi nằm TẠI Ô (chữ đỏ + biểu tượng, viền ô đỏ), con trỏ nhảy tới ô sai đầu tiên; nút lập
 *    luôn bấm được. Lỗi máy chủ hiện ngay đầu form, trong ngăn — không rơi ra sau lớp phủ.
 *  - Chân: câu xem trước bên trái — "Đóng" — nút rust ("Lập phiếu chi" / "Lập phiếu thu").
 *  - `banXem` (form lập phiếu chi rời / thu khác): chia đôi, form trái + tờ phiếu xem trước bên phải.
 *
 *  Kèm các ô dùng chung: `OF` (một ô có nhãn + gợi ý/lỗi), `OTienPhieu` (ô tiền to có dấu chấm
 *  nghìn), `ONgayPhieu` (ngày chứng từ, không sau hôm nay), `ChonCach`
 *  (hai thẻ chọn Tiền mặt / Chuyển khoản).
 *
 *  KIỂU MỚI (06/10/2026, docs/mockups/thu-tien-ngan-chong-phuong-an-3-ban-2.html — khuôn Stripe):
 *  form trái chia KHỐI có tiêu đề (`KhoiForm`), tờ phiếu A5 bên phải. Khối đầu đối chiếu chứng từ nguồn
 *  bằng một hàng số không đóng hộp (`HangDoiChieu`); ô tiền to kèm số bằng chữ và nút "đủ"
 *  (`OTienLon`); dải "sau phiếu này" đổi theo từng phím gõ (`SauPhieu`); gợi ý người nộp / nhận bằng
 *  chip (`GoiYTen`). Đầu ngăn có hàng thẻ thông tin (`phuDe`).
 */
import { ChonNgay } from "../../../components/ChonNgay";
import { Banknote, CircleAlert, Landmark } from "lucide-react";
import { OGoDinhDang } from "../../../components/OGoDinhDang";
import { OSoLe } from "../../../components/OSoLe";
import { useId } from "react";
import type { FormEvent, ReactNode } from "react";

import { amountInWords } from "../../../utils/format";
import { homNayVN } from "../../../utils/ky";
import { NganPhai, useDongNgan } from "./NganPhai";

/** Lỗi theo ô: khoá ô → câu lỗi. */
export type LoiForm = Partial<Record<string, string>>;

/** id của ô nhập theo khoá — để nhãn trỏ đúng ô và con trỏ nhảy tới ô sai. */
export const idO = (khoa: string) => `pcf-${khoa}`;

/** Đưa con trỏ tới ô sai đầu tiên theo thứ tự trên form. */
export function nhayToiLoi(loi: LoiForm, thuTu: string[]) {
  const dau = thuTu.find((k) => loi[k]);
  if (dau) document.getElementById(idO(dau))?.focus();
}

/** Lỗi của ô ngày chứng từ (`nhan` = "Ngày chi" / "Ngày thu"): bắt buộc, không sau hôm nay (giờ
 *  Việt Nam, tính lúc bấm). */
export function loiNgayPhieu(v: string | null | undefined, nhan: string): string | undefined {
  if (!v) return `Chọn ${nhan.toLowerCase()}.`;
  if (v > homNayVN()) return `${nhan} không được sau hôm nay.`;
  return undefined;
}

/** Một ô của form: nhãn (dấu * đỏ nếu bắt buộc) — điều khiển — gợi ý hoặc lỗi. */
export function OF({
  khoa,
  nhan,
  batBuoc,
  loi,
  goi,
  rong,
  ngay,
  children,
}: {
  khoa: string;
  nhan: string;
  batBuoc?: boolean;
  loi?: string;
  goi?: ReactNode;
  rong?: boolean;
  ngay?: boolean;
  children: ReactNode;
}) {
  const lop = ["kt-o", rong ? "kt-o--rong" : "", ngay ? "kt-o--ngay" : "", loi ? "kt-o--loi" : ""].filter(Boolean).join(" ");
  return (
    <div className={lop}>
      <label htmlFor={idO(khoa)}>
        {nhan}
        {batBuoc && <em className="kt-bb">*</em>}
      </label>
      {children}
      {loi ? (
        <span className="kt-o__loi" role="alert">
          <CircleAlert size={14} aria-hidden="true" />
          {loi}
        </span>
      ) : goi != null ? (
        <span className="kt-o__goi">{goi}</span>
      ) : null}
    </div>
  );
}

/** Ô số nhận phần lẻ (ngoại tệ, tỷ giá): giữ nguyên chữ đang gõ ("1.234," chưa xong vẫn hiện) — khuôn
 *  chung `components/OSoLe`. */
function OSoLeTien({ khoa, value, onChange, hauTo, loi }: {
  khoa: string; value: number; onChange: (v: number) => void; hauTo: string; loi?: boolean;
}) {
  return (
    <div className="kt-o-tien">
      <OSoLe id={idO(khoa)} placeholder="0" aria-invalid={loi || undefined} value={value} onChange={onChange} />
      <span>{hauTo}</span>
    </div>
  );
}

/** Ô tiền 52px chữ đậm, gõ số trần hiện dấu chấm nghìn, hậu tố "đ" (hoặc mã ngoại tệ).
 *  Không dùng `type="number"`: mười chữ số không dấu chấm thì không ai đếm nổi số 0.
 *  `soLe` = nhận phần lẻ sau dấu phẩy (số ngoại tệ, tỷ giá). */
export function OTienPhieu({
  khoa,
  value,
  onChange,
  hauTo = "đ",
  loi,
  soLe,
  nho,
}: {
  khoa: string;
  value: number;
  onChange: (v: number) => void;
  hauTo?: string;
  loi?: boolean;
  soLe?: boolean;
  /** Cao bằng ô thường (40px) — để đứng cùng hàng với ô khác. */
  nho?: boolean;
}) {
  if (soLe) return <OSoLeTien khoa={khoa} value={value} onChange={onChange} hauTo={hauTo} loi={loi} />;
  return (
    <div className={nho ? "kt-o-tien kt-o-tien--nho" : "kt-o-tien"}>
      <OGoDinhDang id={idO(khoa)} type="text" inputMode="numeric" placeholder="0" aria-invalid={loi || undefined}
        value={value ? value.toLocaleString("vi-VN") : ""}
        onChange={(e) => {
          const so = e.target.value.replace(/\D/g, "");
          onChange(so ? Number(so) : 0);
        }} />
      <span>{hauTo}</span>
    </div>
  );
}

/** Ô ngày chứng từ — mặc định hôm nay, trần là hôm nay theo giờ Việt Nam TÍNH LÚC VẼ (đặc tả A.14). */
export function ONgayPhieu({
  khoa,
  nhan,
  goi,
  value,
  onChange,
  loi,
  min,
}: {
  khoa: string;
  nhan: string;
  goi?: string;
  value: string;
  onChange: (v: string) => void;
  loi?: string;
  /** Ngày sớm nhất được chọn (vd ngày hoá đơn của khung Thu tiền). */
  min?: string;
}) {
  return (
    <OF khoa={khoa} nhan={nhan} batBuoc ngay loi={loi} goi={goi}>
      <ChonNgay id={idO(khoa)} aria-label={nhan} min={min} max={homNayVN()} value={value}
        onChange={(v) => onChange(v)} />
    </OF>
  );
}

/** Một thẻ chọn: vòng icon + tên + một dòng giải thích; thẻ đang chọn viền charcoal đủ cạnh. */
export function TheChon({ on, icon, ten, giai, disabled, id, onClick }: {
  on: boolean; icon: ReactNode; ten: string; giai: string; disabled?: boolean; id?: string; onClick: () => void;
}) {
  return (
    <button type="button" id={id} className={on ? "on" : undefined} aria-pressed={on} disabled={disabled} onClick={onClick}>
      <i>{icon}</i>
      <span>
        <b>{ten}</b>
        <small>{giai}</small>
      </span>
    </button>
  );
}

/** Hai thẻ chọn Tiền mặt / Chuyển khoản ("Trả bằng" của phiếu chi, "Nhận bằng" của phiếu thu). */
export function ChonCach({
  giaTri,
  onDoi,
  khoa,
  nhan,
  giaiTienMat,
  giaiChuyenKhoan,
  gon,
}: {
  giaTri: "cash" | "bank_transfer";
  onDoi: (v: "cash" | "bank_transfer") => void;
  khoa: string;
  nhan: string;
  giaiTienMat: string;
  giaiChuyenKhoan: string;
  /** Hai nút chọn gọn một hàng (form chia đôi có bản xem trước) thay cho hai thẻ to. */
  gon?: boolean;
}) {
  if (gon) {
    return (
      <div className="kt-cach-gon" role="radiogroup" aria-label={nhan}>
        {(["cash", "bank_transfer"] as const).map((v, i) => (
          <label key={v} title={v === "cash" ? giaiTienMat : giaiChuyenKhoan}>
            <input type="radio" id={i === 0 ? idO(khoa) : undefined} name={khoa} checked={giaTri === v}
              onChange={() => onDoi(v)} />
            {v === "cash" ? "Tiền mặt" : "Chuyển khoản"}
          </label>
        ))}
      </div>
    );
  }
  return (
    <div className="kt-cach" role="group" aria-label={nhan}>
      <TheChon id={idO(khoa)} on={giaTri === "cash"} icon={<Banknote size={18} aria-hidden="true" />} ten="Tiền mặt"
        giai={giaiTienMat} onClick={() => onDoi("cash")} />
      <TheChon on={giaTri === "bank_transfer"} icon={<Landmark size={18} aria-hidden="true" />} ten="Chuyển khoản"
        giai={giaiChuyenKhoan} onClick={() => onDoi("bank_transfer")} />
    </div>
  );
}

/** Một khối của form kiểu mới: tiêu đề 13px đậm vừa + các ô. */
export function KhoiForm({ tieu, children, nhan }: { tieu: string; children: ReactNode; nhan?: string }) {
  return (
    <section className="kt-f__muc" aria-label={nhan ?? tieu}>
      <h4 className="kt-f__tieu">{tieu}</h4>
      {children}
    </section>
  );
}

/** Hàng số đối chiếu chứng từ nguồn ("Giá trị hoá đơn | Trừ cọc | Đã thu | Còn phải thu"): một hàng,
 *  kẻ trên và dưới, KHÔNG đóng hộp từng ô. Ô `chot` là con số chốt — chữ to và đậm hơn. */
export function HangDoiChieu({ o }: { o: { nhan: string; giaTri: ReactNode; chot?: boolean }[] }) {
  return (
    <div className="kt-dc" style={{ gridTemplateColumns: `repeat(${o.length}, minmax(0, 1fr))` }}>
      {o.map((x) => (
        <div key={x.nhan} className={x.chot ? "kt-dc__chot" : undefined}>
          <span>{x.nhan}</span>
          <b>{x.giaTri}</b>
        </div>
      ))}
    </div>
  );
}

/** Ô tiền LỚN của form kiểu mới: cao 56px chữ 26px, hậu tố "đ". Dưới ô: số bằng chữ (nghiêng) và nút
 *  "Thu đủ / Trả đủ". `vuot` có chữ thì viền đỏ + câu đỏ (người gọi tự khoá nút lập). `con` = phần
 *  dưới cùng (dải "sau phiếu này"). */
export function OTienLon({
  khoa,
  nhan,
  value,
  onChange,
  loi,
  nutDu,
  vuot,
  goiTrong = "Nhập số tiền",
  con,
}: {
  khoa: string;
  nhan: string;
  value: number;
  onChange: (v: number) => void;
  loi?: string;
  nutDu?: { nhan: string; so: number };
  vuot?: string | null;
  /** Chữ thay cho số bằng chữ khi ô còn trống. */
  goiTrong?: string;
  con?: ReactNode;
}) {
  const sai = !!loi || !!vuot;
  return (
    <div className={`kt-o kt-o--rong${sai ? " kt-o--loi" : ""}`}>
      <label htmlFor={idO(khoa)}>
        {nhan}
        <em className="kt-bb">*</em>
      </label>
      <div className="kt-o-tien kt-o-tien--lon">
        <OGoDinhDang id={idO(khoa)} type="text" inputMode="numeric" placeholder="0" aria-invalid={sai || undefined}
          value={value ? value.toLocaleString("vi-VN") : ""}
          onChange={(e) => {
            const so = e.target.value.replace(/\D/g, "");
            onChange(so ? Number(so) : 0);
          }} />
        <span>đ</span>
      </div>
      <div className="kt-o-tien__duoi">
        <i>{value > 0 ? `${amountInWords(value)}.` : goiTrong}</i>
        {nutDu && nutDu.so > 0 && (
          <button type="button" className="kt-lk" onClick={() => onChange(nutDu.so)}>{nutDu.nhan}</button>
        )}
      </div>
      {loi ? (
        <span className="kt-o__loi" role="alert">
          <CircleAlert size={14} aria-hidden="true" />
          {loi}
        </span>
      ) : vuot ? (
        <span className="kt-o__loi" role="alert">
          <CircleAlert size={14} aria-hidden="true" />
          {vuot}
        </span>
      ) : null}
      {con}
    </div>
  );
}

/** Dải "sau phiếu này": mỗi ô một con số sẽ thành ra sau khi lập; `tu` (số trước) gạch ngang. */
export function SauPhieu({ o }: { o: { nhan: string; tu?: number; den: number }[] }) {
  return (
    <div className="kt-sau" aria-label="Sau phiếu này" style={{ gridTemplateColumns: `repeat(${o.length}, minmax(0, 1fr))` }}>
      {o.map((x) => (
        <div key={x.nhan}>
          <span>{x.nhan}</span>
          <b>
            {x.tu != null && x.tu !== x.den && <s>{x.tu.toLocaleString("vi-VN")}</s>}
            {`${Math.max(0, x.den).toLocaleString("vi-VN")} đ`}
          </b>
        </div>
      ))}
    </div>
  );
}

/** Chip gợi ý tên người nộp / nhận: bấm là điền. Chip trùng tên đang gõ viền đậm. */
export function GoiYTen({
  goiY,
  dangChon,
  onChon,
  nhan,
}: {
  goiY: { ten: string; nhan?: string; phu?: string }[];
  dangChon: string;
  onChon: (ten: string) => void;
  nhan: string;
}) {
  if (goiY.length === 0) return null;
  return (
    <div className="kt-goiy" role="group" aria-label={nhan}>
      {goiY.map((g) => {
        const on = g.ten.trim() === dangChon.trim();
        return (
          <button key={`${g.nhan ?? ""}${g.ten}`} type="button" className={on ? "on" : undefined} aria-pressed={on}
            onClick={() => onChon(g.ten)}>
            {g.nhan ?? g.ten}
            {g.phu && <small>{g.phu}</small>}
          </button>
        );
      })}
    </div>
  );
}

export function KhungFormPhieu({
  duongDan,
  tieuDe,
  tomTat,
  xemTruoc,
  dangLuu,
  loiChung,
  onDong,
  chanDong,
  onSubmit,
  nhanNut,
  nhanDangLuu = "Đang lập…",
  tang,
  khoaNut = false,
  hep = false,
  banXem,
  kieuMoi,
  phuDe,
  children,
}: {
  duongDan: ReactNode;
  tieuDe: ReactNode;
  /** Hàng thẻ thông tin dưới tiêu đề (Ngày hoá đơn, Ký hiệu, Đơn, Hạn thu…). */
  phuDe?: ReactNode;
  /** Dải chỉ đọc 4 ô nền --paper (số đơn mua, số chốt gia công, phiếu chi gốc). */
  tomTat?: { nhan: string; giaTri: ReactNode }[];
  /** Câu xem trước ở chân: "Chi 5.200.000 đ tiền mặt cho …". */
  xemTruoc: ReactNode;
  dangLuu: boolean;
  /** Lỗi từ máy chủ — hiện đầu form, trong ngăn. */
  loiChung: string | null;
  onDong: () => void;
  /** true = form đã gõ dở. */
  chanDong: () => boolean;
  onSubmit: () => void;
  /** Chữ nút chính ("Lập phiếu chi", "Lập phiếu thu", "Lưu thay đổi"…); sau khi phiếu đã lập mà
   *  chứng từ tải lên hỏng thì thành "Mở phiếu đã lập". */
  nhanNut: string;
  nhanDangLuu?: string;
  /** 1 = form chồng lên một ngăn khác (Trả nhiều đợt trên ngăn nhà cung cấp): Esc chỉ đóng lớp này. */
  tang?: number;
  /** true = khoá nút chính (vd lượt trả không còn đợt nào). */
  khoaNut?: boolean;
  /** Form ít ô (form tài khoản): cột ô tối đa 560px canh trái, ngăn vẫn giữ độ rộng chung (A.5). */
  hep?: boolean;
  /** Tờ phiếu xem trước đặt cột phải (`BanXemPhieu`). */
  banXem?: ReactNode;
  /** Bố cục mới (nhóm tách bằng đường kẻ, tiêu đề chữ thường) — tự bật khi có `banXem`. */
  kieuMoi?: boolean;
  children: ReactNode;
}) {
  const idForm = useId();
  const moi = !!banXem || !!kieuMoi;
  const form = (
    <form id={idForm} className={["kt-f", hep ? "kt-f--hep" : "", moi ? "kt-f--moi" : ""].filter(Boolean).join(" ")} noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}>
      {loiChung && (
        <p className="kt-o__loi" role="alert">
          <CircleAlert size={14} aria-hidden="true" />
          {loiChung}
        </p>
      )}
      {/* Kiểu mới: dải tóm tắt chứng từ nguồn thành hàng số đối chiếu ở đầu thân form. */}
      {moi && tomTat && tomTat.length > 0 && <HangDoiChieu o={tomTat.map((t) => ({ nhan: t.nhan, giaTri: t.giaTri }))} />}
      {children}
    </form>
  );
  return (
    <NganPhai
      duongDan={duongDan}
      tieuDe={tieuDe}
      phuDe={phuDe}
      tomTat={moi ? undefined : tomTat}
      tang={tang}
      // Đang lưu thì KHÔNG đóng được (Esc, nút X): lời gọi lập còn chạy, đóng giữa chừng là mất câu
      // báo tệp tải hỏng và trang không được báo phiếu mới. Không hỏi — chặn hẳn.
      onDong={() => {
        if (!dangLuu) onDong();
      }}
      chanDong={() => !dangLuu && chanDong()}
      chan={
        <>
          <span className="kt-ngan__xt">{xemTruoc}</span>
          <NutDong disabled={dangLuu} />
          <button type="submit" form={idForm} className="kt-btn kt-btn--chinh" disabled={dangLuu || khoaNut}>
            {dangLuu ? nhanDangLuu : nhanNut}
          </button>
        </>
      }
    >
      {banXem ? (
        <div className="kt-f-chia">
          {form}
          <div className="kt-f-chia__xem">{banXem}</div>
        </div>
      ) : (
        form
      )}
    </NganPhai>
  );
}

/** Nút "Đóng" ở chân — đi qua đúng đường đóng của ngăn (gõ dở thì hỏi bằng hộp của app). */
function NutDong({ disabled }: { disabled: boolean }) {
  const dong = useDongNgan();
  return (
    <button type="button" className="kt-btn kt-btn--tron" disabled={disabled} onClick={dong}>
      Đóng
    </button>
  );
}

// Tab 1 của drawer Nhà cung cấp — "Thông tin chung" (tách từ pages/SuppliersPage.tsx).
//
// Dựng lại 06/10/2026 theo phương án A (docs/mockups/ncc-3-phuong-an.html), khuôn hồ sơ của Odoo
// và SAP Fiori Object Page: mỗi dòng một cặp nhãn bên trái và giá trị bên phải, ô nhập trông như
// chữ thường, rê chuột mới hiện nền và bấm vào mới hiện khung. Màn đặc, không phải cuộn.
//   - Định danh: tên, nhóm hàng, mã số thuế, cờ nhận gia công.
//   - Liên hệ và Thanh toán đứng cạnh nhau thành hai cột.
// Khối đánh giá sao to đã lên đầu ngăn thành nhãn nhỏ + dải số liệu (SuppliersPage). Ô "Trạng
// thái" bỏ: đầu ngăn có nhãn trạng thái và chân ngăn có nút Ngừng / Mở lại hợp tác, một trạng thái
// mà ba chỗ đổi thì không biết chỗ nào thắng. NCC tạo mới mặc định đang hợp tác.
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { OGoDinhDang } from "../../../../components/OGoDinhDang";
import type { SupplierInput } from "../../../../api/client";
import "./ncc-form.css";

/** Cách tính hạn trả, lưu ở `debt_cutoff_day`: null = từ ngày hoá đơn · 31 = chốt cuối tháng ·
 *  1–30 = chốt ngày đó. Ba lựa chọn, chọn "Chốt ngày" mới bung ô gõ ngày (17/10/2026: danh sách
 *  32 dòng "Chốt ngày 1…30 hằng tháng" phải cuộn mới tìm được). */
const CACH_TINH_HAN = [
  { gt: "", chu: "Ngày hoá đơn" },
  { gt: "31", chu: "Chốt cuối tháng" },
  { gt: "ngay", chu: "Chốt ngày" },
];

/** Một dòng nhãn và giá trị. `rong` = trải hết bề ngang khối (không chia đôi). */
function Dong({
  nhan,
  batBuoc,
  rong,
  children,
}: {
  nhan: string;
  batBuoc?: boolean;
  rong?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`ncc-a__dong${rong ? " ncc-a__dong--rong" : ""}`}>
      <span className="ncc-a__nhan">
        {nhan}
        {batBuoc && <span className="ncc-a__sao" aria-hidden="true">*</span>}
      </span>
      {children}
    </label>
  );
}

/** Ô số có đơn vị đứng ngay sau con số ("30 ngày", "50.000.000 đ"). Gõ được dấu chấm nghìn. */
function OSo({
  value,
  onChange,
  donVi,
  trong,
  nghin,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  donVi: string;
  /** Chữ mờ khi ô trống — nói ô trống nghĩa là gì. */
  trong: string;
  /** Hiện dấu chấm nghìn (tiền). */
  nghin?: boolean;
}) {
  const co = value != null && value > 0;
  const chu = co ? (nghin ? value.toLocaleString("vi-VN") : String(value)) : "";
  return (
    <span className="ncc-a__so-wrap">
      {/* Ô co theo đúng độ dài chữ để đơn vị đứng sát con số ("30 ngày"), không trôi ra mép phải. */}
      <OGoDinhDang
        className="ncc-a__o ncc-a__so"
        inputMode="numeric"
        placeholder={trong}
        style={{ width: `calc(${Math.max((chu || trong).length, 2) + 1}ch + 18px)` }}
        value={chu}
        onChange={(e) => {
          const so = e.target.value.replace(/\D/g, "");
          onChange(so === "" ? null : Number(so));
        }}
      />
      {co && <span className="ncc-a__don-vi">{donVi}</span>}
    </span>
  );
}

export function SupplierInfoTab({
  form,
  setForm,
  nhomGoiY,
  goc,
}: {
  form: SupplierInput;
  setForm: Dispatch<SetStateAction<SupplierInput>>;
  /** Hồ sơ đang lưu (sửa NCC) — để nhắc đổi điều khoản không kéo hạn các đợt đã ghi. */
  goc?: SupplierInput | null;
  /** Nhóm hàng đang có trong danh mục — gợi ý cho ô Nhóm hàng để khỏi gõ lệch ("Giấy" / "giấy in"). */
  nhomGoiY: string[];
}) {
  const doi = (patch: Partial<SupplierInput>) => setForm((f) => ({ ...f, ...patch }));
  const ngayChot = form.debt_cutoff_day ?? null;
  // Vừa chọn "Chốt ngày" mà chưa gõ ngày thì giá trị vẫn trống — cờ này giữ ô ngày đang mở
  // (ô đó `required` nên trống thì không lưu được). Mở NCC khác thì tắt.
  const [dangChonNgay, setDangChonNgay] = useState(false);
  useEffect(() => setDangChonNgay(false), [goc]);
  const cachTinh = ngayChot === 31 ? "31" : (ngayChot != null && ngayChot >= 1) || dangChonNgay ? "ngay" : "";
  // Điều khoản trả thuộc NCC (16/10/2026): mọi đơn của NCC dùng chung. Hạn của đợt giao chụp lúc
  // ghi đợt, nên đổi ở đây chỉ áp cho hàng về từ nay.
  const doiDieuKhoan =
    goc != null &&
    ((goc.credit_days ?? null) !== (form.credit_days ?? null) ||
      (goc.debt_cutoff_day ?? null) !== (form.debt_cutoff_day ?? null));

  return (
    <div className="ncc-a">
      <section className="ncc-a__khoi">
        <h3 className="ncc-a__khoi-ten">Định danh</h3>
        <div className="ncc-a__luoi">
          <Dong nhan="Tên nhà cung cấp" batBuoc rong>
            <input
              className="ncc-a__o ncc-a__o--dam"
              required
              value={form.name}
              onChange={(e) => doi({ name: e.target.value })}
              placeholder="VD: Công ty TNHH Giấy Việt Triều"
            />
          </Dong>
          <Dong nhan="Nhóm hàng" batBuoc>
            <input
              className="ncc-a__o"
              required
              list="ncc-nhom-goi-y"
              value={form.supplier_group ?? ""}
              onChange={(e) => doi({ supplier_group: e.target.value })}
              placeholder="VD: Giấy"
            />
            <datalist id="ncc-nhom-goi-y">
              {nhomGoiY.map((n) => <option key={n} value={n} />)}
            </datalist>
          </Dong>
          <Dong nhan="Mã số thuế" batBuoc>
            <input
              className="ncc-a__o ncc-a__so"
              required
              inputMode="numeric"
              value={form.tax_code ?? ""}
              onChange={(e) => doi({ tax_code: e.target.value })}
              placeholder="0101234567"
            />
          </Dong>
          <Dong nhan="Nhận gia công ngoài" rong>
            <span
              className="ncc-a__cong-tac"
              title="Bật thì nhà cung cấp này có trong ô chọn nơi làm của công đoạn thuê ngoài."
            >
              <input
                type="checkbox"
                role="switch"
                className="ncc-a__cong-tac-o"
                checked={Boolean(form.nhan_gia_cong)}
                onChange={(e) => doi({ nhan_gia_cong: e.target.checked })}
              />
              <span className="ncc-a__cong-tac-nut" aria-hidden="true" />
              <span className="ncc-a__cong-tac-chu">
                {form.nhan_gia_cong
                  ? "Có, hiện trong ô chọn nơi làm của công đoạn thuê ngoài"
                  : "Không"}
              </span>
            </span>
          </Dong>
        </div>
      </section>

      <div className="ncc-a__hai-cot">
        <section className="ncc-a__khoi">
          <h3 className="ncc-a__khoi-ten">Liên hệ</h3>
          <Dong nhan="Người liên hệ" batBuoc>
            <input
              className="ncc-a__o"
              required
              value={form.contact_name ?? ""}
              onChange={(e) => doi({ contact_name: e.target.value })}
              placeholder="VD: Anh Nam (Kinh doanh)"
            />
          </Dong>
          <Dong nhan="Điện thoại" batBuoc>
            <input
              className="ncc-a__o ncc-a__so"
              required
              type="tel"
              inputMode="tel"
              value={form.phone ?? ""}
              onChange={(e) => doi({ phone: e.target.value })}
              placeholder="0988123456"
            />
          </Dong>
          <Dong nhan="Email" batBuoc>
            <input
              className="ncc-a__o"
              required
              type="email"
              value={form.email ?? ""}
              onChange={(e) => doi({ email: e.target.value })}
              placeholder="kinhdoanh@viettrieu.vn"
            />
          </Dong>
          <Dong nhan="Địa chỉ" batBuoc>
            <input
              className="ncc-a__o"
              required
              value={form.address ?? ""}
              onChange={(e) => doi({ address: e.target.value })}
              placeholder="Số 15, Đường Cầu Diễn, Hà Nội"
            />
          </Dong>
        </section>

        <section className="ncc-a__khoi">
          <h3 className="ncc-a__khoi-ten">Thanh toán</h3>
          <Dong nhan="Số ngày cho nợ">
            <OSo
              value={form.credit_days ?? null}
              onChange={(v) => doi({ credit_days: v })}
              donVi="ngày"
              trong="Chưa thỏa thuận"
            />
          </Dong>
          <Dong nhan="Tính hạn từ">
            <span className="ncc-a__han">
              <select
                className="ncc-a__o ncc-a__o--vua"
                value={cachTinh}
                onChange={(e) => {
                  const v = e.target.value;
                  setDangChonNgay(v === "ngay");
                  // Sang "Chốt ngày" thì để TRỐNG cho người dùng gõ — không bịa sẵn một ngày.
                  doi({ debt_cutoff_day: v === "31" ? 31 : null });
                }}
              >
                {CACH_TINH_HAN.map((c) => (
                  <option key={c.gt} value={c.gt}>{c.chu}</option>
                ))}
              </select>
              {cachTinh === "ngay" && (
                <>
                  <input
                    className="ncc-a__o ncc-a__so ncc-a__ngay-chot"
                    inputMode="numeric"
                    required
                    autoFocus={dangChonNgay && ngayChot == null}
                    aria-label="Ngày chốt trong tháng"
                    placeholder="1–30"
                    value={ngayChot != null && ngayChot <= 30 ? String(ngayChot) : ""}
                    onChange={(e) => {
                      const so = Number(e.target.value.replace(/\D/g, "").slice(0, 2));
                      if (so >= 31) {
                        setDangChonNgay(false);
                        doi({ debt_cutoff_day: 31 });   // 31 = cuối tháng, chuyển hẳn sang lựa chọn đó
                      } else {
                        setDangChonNgay(true);
                        doi({ debt_cutoff_day: so || null });
                      }
                    }}
                  />
                  <span className="ncc-a__don-vi">hằng tháng</span>
                </>
              )}
            </span>
          </Dong>
          {doiDieuKhoan && (
            <small className="ncc-a__nhac" role="status">
              Áp cho hàng về từ nay. Các đợt giao đã ghi giữ hạn cũ.
            </small>
          )}
          {/* Dấu chấm nghìn, không `type="number"`: chín chữ số 0 liền nhau thì không ai đếm
              nổi, mà đếm sai một chữ số là sai hạn mức gấp mười. */}
          <Dong nhan="Hạn mức công nợ">
            <OSo
              value={form.credit_limit || null}
              onChange={(v) => doi({ credit_limit: v ?? 0 })}
              donVi="đ"
              trong="Không giới hạn"
              nghin
            />
          </Dong>
          <Dong nhan="Điều khoản">
            <input
              className="ncc-a__o"
              value={form.payment_terms ?? ""}
              onChange={(e) => doi({ payment_terms: e.target.value })}
              placeholder="VD: Chuyển khoản sau giao hàng"
            />
          </Dong>
          <Dong nhan="Ghi chú">
            <textarea
              className="ncc-a__o ncc-a__ghi-chu"
              rows={1}
              value={form.note ?? ""}
              onChange={(e) => doi({ note: e.target.value })}
              placeholder="Năng lực, chiết khấu…"
            />
          </Dong>
        </section>
      </div>
    </div>
  );
}

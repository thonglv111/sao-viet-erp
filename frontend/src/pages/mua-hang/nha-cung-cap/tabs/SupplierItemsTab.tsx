// Tab 2 của drawer Nhà cung cấp — "Bảng giá vật tư": nhập/xuất Excel + bảng giá từng mặt hàng
// (tách từ pages/SuppliersPage.tsx).
// `token` lấy bằng `useAuth()` tại chỗ như bản gốc, KHÔNG luồn thêm prop: các chỗ dưới vẫn viết
// `token!` / `token ?? ""` y nguyên.
//
// Dựng lại 06/10/2026:
//   - Bỏ tiêu đề "Danh mục & Báo giá Vật tư" — tên tab đã nói đúng điều đó.
//   - Khuôn danh sách sửa tại dòng của Odoo (phương án A, docs/mockups/ncc-3-phuong-an.html): ô trông
//     như chữ thường, rê chuột hiện nền, nút xoá chỉ hiện ở dòng đang rê; "Thêm một dòng" ở cuối bảng,
//     đúng chỗ dòng mới sẽ hiện ra. Ô tìm bên trái, ba việc Excel bên phải.
//   - Đơn giá có dấu chấm nghìn + "đ" ngay trong ô.
//   - Cột "Giá theo đơn vị gốc" chỉ hiện khi CÓ dòng báo theo đơn vị khác đơn vị gốc. Dòng báo đúng
//     đơn vị gốc thì con số ấy y hệt ô đơn giá ngay bên cạnh — cả cột chép lại cột bên trái.
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { OGoDinhDang } from "../../../../components/OGoDinhDang";
import type { SupplierInput, SupplierRow } from "../../../../api/client";
import { api } from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import {
  DonViChonTheoHang,
  MaterialCombobox,
} from "../../../../components/MaterialCombobox";
import { emptySupplierItem } from "../shared/helpers";
import { KhungKho } from "../../../../components/kho-giay/KhungKho";
import { coKho } from "../../../../lib/khoGiay";
import { money } from "../../../../utils/format";
// Đơn vị lưu bằng MÃ (`mm`), tên hiển thị ("mm"/"mét") nằm ở danh mục — xem pages/tenDonVi.ts.
import { tenDonVi, useNapTenDonVi } from "../../../tenDonVi";
import type { FormItemRow, NhapKetQua, QuyDoiDongInfo } from "../shared/types";
import "./ncc-form.css";

/** Lưới cột. `minmax(0,…)` để số tiền dài không đẩy tràn khung. Cột Khổ chỉ có khi bảng giá có dòng
 *  giấy (10/10/2026 bỏ dạng cuộn/tờ: dòng giá giấy chỉ còn khổ + ĐVT + đơn giá); cột So giá theo chỉ
 *  khi có dòng khác đơn vị gốc. */
function luoiCot(coKho: boolean, coGoc: boolean): string {
  return [
    "minmax(200px, 2fr)",
    coKho ? "170px" : null,
    "minmax(110px, 0.8fr)",
    "minmax(130px, 0.9fr)",
    coGoc ? "minmax(120px, 0.8fr)" : null,
    "32px",
  ].filter(Boolean).join(" ");
}

export function SupplierItemsTab({
  mode,
  selected,
  setForm,
  itemsInForm,
  soMonDaKhai,
  filteredFormItems,
  itemSearchQ,
  setItemSearchQ,
  setSupplierItem,
  quyDoiDong,
  ghiQuyDoiDong,
  fileVatTuRef,
  nhapDang,
  nhapKetQua,
  setNhapKetQua,
  nhapExcel,
  taiFile,
}: {
  mode: null | "create" | "edit";
  selected: SupplierRow | null;
  setForm: Dispatch<SetStateAction<SupplierInput>>;
  itemsInForm: SupplierInput["items"] & object;
  /** Số món đã khai (bỏ dòng trống mồi sẵn) — xem `SuppliersPage`. */
  soMonDaKhai: number;
  filteredFormItems: FormItemRow[];
  itemSearchQ: string;
  setItemSearchQ: Dispatch<SetStateAction<string>>;
  setSupplierItem: (
    index: number,
    patch: Partial<FormItemRow["item"]>,
  ) => void;
  quyDoiDong: Record<number, QuyDoiDongInfo | null>;
  ghiQuyDoiDong: (index: number, info: QuyDoiDongInfo | null) => void;
  fileVatTuRef: MutableRefObject<HTMLInputElement | null>;
  nhapDang: boolean;
  nhapKetQua: NhapKetQua | null;
  setNhapKetQua: Dispatch<SetStateAction<NhapKetQua | null>>;
  nhapExcel: (file: File) => Promise<void>;
  taiFile: (lay: () => Promise<string>, ten: string) => Promise<void>;
}) {
  const { token } = useAuth();
  // Nạp tên đơn vị: ô ĐVT của dòng chưa gắn mặt hàng (dịch vụ, gia công) in từ đây, không có thì
  // lần vẽ đầu ra mã trần `m2`, `to` rồi đứng im.
  useNapTenDonVi();

  // Hệ số về gốc của từng dòng. Ưu tiên hệ số LIVE của ô ĐVT đang chọn (có ngay cả với dòng chưa
  // lưu); ô còn đang nạp thì dùng hệ số máy chủ đã tính cho dòng đã lưu — cột có số ngay lúc mở.
  // Đã nạp mà null = không quy đổi được, KHÔNG lùi về số đã lưu.
  const dong = filteredFormItems.map(({ item, originalIndex }) => {
    const quyDoi = quyDoiDong[originalIndex];
    const heSo =
      quyDoi !== undefined ? (quyDoi?.heSoVeGoc ?? null) : (item.he_so_ve_goc ?? null);
    // Chia lại từ đơn giá ĐANG GÕ chứ không lấy `gia_quy_doi` đóng băng.
    const giaVeGoc =
      heSo && heSo > 0 && item.unit_price > 0 ? Math.round(item.unit_price / heSo) : null;
    const daChonDonVi = Boolean(item.hang_loai && item.hang_id && item.unit);
    return { item, originalIndex, quyDoi, heSo, giaVeGoc, khacGoc: daChonDonVi && heSo !== 1 };
  });
  const coCotGoc = dong.some((d) => d.khacGoc);
  const coCotKho = dong.some((d) => coKho(d.item.hang_loai));
  const luoi = luoiCot(coCotKho, coCotGoc);
  const dangTim = itemSearchQ.trim() !== "";

  return (
    <section className="ncc-bg">
      <div className="ncc-bg__thanh">
        <input
          className="input ncc-bg__tim"
          placeholder="Tìm vật tư trong bảng giá"
          value={itemSearchQ}
          onChange={(e) => setItemSearchQ(e.target.value)}
        />
        {/* Đếm chỉ khi đang tìm — số món đã có trên nhãn tab. Không đếm dòng trống mồi sẵn. */}
        {dangTim && (
          <span className="ncc-bg__dem">
            Khớp {filteredFormItems.length} trên {soMonDaKhai} vật tư
          </span>
        )}
        <div className="ncc-bg__excel">
          {/* Tải mẫu đứng TRƯỚC Nhập: thứ tự nút là thứ tự việc phải làm. */}
          <button
            type="button"
            className="btn btn--ghost ncc-bg__nut"
            onClick={() =>
              taiFile(
                () => api.suppliers.itemsTemplateBlobUrl(token!),
                "mau-vat-tu-nha-cung-cap.xlsx",
              )
            }
          >
            Tải mẫu Excel
          </button>
          <input
            ref={fileVatTuRef}
            type="file"
            accept=".xlsx"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Xoá value ngay: chọn LẠI đúng file vừa chọn vẫn phải bắn onChange.
              e.target.value = "";
              if (file) void nhapExcel(file);
            }}
          />
          <button
            type="button"
            className="btn btn--ghost ncc-bg__nut"
            disabled={nhapDang}
            onClick={() => fileVatTuRef.current?.click()}
          >
            {nhapDang ? "Đang đọc…" : "Nhập từ Excel"}
          </button>
          {/* Xuất chỉ có nghĩa với NCC ĐÃ LƯU — NCC đang tạo mới chưa có id. */}
          {mode === "edit" && selected && (
            <button
              type="button"
              className="btn btn--ghost ncc-bg__nut"
              onClick={() =>
                taiFile(
                  () => api.suppliers.itemsExportBlobUrl(token!, selected.id),
                  `vat-tu-${selected.id}.xlsx`,
                )
              }
            >
              Xuất Excel
            </button>
          )}
        </div>
      </div>

      {nhapKetQua && (
        <div className="supplier__import-result">
          <div className="supplier__import-head">
            <strong>
              Đã nạp {nhapKetQua.them} mặt hàng mới
              {nhapKetQua.capNhat > 0 ? ` và cập nhật ${nhapKetQua.capNhat} mặt hàng` : ""}.
            </strong>
            <button type="button" className="btn btn--ghost" onClick={() => setNhapKetQua(null)}>
              Đóng
            </button>
          </div>
          {/* Nói rõ CHƯA vào sổ: người dùng đóng drawer là mất sạch phần vừa nhập. */}
          <p className="md-page__muted">
            Chưa lưu — kiểm lại bảng dưới rồi bấm <strong>Lưu nhà cung cấp</strong>. Mỗi file tối
            đa 500 dòng và chỉ cho một nhà cung cấp.
          </p>
          {nhapKetQua.errors.length > 0 && (
            <ul className="supplier__import-errors">
              {nhapKetQua.errors.map((e) => (
                <li key={`${e.row}-${e.message}`}>
                  <strong>Dòng {e.row}:</strong> {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="ncc-bg__bang">
        {/* Không gắn dấu * lên tiêu đề: cả ba cột đều bắt buộc, sao ở mọi cột là không nói gì. */}
        <div className="ncc-bg__dong ncc-bg__dong--dau" aria-hidden="true" style={{ gridTemplateColumns: luoi }}>
          <span>Vật tư</span>
          {coCotKho && <span>Khổ</span>}
          <span>Đơn vị</span>
          <span className="ncc-bg__phai ncc-bg__gia-dau">Đơn giá</span>
          {coCotGoc && (
            <span
              className="ncc-bg__phai"
              title="Giá quy về đơn vị gốc của chính đơn vị bán — ram về tờ, tấn về kg. Tờ và kg không quy đổi với nhau."
            >
              So giá theo
            </span>
          )}
          <span />
        </div>

        {dong.map(({ item, originalIndex, quyDoi, giaVeGoc, khacGoc }) => (
          <div className="ncc-bg__dong" key={originalIndex} style={{ gridTemplateColumns: luoi }}>
            {/* CHỌN từ danh mục gốc, không gõ tự do: ghép NCC với kho bằng chuỗi tên là trượt
                thầm lặng ("Couche 150" ≠ "Couché 150 79×109"), mà trượt thì mãi không so được
                giá. Đổi mặt hàng → xoá đơn vị cũ, vì đơn vị dùng được phụ thuộc chính mặt hàng. */}
            <MaterialCombobox
              token={token ?? ""}
              hangTen={item.item_name || null}
              onPick={(m) =>
                setSupplierItem(originalIndex, {
                  hang_loai: m.hang_loai,
                  hang_id: m.hang_id,
                  item_name: m.ten,
                  // Giấy: khổ để trống cho người khai.
                  kho_rong: 0,
                  kho_dai: 0,
                  unit: "",
                  he_so_ve_goc: null,
                })
              }
              placeholder="Gõ tên vật tư…"
            />
            {coCotKho &&
              (coKho(item.hang_loai) ? (
                <div>
                  <span className="ncc-bg__nhan-o">Khổ</span>
                  {/* Hai cạnh, hoặc chỉ rộng (để trống ô dài). Khổ chỉ-rộng không khớp khổ hai cạnh
                      khi so giá — khai đúng khổ NCC bán. */}
                  <KhungKho
                    ariaLabel="Khổ"
                    rong={item.kho_rong ?? 0}
                    dai={item.kho_dai ?? 0}
                    onChange={(v) =>
                      setSupplierItem(originalIndex, { kho_rong: v.rong, kho_dai: v.dai })
                    }
                  />
                </div>
              ) : (
                <span />
              ))}
            <div>
              <span className="ncc-bg__nhan-o">Đơn vị</span>
              {item.hang_loai && item.hang_id ? (
                <DonViChonTheoHang
                  token={token ?? ""}
                  hangLoai={item.hang_loai}
                  hangId={item.hang_id}
                  value={item.unit}
                  onChange={(ma) => setSupplierItem(originalIndex, { unit: ma })}
                  onQuyDoi={(info) => ghiQuyDoiDong(originalIndex, info)}
                  heSoDaLuu={item.he_so_ve_goc ?? null}
                />
              ) : (
                // Chưa chọn mặt hàng → chưa biết đơn vị; không cho gõ tự do để đơn vị lạ ("thùg")
                // khỏi lọt vào làm quy đổi tắt lặng lẽ.
                <span className="kho-dv__ro kho-dv__ro--trong" title="Chọn vật tư trước">
                  {item.unit ? (tenDonVi(item.unit) ?? item.unit) : "—"}
                </span>
              )}
            </div>
            <div>
              <span className="ncc-bg__nhan-o">Đơn giá</span>
              <div className="ncc-bg__gia">
                {/* Ô chữ có dấu chấm nghìn, không `type="number"`: "70600" phải đếm chữ số mới
                    biết là bảy mươi nghìn hay bảy trăm nghìn. */}
                <OGoDinhDang
                  className="input"
                  inputMode="numeric"
                  placeholder="0"
                  aria-label="Đơn giá"
                  value={item.unit_price > 0 ? item.unit_price.toLocaleString("vi-VN") : ""}
                  onChange={(e) => {
                    const so = e.target.value.replace(/\D/g, "");
                    setSupplierItem(originalIndex, { unit_price: so ? Number(so) : 0 });
                  }}
                />
                <span>đ</span>
              </div>
            </div>
            {coCotGoc &&
              (khacGoc ? (
                // Không quy đổi được thì để gạch — CỐ Ý không lấy đại đơn giá thô, vì như thế là
                // nói dối rằng hai NCC báo cùng đơn vị.
                <div
                  className={`ncc-bg__goc${giaVeGoc == null ? " ncc-bg__goc--khong" : ""}`}
                  title={
                    giaVeGoc != null
                      ? `${money(item.unit_price)} / ${tenDonVi(item.unit) ?? item.unit} ÷ ${quyDoi?.heSoVeGoc ?? "?"} = ${money(giaVeGoc)} / ${quyDoi?.donViGocTen ?? "đơn vị gốc"}`
                      : "Chưa quy đổi được — thiếu cặp quy đổi giữa đơn vị này và đơn vị gốc."
                  }
                >
                  {giaVeGoc != null ? (
                    <>
                      {money(giaVeGoc)}
                      {quyDoi?.donViGocTen && <small>mỗi {quyDoi.donViGocTen}</small>}
                    </>
                  ) : (
                    "Chưa quy đổi được"
                  )}
                </div>
              ) : (
                <span className="ncc-bg__goc" />
              ))}
            <button
              type="button"
              className="ncc-bg__xoa"
              disabled={itemsInForm.length <= 1}
              title="Xoá dòng"
              aria-label="Xoá mặt hàng"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  items: (current.items ?? []).filter((_, i) => i !== originalIndex),
                }))
              }
            >
              ×
            </button>
          </div>
        ))}

        {!dangTim && (
          <button
            type="button"
            className="ncc-bg__them"
            onClick={() =>
              setForm((current) => ({
                ...current,
                items: [...(current.items ?? []), emptySupplierItem()],
              }))
            }
          >
            Thêm một dòng
          </button>
        )}
      </div>
    </section>
  );
}

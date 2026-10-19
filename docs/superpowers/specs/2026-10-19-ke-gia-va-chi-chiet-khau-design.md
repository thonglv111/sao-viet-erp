# Kê giá + chi chiết khấu theo từng hóa đơn — thiết kế

Ngày: 19/10/2026. Trạng thái: ĐÃ DUYỆT 20/10/2026.

## 1. Mục tiêu

- Thêm **kê giá**: khoản cộng SAU giá bán, lên hóa đơn cùng giá bán, khách trả đủ rồi bên bán chi lại
  cho người bên khách sau khi trừ phần thuế TNDN trên kê.
- **Chiết khấu** giữ nguyên chỗ trong công thức giá, nhưng đổi luật CHI cho giống kê.
- Luật chi chung: **mỗi hóa đơn khách trả hết** ⇒ hóa đơn đó sinh khoản chờ chi, tính trên số trước
  VAT, chi bằng phiếu chi.
- **Bỏ hóa đơn điều chỉnh giảm** khỏi phần mềm (đảo quyết định 18/10/2026).

## 2. Công thức

```
giá bán          = giá vốn + chiết khấu + lợi nhuận        (như hiện nay, markup trên vốn + CK)
giá bán sau kê   = giá bán + kê                             (markup KHÔNG nhân lên kê)
đơn giá          = giá bán sau kê / số lượng                (số in cho khách)
VAT              = giá bán sau kê × VAT%
cọc phải thu     = % cọc × tổng đơn gồm VAT                 (như hiện nay — nay tổng đã gồm kê)
```

| | Chiết khấu | Kê giá |
|---|---|---|
| Vị trí | Trong giá bán | Sau giá bán |
| Gõ ở báo giá | Hai tab % \| Số, % trên giá vốn (như cũ) | Hai tab % \| Số, % trên giá bán |
| Lúc sinh khoản chi | Hóa đơn chứa nó được trả hết | Hóa đơn chứa nó được trả hết |
| Số chi | 100% phần CK của hóa đơn, trước VAT | phần kê của hóa đơn × (100% − % thuế TNDN trên kê), trước VAT |
| Người nhận | Khách (công ty) | Người bên khách (kế toán gõ tên lúc chi) |
| Chứng từ trong phần mềm | Phiếu chi | Phiếu chi |

## 3. Ví dụ trọn một đơn

Giá bán 10.000.000 (trong đó CK 1.000.000), kê 5.000.000, VAT 10%, cọc 30%, thuế TNDN trên kê 20%.
Giao hai lượt bằng nhau.

| Bước | Số |
|---|---|
| Tổng đơn trước VAT / gồm VAT | 15.000.000 / 16.500.000 |
| Cọc phải thu = 30% × 16.500.000 | 4.950.000 |
| HĐ1 (lượt 1) | 8.250.000 — CK 500.000, kê 2.500.000, thuế TNDN 500.000 |
| HĐ2 (lượt 2) | 8.250.000 — CK 500.000, kê 2.500.000, thuế TNDN 500.000 |
| Cọc cấn vào HĐ1 (FIFO như hiện nay) | HĐ1 còn 3.300.000 |
| Khách trả 3.300.000 ⇒ HĐ1 hết nợ | Sinh chờ chi HĐ1: CK 500.000 + kê 2.000.000 |
| Khách trả 8.250.000 ⇒ HĐ2 hết nợ | Sinh chờ chi HĐ2: CK 500.000 + kê 2.000.000 |
| Tổng đã chi xong | CK 1.000.000, kê 4.000.000; bên bán giữ 1.000.000 nộp thuế TNDN |

Cọc đủ lớn để phủ trọn HĐ1 thì HĐ1 hết nợ ngay lúc ghi ⇒ khoản chi của HĐ1 sinh luôn. Đúng luật:
tiền của hóa đơn đó khách đã đưa đủ.

## 4. Dữ liệu

Mọi tiền là số nguyên đồng, trước VAT. Cột mới ⇒ `db_migrations.py` + `docs/DB_SCHEMA.md`.

| Bảng | Thêm | Ý nghĩa |
|---|---|---|
| `customers` | `ke_thue_tndn_pct` (Float, NOT NULL, mặc định 20) | Ô "Thuế TNDN trên kê (%)". Ô mới trong khối Chính sách tài chính, sửa được 0–100. Khách mới tự mang 20; migration điền 20 cho khách đang có |
| `customers` | `ke_min_pct`, `ke_max_pct` (Float, null) | Rào kê cho phép, % trên giá bán. Ô "Kê cho phép" trong Chính sách tài chính, cạnh "Chiết khấu cho phép" |
| `quote_items` | `ke_gia` | Tiền kê của dòng. `selling_price` vẫn là giá bán KHÔNG gồm kê |
| `quote_versions` | `ke_gia_amount` | Tổng kê. `subtotal_amount` / `final_amount` GỒM kê (đúng số in cho khách) |
| `order_lines` | `ke_gia` | Chép từ báo giá lúc chốt. `line_total` GỒM kê (là số lên hóa đơn), song sinh `chiet_khau` |
| `sales_invoices` | `chiet_khau`, `ke_gia`, `ke_thue_tndn_pct`, `ke_thue_tndn` | Phần CK và kê của hóa đơn + % thuế TNDN trên kê CHỤP lúc ghi + tiền thuế TNDN trên kê |
| bảng dòng chi mới | `payment_voucher_id`, `sales_invoice_id`, `loai` (chiet_khau / ke_gia), `amount_vnd` | Phiếu chi trả cho hóa đơn nào, khoản gì. Dòng chi mua hàng hiện bắt buộc `purchase_request_id` nên không dùng chung được |

Phải chi của một hóa đơn: CK = `chiet_khau`; kê = `ke_gia` − `ke_thue_tndn`. Còn phải chi = phải chi − Σ
dòng chi còn hiệu lực trỏ hóa đơn đó cùng loại.

## 5. Luồng

1. **Báo giá.** Sau cột "Giá bán" thêm cột "Kê" (ô hai tab % | Số như chiết khấu, `OHaiTab`) và cột
   "Giá bán sau kê" = giá bán + kê. Sản phẩm gộp (ruột + bìa) một ô ở dải nhóm, số tiền chia theo giá bán
   từng dòng, dòng cuối nhận phần dư. Khối tổng thêm "Kê" và "Giá bán sau kê (chưa VAT)". Giá bán sau kê là
   số in cho khách, lên đơn, lên hóa đơn; bản in không có dòng kê. Đồng bộ lại từ
   phiếu tính giá giữ nguyên số tiền kê đã gõ.
2. **Đơn hàng.** Chốt đơn chép `ke_gia` từng dòng; khách chốt một phần ⇒ chỉ dòng khách lấy.
3. **Ghi hóa đơn.** Máy tính phần CK và kê của hóa đơn theo hàng của lượt giao (cộng dồn theo dòng như
   `gia_tri_luot_giao`). Kế toán gõ số tiền khác giá trị lượt ⇒ co giãn theo tỷ lệ. Hóa đơn làm đơn
   ghi đủ nhận phần dư để tổng khớp đúng CK / kê của đơn. Chụp `ke_thue_tndn_pct` của khách vào hóa đơn.
   Ngăn đơn, khối Hóa đơn: mỗi hóa đơn hiện CK, kê, thuế TNDN trên kê, phải chi, đã chi.
4. **Hóa đơn hết nợ.** Còn nợ của hóa đơn = 0 (phiếu thu đích danh + cọc cấn, đúng `receivable_rows`)
   ⇒ hóa đơn vào hàng chờ chi. Hóa đơn chưa hết nợ thì không có gì để chi.
5. **Hủy hóa đơn.** Chặn nếu đã có phiếu chi CK / kê còn hiệu lực trỏ nó (hủy phiếu chi trước).
6. **Báo ngay.** Hóa đơn vừa vào hàng chờ chi ⇒ chấm đỏ thanh bên + toast cho người có quyền lập phiếu
   chi (đường `bao_hang_cho` sẵn có).

## 6. Phiếu chi

Màn Phiếu chi thêm hàng chờ **"Chờ chi chiết khấu / kê"**, mỗi dòng một (hóa đơn, loại):

| Đơn | Hóa đơn | Khách | Loại | Phải chi | Đã chi | Còn |
|---|---|---|---|---|---|---|
| DH-01 | AA/26E 0000123 | Công ty X | Chiết khấu | 500.000 | 0 | 500.000 |
| DH-01 | AA/26E 0000123 | Công ty X | Kê giá | 2.000.000 | 0 | 2.000.000 |

- Tick một hoặc nhiều dòng **cùng khách và cùng loại** ⇒ "Lập phiếu chi" (phiếu gộp như phiếu gộp
  hiện có). Không trộn CK với kê trong một phiếu vì người nhận khác nhau.
- Hai mục thu chi CỐ ĐỊNH mới trong `MUC_CO_DINH`, cạnh "Trả lại tiền cho khách" (HT-07):
  "Chi chiết khấu trả khách" (nguồn `chi_chiet_khau`) và "Chi kê trả khách" (nguồn `chi_ke_gia`).
  Báo cáo thu chi theo mục hiện riêng hai mục này. HT-07 giữ cho tiền thừa.
- Phiếu điền sẵn: mục thu chi theo loại, lý do chi (liệt kê
  số hóa đơn), chứng từ gốc = các hóa đơn, số tiền = tổng còn của các dòng (sửa nhỏ hơn được).
- Người nhận tiền: CK = tên khách, khoá; kê = kế toán gõ tên người nhận, bắt buộc.
- Chi xong đủ ⇒ dòng rụng khỏi hàng chờ. Hủy phiếu chi ⇒ dòng quay lại.
- Hàng "Chờ trả lại khách" giữ nguyên cho việc cũ: tiền thừa (đơn hủy, trả dư, cọc thừa).

## 7. Báo cáo kinh doanh

Theo đơn, cột hiện có giữ nguyên nghĩa (tổng gồm kê): Tổng, Tổng VAT, Cọc phải thu / đã nhận / còn
thiếu, Giá trị giao, Đã xuất HĐ, Đã thu (gồm cọc), Còn phải thu.

- Gỡ cột "Điều chỉnh giảm" (cả Excel); Còn phải thu = Tổng VAT − Đã thu (+ trả ngoài đơn như cũ).
- Thêm nhóm cột **Chiết khấu**: Phải chi | Đã chi. Thêm nhóm cột **Kê giá**: Tiền kê | Thuế TNDN trên kê | Phải
  chi | Đã chi. "Phải chi" chỉ đếm hóa đơn đã hết nợ — cùng số với hàng chờ chi.
- Ví dụ trên khi xong hết: Tổng VAT 16.500.000, Cọc 4.950.000 / 4.950.000, Đã xuất HĐ 16.500.000, Đã
  thu 16.500.000, Còn phải thu 0; CK 1.000.000 / 1.000.000; Kê 5.000.000, thuế TNDN 1.000.000, 4.000.000 /
  4.000.000.

Hoa hồng kinh doanh (mốc vẫn là ngày ghi hóa đơn, gốc vẫn trước VAT): gốc của một hóa đơn = phần
trước VAT − CK của hóa đơn − TOÀN BỘ kê của hóa đơn (kể cả phần thuế TNDN trên kê — đó là tiền nộp thuế, không
phải doanh thu của sale). Trừ ngay trong kỳ ghi hóa đơn, thay cho việc trừ theo ngày hóa đơn điều chỉnh.

## 8. Gỡ hóa đơn điều chỉnh giảm

Gỡ trọn: bảng `sales_invoice_adjustments` (migration DROP), model, API tạo/hủy, nút "Điều chỉnh" ở
ngăn đơn, `ck_goi_y`, phần `giam` trong `receivable_rows`, `thua_dieu_chinh_theo_don` trong
`quy_tien_don`, dòng "điều chỉnh giảm" sổ 131, cột BCKD + Excel, phần trừ điều chỉnh ở công nợ / chốt
sổ / khóa kỳ / hoa hồng, chứng từ gốc ở hàng "Chờ trả lại khách". Dữ liệu điều chỉnh trên DB dev mất
theo bảng — chấp nhận (prod chưa có người dùng thật).

## 9. Quyền xem, cổng duyệt

- Tiền kê, % và tiền thuế TNDN trên kê chỉ trả về cho người có quyền xem tiền của màn đó (gate ở máy chủ).
- Cổng duyệt đặc thù báo giá thêm trigger "Kê ngoài rào": soi từng sản phẩm khách thấy (dòng cùng nhóm
  cộng chung), % kê = kê / giá bán, ngoài [`ke_min_pct`, `ke_max_pct`] ⇒ phải trình duyệt. Rào để trống
  thì bỏ chiều đó, như rào chiết khấu.
- Cổng duyệt đặc thù báo giá: markup soi trên giá bán như cũ. Mốc giá trị cao (≥ 1 tỷ) tính trên tổng
  gồm kê.

## 10. Ngoài phạm vi

- Giao diện: chỉ thêm cột / ô / hàng chờ theo khuôn sẵn có, không làm lại bố cục.

## 11. Đã chốt (19/10/2026)

1. Giá bán 1.000, kê 500 ⇒ giá bán sau kê 1.500; đơn giá = 1.500 / số lượng; VAT tính trên 1.500.
2. Kê có hai tab % | Số như chiết khấu; % tính trên giá bán của dòng.
3. Hoa hồng trừ toàn bộ kê.
4. Cọc phải thu có hai tab % | Số (§12).

## 12. Cọc phải thu: hai tab % | Số

- Ô cọc ở đơn hàng (chỗ đang nhập % cọc, `orders.deposit_pct`) đổi sang `OHaiTab` % | Số.
- Thêm `orders.deposit_amount` (BigInteger, null). Gõ tab Số ⇒ lưu số tiền, `deposit_pct` = null; gõ
  tab % ⇒ ngược lại. Cọc phải thu = số tiền nếu có, không thì % × tổng đơn gồm VAT (như hiện nay).
- Số tiền cọc không được vượt giá trị đơn hàng (tổng gồm VAT): chặn ở máy chủ lúc lưu đơn, và chặn
  luôn khi sửa đơn làm tổng tụt xuống dưới số cọc đã gõ.
- Mọi chỗ đọc cọc phải thu (`OrderService._money`, Báo cáo kinh doanh, hàng chờ thu cọc) đi qua MỘT
  hàm chung để hai cách gõ ra cùng một số.

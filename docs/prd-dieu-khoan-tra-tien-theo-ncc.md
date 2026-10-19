# Điều khoản trả tiền thuộc NHÀ CUNG CẤP

Chốt 16/10/2026. Thay cho việc chọn "cách tính hạn trả" trên từng đơn mua (dải gửi duyệt + hộp Ghi
đợt giao, làm 15/10/2026).

## Vì sao đổi

1. Không rõ đổi hạn trả ở bước nào: trước duyệt đổi ở dải gửi duyệt, đã duyệt mà chưa giao thì
   không có chỗ, tới Ghi đợt giao lại hiện "Đổi cách tính" và đổi cho CẢ đơn.
2. Đã duyệt vẫn đổi được hạn trả (cọc thì khoá) — kế toán duyệt một điều khoản, sau đó bị đổi mà
   không duyệt lại.
3. Điều khoản bị chẻ đôi: số ngày cho nợ + hạn mức ở hồ sơ NCC (đọc SỐNG — sửa hồ sơ là hạn các
   đợt đang nợ đổi theo, im lặng), còn cách tính (từ ngày hoá đơn / chốt hằng tháng) ở từng đơn ⇒
   cùng một NCC mỗi đơn một kiểu, không khớp bảng đối chiếu NCC gửi, sao kê công nợ lệch hạn.

Thực tế NCC chốt công nợ một lần cho cả công ty mình. Phần mềm mua hàng phổ biến (Business
Central, Odoo) cũng đặt payment terms ở nhà cung cấp, đơn chỉ thừa hưởng.

## Luật mới

- **Hồ sơ NCC có khối "Điều khoản trả"**, ba ô:
  - Cách tính: *Từ ngày hoá đơn* | *Chốt hằng tháng* + ngày chốt (1–30 hoặc Cuối tháng, lưu 31).
  - Số ngày cho nợ (`credit_days`, đã có).
  - Hạn mức nợ (`credit_limit`, đã có — vẫn chỉ cảnh báo, không chặn).
- **Đơn mua KHÔNG có điều khoản riêng.** Bỏ nút "Đổi" ở dải gửi duyệt và "Đổi cách tính" ở hộp Ghi
  đợt giao. Thỏa thuận riêng cho một đơn (hiếm) ghi vào ô Nội dung / ghi chú của đơn, không tính.
- **Hạn của từng đợt CHỐT lúc ghi đợt** và lưu vào đợt (`purchase_deliveries.due_date`): tính từ
  điều khoản NCC tại thời điểm đó. Sửa đợt (đổi ngày nhận / ngày hoá đơn) thì tính lại hạn của
  chính đợt đó theo điều khoản NCC hiện hành.
- **Sửa điều khoản NCC chỉ áp cho đợt ghi từ đó trở đi.** Đợt đã có hạn giữ nguyên — đó là thỏa
  thuận lúc hàng về. Form NCC nhắc ngay khi đổi điều khoản: "Áp cho hàng về từ nay. Các đợt giao
  đã ghi giữ hạn cũ." Đợt ghi lúc NCC chưa khai số ngày (chưa chụp được hạn) nhận hạn khi NCC khai.
- Cọc giữ như hiện nay: chốt khi bấm Gửi duyệt, khoá khi duyệt.

Công thức hạn một đợt (giữ nguyên `moc_chot_thang`):

- Từ ngày hoá đơn: `ngày hoá đơn (chưa có thì ngày nhận) + credit_days`.
- Chốt hằng tháng: `mốc chốt gần nhất ≥ ngày hoá đơn (chưa có thì ngày nhận) + credit_days`.
- NCC chưa khai `credit_days` ⇒ đợt không có hạn ⇒ màn Công nợ đẩy lên đầu kèm nhãn (giữ luật cũ).

## Từng bước của đơn

| Bước | Hiện gì | Đổi được |
|---|---|---|
| Lập, gửi duyệt (Mua hàng) | "Hạn trả: chốt cuối tháng + 15 ngày" + "Sửa ở hồ sơ nhà cung cấp" | Không |
| Chờ duyệt (Kế toán) | Cùng dòng, cạnh chip vượt hạn mức | Không |
| Đã duyệt | Cột phải ngăn: Hạn trả theo NCC | Không |
| Ghi đợt giao | "Hạn trả đợt này: dd/mm/yyyy" + một dòng giải thích | Không |

## Đụng tới đâu

- DB (`db_migrations.py` + `DB_SCHEMA.md`): thêm `suppliers.debt_cutoff_day` (int, NULL = từ ngày
  hoá đơn). Gỡ `purchase_requests.debt_cutoff_day` (mg 0413 vừa đổi sang cột này, chưa lên prod).
- `purchase_service.han_tra_dot`: bậc 1 = `delivery.due_date` đã chốt; tính mới đọc điều khoản từ
  NCC, bỏ tham số `ngay_chot` của đơn. Ghi/sửa đợt thì ghi `due_date`.
- `cap_nhat_hop_dong`: bỏ `debt_cutoff_day`. Màn Công nợ phải trả, sao kê: đọc hạn đã chốt của đợt.
- FE: `DaiGuiDuyet` (Hạn trả chỉ đọc + lối sang NCC), `DeliveryDialog` (bỏ Đổi cách tính),
  `NganDonMua` cột phải, form NCC khối Thanh toán thêm ô "Tính hạn từ" (Ngày hoá đơn / Chốt cuối
  tháng / Chốt ngày 1–30) — `ChonCachTinhHan` gỡ hẳn. `hanTra.ts` đọc điều khoản từ NCC, bỏ bậc
  "hạn khai tay". Hạn tay theo đợt bỏ luôn: đầu vào đợt giao không nhận `due_date`.

## Dữ liệu cũ

Xoá sạch dữ liệu mua hàng trên DB dev (yêu cầu mua → đơn → đợt giao → phiếu chi của đơn → lịch
sử) theo chốt 16/10/2026, nên không cần chuyển ngày chốt từ đơn sang NCC. Prod chưa có dữ liệu mua.

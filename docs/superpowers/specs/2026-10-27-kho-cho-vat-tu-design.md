# Khổ tuỳ chọn cho vật tư khác — thiết kế

Chốt với user 27/10/2026. Vật tư khác (mực, keo, màng, decal…) có ô khổ như giấy, KHÔNG bắt buộc:
món nào có khổ thì người dùng điền, không có thì bỏ trống. Khổ đi suốt kế hoạch sản xuất → kế hoạch
vật tư → mua hàng → nhà cung cấp → kho → báo cáo kho, y như giấy.

## 1. Luật khổ

- Áp cho `hang_loai ∈ {giay, vat_tu}` (`kho_giay.co_kho`). Thành phẩm và hàng khác: không khổ (0 · 0).
- Chuẩn hoá như giấy (`chuan_kho`): hai cạnh mm, cạnh ngắn trước; một cạnh ⇒ khổ chỉ-rộng `(r, 0)`
  (màng bóng khổ 320); trống ⇒ `(0, 0)` = không khổ.
- So khớp: cùng mã + cùng khổ chuẩn + cùng đơn vị gốc. Khổ chỉ-rộng KHÔNG khớp khổ hai cạnh.
- Vật tư KHÔNG quy đổi theo khổ (không có kiểu tờ↔kg qua định lượng). Khổ chỉ để tách và khớp dòng.

## 2. Từng khâu

- **Tính giá**: không đổi — chọn vật tư, không có ô khổ.
- **Kế hoạch sản xuất (lệnh)**: dòng vật tư của bước có ô khổ (`KhungKho`), người kế hoạch gõ tay. Cột
  `lsx_cong_doan_vat_tu.kho_rong/kho_dai` đã có (mg 0351), trước chỉ giấy.
- **Kế hoạch vật tư**: khoá nhu cầu = mã + khổ + ĐVT. Dòng vật tư TRỐNG khổ tra tồn và phần đang giữ
  bằng TỔNG mọi khổ cùng mã + đơn vị gốc; dòng có khổ chỉ đúng khổ. (Giấy giữ so khớp tuyệt đối: khổ
  0 · 0 của giấy là lô cũ chưa có khổ.)
- **Mua hàng**: dòng yêu cầu mua, đơn mua, đợt giao mang khổ; khổ mua mặc định = khổ cần của dòng yêu
  cầu; đợt giao có khổ nhận.
- **Nhà cung cấp**: dòng giá có khổ. Khớp dòng đúng khổ + dòng 0 · 0 (bán mọi khổ, xếp sau). "Rẻ
  nhất"/tự gán NCC chỉ trong cùng khổ + cùng ĐVT.
- **Kho**: lô nhập lưu khổ; tồn tách mã + khổ + ĐVT; phiếu xuất lấy lô đúng khổ (dòng xin trống khổ
  không xét khổ); điều chuyển chọn đúng dòng tồn (khổ + đơn vị).
- **Báo cáo kho**: cột Khổ hiện cho cả vật tư.

## 3. Dữ liệu

Không migration: mọi bảng đã có `kho_rong/kho_dai`. Dữ liệu vật tư cũ đều 0 · 0 = không khổ, đúng nghĩa.

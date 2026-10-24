# Bấm thử end-to-end: khâu chuẩn bị giấy

Thay Task 12 của `2026-10-24-chuan-bi-giay.md`. Mọi bước bấm/gõ bằng chuột/bàn phím thật trên
dev-browser, không dùng API/curl thay bước nào. Gặp lỗi (logic, giao diện, số sai) thì sửa ngay,
có test đỏ→xanh, restart BE, bấm lại đúng bước đó. Báo cáo ghi từng bước đã bấm gì, gõ gì, thấy gì.

## Môi trường

- DB: bản sao `svn_erp_wt_cbg` của `svn_erp_trong` (không đụng DB dev). Redis riêng `:6391`.
- BE: code nhánh `chuan-bi-giay`, cổng `:8021`, bật qua WMI, env inline (DB clone, Redis riêng,
  `SEED_DEMO=false`, CORS `http://localhost:5185`). Khởi động chạy mg `0443`–`0447`.
- FE: `:5185`, `VITE_API_BASE_URL=http://localhost:8021`. Đăng nhập `admin/admin123`.

## Dữ liệu dựng qua UI

- Giấy `E2E-DUP350` (loại Giấy, 350 gsm, ĐVT tờ + kg), sóng `E2E-SONGE` (loại Sóng).
- Tồn nhập qua phiếu nhập kho, đổi theo từng tình huống: cuộn rộng 870 (kg), tờ 650×430, không tồn.

## Tình huống

| # | Tình huống | Kết quả mong đợi |
|---|---|---|
| 1 | Danh mục công đoạn | 7 công đoạn hệ thống có khoá; mở Tề giấy in: tên/mã/nhóm/đơn vị khoá, sửa năng suất lưu được, không có nút xoá/ngừng |
| 2 | Phiếu tính giá hộp có sóng: Giấy + Sóng ở mục Giấy nguyên, khổ nguyên 650×860, khổ in 650×430, In → Cán → Bồi TĐ → Bế | Có dòng tiền giấy và tiền sóng; ô thêm vật tư của bước không có nhóm Giấy |
| 3 | Kho có cuộn 870 → báo giá → đơn → tạo lệnh | Routing có Tề sóng, Cắt giấy cuộn, Tề giấy in, In…; Nguồn giấy = Cuộn; vật tư Cắt giấy cuộn = kg cuộn 870 |
| 4 | Đổi nguồn ở lệnh: Tờ khổ nguyên → Cuộn rộng 900 (sai) → Cuộn 870 | CGC biến mất, giấy về Tề bằng tờ 650×860; 900 báo lỗi rộng cuộn; 870 dựng lại CGC |
| 5 | Tờ rơi, kho có tờ đúng khổ in | Không thêm bước; nguồn Tờ đúng khổ in; giấy ở In |
| 6 | Kho trống | Nguồn Mua mới, có Tề giấy in; Kế hoạch vật tư báo thiếu tờ khổ nguyên |
| 7 | Sách (bìa + ruột gấp tay) | Mỗi lệnh có khâu theo nguồn; số tờ/kg khớp số tờ in của ruột; lệnh không vỡ |
| 8 | Gia công một phần: một bước sau in thuê ngoài | Khâu chuẩn bị giữ nguyên; bước thuê ngoài chọn nhà gia công; sẵn sàng được |
| 9 | Gia công trọn gói, xưởng cấp giấy, nguồn Cuộn và nguồn Tờ khổ nguyên | Chọn giấy cấp cho nhà gia công đề xuất đúng thứ kho có (nghi lỗi: nguồn Cuộn rơi về tờ khổ nguyên của phiếu) |
| 10 | Gia công trọn gói, nhà gia công tự lo giấy | Kế hoạch vật tư không có nhu cầu giấy của lệnh |
| 11 | Bài ghép hai lệnh cùng giấy → gộp In | Lệnh dựng khâu theo nguồn bài; có Tề giấy in chung đứng trước In chung; tách bước khâu chung bị chặn; Kế hoạch vật tư một dòng giấy của bài; bỏ một lệnh ra thì lệnh đó dựng lại khâu riêng |
| 12 | Kế hoạch vật tư + giữ chỗ + phát hành (lệnh nguồn Cuộn) | Nhu cầu đúng khoá (kg cuộn 870); bật giữ chỗ được; phát hành tự lập yêu cầu xuất giấy ở Cắt giấy cuộn; In không chờ giấy |

## Sau khi bấm xong

Gỡ BE/FE thử, xoá DB clone và container Redis riêng; ghi kết quả + các sửa lỗi vào ledger; chạy
review cuối toàn nhánh.

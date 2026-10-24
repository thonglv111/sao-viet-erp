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

### Bổ sung 24/10 (hồi quy các module nhánh có sửa)

| # | Tình huống | Kết quả mong đợi |
|---|---|---|
| 13 | Mua hàng: yêu cầu mua giấy tờ + cuộn → đơn mua → đợt giao | Cột "Định lượng" chỉ đọc lấy từ danh mục, cột "Khổ" riêng, không nhét vào tên hàng; lưu được |
| 14 | Nhập kho giấy: dòng tờ khai kg (đủ khổ) / dòng kg quá nhỏ / cuộn kg | Tờ: quy ra tờ làm tròn xuống, lô lưu tờ; quá nhỏ: báo "quy ra 0 tờ", không tạo lô; cuộn: lô kg |
| 15 | Tồn kho + xuất kho theo đề nghị DNX00003–00006 | Tồn: tờ có "Quy kg" + "Định lượng", cuộn trống "Quy kg"; lập phiếu xuất trừ đúng lô cuộn kg / lô tờ |
| 16 | Báo giá từ phiếu có sóng | Dòng tiền giấy + tiền sóng khớp phiếu tính giá |

### Bổ sung 25/10: use case đa trường hợp cho các module dùng chung

Nhánh đổi ba chỗ dùng chung: quy đổi lúc ghi sổ phiếu kho nhận khổ (`stock_voucher_service._quy_doi`,
áp cả phiếu xuất), cột chỉ đọc Định lượng/Quy kg trên tồn, giấy/sóng của báo giá đọc ở sản phẩm. Sửa
chữa máy và Tài sản/khấu hao không gọi kho hay mua hàng (đã soi code) ⇒ chỉ mở màn một lượt.

| # | Module | Trường hợp | Kết quả mong đợi |
|---|---|---|---|
| MH1 | Mua hàng | Giấy tờ, NCC bán theo tờ | Đơn mua tờ, đợt giao nhận tờ, lô tờ đúng số |
| MH2 | Mua hàng | Giấy tờ, NCC bán theo kg (TH13–14) | Lô quy ra tờ làm tròn xuống |
| MH3 | Mua hàng | Giấy cuộn mua kg (khổ chỉ rộng) | Lô kg khổ (rộng, 0), không quy tờ |
| MH4 | Mua hàng | Đợt giao nhận khổ khác khổ đặt | Lô theo khổ nhận, đơn ghi "Vào tồn theo khổ nhận" |
| MH5 | Mua hàng | Giao hai đợt (thiếu rồi bù) | Hai yêu cầu nhập, tổng nhận = đặt, công nợ theo từng đợt |
| MH6 | Mua hàng | Vật tư khác (mực/keo) | Không cột Định lượng, không quy tờ, nhập như cũ |
| K1 | Kho | Nhập giấy tờ khai ram | 1 ram = 500 tờ, không đi đường kg |
| K2 | Kho | Nhập tờ khai kg, sửa khổ thực nhận | "Vào tồn" tính lại theo khổ nhận, lô đúng số (đã bấm) |
| K3 | Kho | Nhập kg quá nhỏ | Chặn "quy ra 0 tờ" (đã bấm) |
| K4 | Kho | Xuất giấy tờ, đề nghị theo kg | Trừ lô tờ đúng số quy đổi, giá vốn đúng |
| K5 | Kho | Xuất thiếu tồn / xuất một phần | Báo hết tồn; cấp một phần bắt lý do, yêu cầu còn "đang cấp" |
| K6 | Kho | Điều chuyển giấy tờ sang kho khác | Lô đích giữ khổ + gốc tờ, tồn hai kho đúng |
| K7 | Kho | Nhập/xuất vật tư khác | Như cũ (hồi quy phần quy đổi) |
| BC1 | Báo cáo kho | Sổ kho / chi tiết phiếu trong kỳ | Mỗi phiếu đúng đơn vị gốc (tờ cho lô tờ, kg cho cuộn), số khớp phiếu |
| BC2 | Báo cáo kho | Nhập–xuất–tồn | Đầu kỳ + nhập − xuất = cuối kỳ theo từng dòng khổ + đơn vị; không cộng tờ với kg |
| BC3 | Báo cáo kho | Tính giá kỳ | Giá trị xuất/tồn khớp giá lô, lệch làm tròn ghi rõ |
| BC4 | Báo cáo kho | Chuyển kho | Dòng điều chuyển K6 hiện đúng hai kho |
| BH1 | Bán hàng | Báo giá phiếu có sóng (TH16) | Giấy + sóng, giá vốn khoá khớp |
| BH2 | Bán hàng | Báo giá tờ rơi không sóng / sách nhiều thành phần | Giấy từng thành phần đúng |
| BH3 | Bán hàng | Nhân bản phiếu có sóng → báo giá mới | Bản sao giữ giấy + sóng |
| BH4 | Bán hàng | Đơn → giao hàng xuất kho thành phẩm | Phiếu xuất KHO-TP như cũ |
| SC1 | Sửa chữa | Mở phiếu sửa chữa / bảo trì | Không lỗi (không dính kho) |
| TS1 | Tài sản | Mở Tài sản & CCDC, xem khấu hao | Không lỗi (không dính kho) |

## Sau khi bấm xong

Gỡ BE/FE thử, xoá DB clone và container Redis riêng; ghi kết quả + các sửa lỗi vào ledger; chạy
review cuối toàn nhánh.

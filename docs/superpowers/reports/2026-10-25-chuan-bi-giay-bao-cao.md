# Báo cáo cuối — Khâu chuẩn bị giấy (nhánh `chuan-bi-giay`)

Plan: `docs/superpowers/plans/2026-10-24-chuan-bi-giay.md` (11 task) + e2e `docs/superpowers/plans/2026-10-24-chuan-bi-giay-e2e-ui.md`.
Spec: `docs/superpowers/specs/2026-10-24-chuan-bi-giay-design.md`.
Nhánh `chuan-bi-giay`: 105 commit trên `main`, đã merge dev (9d6a90b9), chưa push, chưa merge vào dev.

## Kết quả

Cả 11 task đã xong. Duyệt lại toàn nhánh tìm ra 4 lỗi Important (I1–I4) và Minor 4 (nâng thành Important), đã sửa hết theo RED→GREEN (5ea5c31d).
E2E UI chạy trên DB clone `svn_erp_wt_cbg` (BE :8021, FE :5185, Redis :6391 riêng), không đụng DB dev `svn_erp_trong`.
Lúc bấm thử lộ ra 8 lỗi, đã sửa cả 8, mỗi lỗi có test RED→GREEN:
- Phiếu tính giá mời chọn khâu chuẩn bị giấy, panel giá vốn bỏ sót dòng sóng (da0bdc2e).
- Lưu công đoạn làm mất rộng cuộn; Tề sóng hiển thị nối nhầm; cảnh báo "đứt đơn vị" oan (da0bdc2e).
- Trọn gói xưởng cấp giấy không cấp được cuộn (20e7ad51, c42e6be6).
- Ô "Vào tồn" ở phiếu nhập kg quy tờ nhân hệ số đã làm tròn (5f247942).
- Kg cuộn của Cắt giấy cuộn treo vài gam ở bảng cân đối (05ad603f).
- Đề nghị xuất giấy hai cạnh theo kg báo tồn 0; báo cáo kho lệch tiền dòng nhập, cột Khổ của cuộn trống (581bf1f8).
- Đợt giao đơn mua có dòng giấy cuộn bị chặn đòi đủ hai cạnh khổ (b2c0d64a).
- Form yêu cầu mua mở từ Kế hoạch vật tư/Kho không hiện định lượng (d77a2a3d).

Xác minh: chỉ pytest nhắm file, `npx tsc --noEmit -p .` và `npx vitest run <file>`; KHÔNG chạy `./init.ps1` hay pytest full (theo yêu cầu, để CI chạy).
Lượt cuối gồm 59 file backend liên quan (830 + 340 + 123 + 12 pass), giao hàng + kho thành phẩm 97/97, giaCong.test 27/27, helpers.test 16/16, tsc sạch.
Đỏ sẵn, không thuộc nhánh: `test_bien_cong_thuc::test_api_tra_dung_bo_loc` (KeyError, đỏ cả trên HEAD sạch).

## Ca chưa bấm UI được (nói rõ)

- **I4** (chặn đổi nguồn giấy khi lệnh trong bài ghép) và **TH11 bài ghép**: màn Bài ghép bị ẩn bằng cờ `BAI_GHEP_ENABLED=false` từ 10/09/2026; DB clone không có bài nào. Chỉ phủ bằng unit test.
- **K6/BC4** điều chuyển kho: không áp dụng, FE tắt có chủ đích (`AN_DIEU_CHUYEN = true`).
- **BH2**: không bấm lại, đã phủ bởi TH5 (tờ rơi không sóng) và TH7 (sách ruột + bìa).

## Những lần dùng JavaScript

- Một lần dùng JS `.click()`: mở tab Công đoạn của LSX26-0008 vì nút tab không nhận click theo toạ độ. Ngoài lần đó, mọi thao tác đều là chuột/phím thật.
- Các lần còn lại chỉ ĐỌC: lấy giá trị và toạ độ các ô input trong hộp Ghi đợt giao; `get_page_text` để đọc số ở NXT và Chi tiết phiếu; đọc `value` ô kg trọn gói (ảnh chụp nhỏ không phân biệt được chấm/phẩy) và các ô form điểm giao khách (ảnh chụp trễ khi pane ẩn).
- Nút "Tính giá" ở dòng kỳ nằm ngoài khung nhìn: cuộn tới bằng ref rồi bấm chuột thật, không phải JS.

## Bấm thử từng bước — các ca phiên cuối (25/10)

**MH1 — mua giấy NCC bán theo tờ**
1. Yêu cầu mua hàng → "Tạo yêu cầu mua" → "+3 ngày" (28/10/2026) → Nội dung "E2E MH1 mua giay theo to" → ô vật tư gõ "DUPLEX 230" → chọn DUPLEX 230-250GSM (định lượng 230 tự hiện) → Rộng 790, Dài 1090 → ĐVT chọn "tờ" (danh sách có kg/g/tấn/tờ/ram) → số lượng 1000 → "Gửi yêu cầu".
2. Thấy: danh sách Từng món CHƯA có dòng mới; tải lại trang mới thấy YCMH-261025-3OEW (DB đã có, status open). Ghi follow-up.
3. Mua hàng → tick dòng DUPLEX 230 → "Lập đơn mua cho 1 món" → form tự chọn Giấy Việt Trì, 1000 tờ × 2.500 đ/tờ, VAT 8%, thành tiền 2.700.000 → "Lưu đơn" → DMH-261025-E2YO Nháp.
4. Mở đơn → "Gửi duyệt" → Chờ duyệt. Kế toán → Đơn mua hàng → mở đơn → "Duyệt" → Đã duyệt.
5. Mua hàng → mở đơn → "Đã đặt hàng" → Chờ hàng về → "Ghi đợt giao" → Đợt 1 điền sẵn khổ nhận 790×1090, 1.000 tờ, tiền 2.700.000 → "Lưu đợt giao" → đơn "Kho chưa nhập", Còn nợ 2.700.000.
6. Kho → Phiếu từ yêu cầu → DNN00011 (DUPLEX 230, 0/1.000 tờ) → "Lập phiếu nhập" → điền sẵn Kho giấy, 1000, khổ 790×1090, tổng 2.500.000 → "Tạo và ghi sổ" → hộp "Ghi sổ phiếu nhập kho?" → "Ghi sổ" → toast "Hoàn tất yêu cầu".
7. Kiểm DB: lô LOT-DUPLEX-230-261025-01, 1.000 tờ, 790×1090, don_vi_goc=to, 2.500 đ/tờ. Đạt.

**BH3 — nhân bản phiếu có sóng**
Tính giá → PTG-2026-0005 → "Nhân bản" → PTG-2026-0008 giữ Duplex 350 E2E 750 tờ 2.641.275 và Giấy sóng E 300GSM 1.500 tờ 1.509.300, tổng 4.150.575 → "Báo giá →" → BG26-0008 v1 Nháp, mô tả liệt kê cả Duplex lẫn sóng E, giá vốn khoá 4.150.575. Đạt.

**SC1 — Sửa chữa máy**: danh sách 8 phiếu chờ sửa → mở SC-0012 (triệu chứng, ảnh trước/sau, nút "Xác nhận đã sửa xong") → đóng → tab "Yêu cầu báo hỏng" (trống). Không lỗi.

**TS1 — Tài sản & CCDC**: tab "Khấu hao từng tháng" → tháng 10/2026 tổng 77.818.479 đ, 19 tài sản → mở TS-0001 Máy in Komori, hiện lịch khấu hao theo năm và lịch sử sửa chữa lớn/chuyển bộ phận. Không lỗi.

**BC1/BC2 lặp lại sau phiếu mới** (Báo cáo kho → Nhập-Xuất-Tồn tháng 10/2026)
- Couche 640×860: 823 tờ 1.659.200 (= 68 kg × 24.400).
- Couche 650×860: 1.192 tờ 2.440.000.
- Duplex 230 790×1090: 1.000 tờ 2.500.000.
- Duplex 300 khổ 860: 300 kg 5.160.000.
- Ivory 650×860: 1.500 tờ 4.587.200 (= 2.587.200 + 2.000.000).
- Màng: 150 m² 580.000.
- Dòng tờ hiện tờ, dòng cuộn hiện kg, không cộng lẫn. Mọi dòng đầu + nhập − xuất = cuối.

**BC3 — Tính giá kỳ**
- Kỳ kế toán → "Khóa / mở kỳ" → Khóa kỳ, Toàn kho → Từ ngày chọn 1/10 trên lịch.
- Lần đầu gõ thêm "01/10/2026" vào ô đã có ngày nên chuỗi bị nhân đôi → bấm "Xoá" → chọn lại ngày 1.
- Đến ngày 25/10/2026 → tên kỳ "Ky thang 10/2026 E2E" → "Khóa sổ" → dòng kỳ "Chờ tính giá".
- "Tính giá" → hộp bình quân cuối kỳ → "Tính giá kỳ" → "Đã chốt giá", giá trị cuối kỳ 97.502.513 = nhập 112.406.400 − xuất 14.903.887.
- "Xem số liệu": Ivory 650×860 BQ 3.058, xuất 1.529.067 + cuối 3.058.133 = 4.587.200 (không rò làm tròn). Đạt.
- Chi tiết phiếu sau tính giá: PXK00006 xuất hết lô Ivory 640×860 605 tờ = 3.080.055, trong khi lô nhập 3.080.000. Cùng gốc với minor đã hoãn (giá lô lưu nguyên đồng).

**Chuỗi trọn gói → KHO-TP → giao hàng (Minor 4 + BH4)**
Dựng bằng UI: DNN00002 nhập 3.000 kg cuộn Duplex 300 khổ 870 × 18.100 → PTG-2026-0005 (3K, 3.000 cái, khổ nguyên 860×650) → BG26-0005 gửi khách, khách chốt → DH001 (PO-E2E-01, giao 30/10/2026) chốt đơn → Kế hoạch SX "Xác nhận tạo 1 lệnh" → LSX26-0004 nguồn Cuộn, chuỗi Cắt giấy cuộn → Tề giấy in → In.
1. LSX26-0004 → "Gia công trọn gói" → Nhà gia công chọn "Xưởng Gia công Bế hộp Minh Phát", Số đặt 3.000, giữ tick "Xưởng cấp giấy" → "Đặt gia công trọn gói" → lệnh "Đã phát hành", khối Gia công ngoài "Đang ở nhà gia công", "Chưa cấp giấy cho nhà gia công".
2. Minor 4: "Chọn giấy" → khổ "cuộn rộng 870 mm, đúng lệnh, tồn 3.000 kg", ô "Số kg xin xuất" điền sẵn "63,62" → bôi đen, gõ "1.500" → ô hiện "1.500" → gõ thêm ",5" → "1.500,5" → "Gửi đề nghị xuất giấy" → khối hiện "cuộn rộng 870 mm 1.500,5 kg", Kho "Chờ kho soạn DNX00003". DB: dòng đề nghị 1500.50 kg, khổ 870×0, đvt kg. Đạt.
3. Kho → Phiếu từ yêu cầu → DNX00003 (Gia công LSX26-0004, 0/1.500,5 kg) → "Lập phiếu xuất" → cấp 1500,5 lấy từ PNK00002, giá vốn 27.159.050 (= 1.500,5 × 18.100) → "Tạo và ghi sổ" → "Ghi sổ" → "Hoàn tất yêu cầu". DB: lô cuộn còn 1.499,5 kg.
4. LSX26-0004 → Kho "Đã xuất đủ DNX00003 PXK00003" → "Nhận hàng về" → Số nhận về 3000, "Nhập kho thành phẩm" → "Chốt số nhận về" → "Đã nhận về 3.000 cái, Nhập kho thành phẩm", Chi tiền "Chờ kế toán chi". DB: DNN00003 loại NHAP, kho 2 (KHO-TP), TP-00004 3.000 cái.
5. Kho → DNN00003 (Kho tiếp nhận "Kho thành phẩm", nguồn "Nhà gia công giao thành phẩm", giá gốc "Chưa có") → "Lập phiếu nhập" → nhập 3000 → "Tạo và ghi sổ" → "Ghi sổ". DB: lô LOT-TP-00004-261025-01 3.000 cái ở kho 2.
6. BH4: Đơn hàng bán → DH001 → "Giao được ngay 3.000 cái Kho thành phẩm" → "Tạo yêu cầu giao hàng" → báo khách 3K chưa có địa chỉ giao, nút Gửi khoá → "Mở hồ sơ khách hàng" → tab Giao hàng → "Thêm điểm giao ngay" → tên "Kho 3K Bac Ninh", địa chỉ "KCN Que Vo, Bac Ninh", tick "Điểm giao mặc định" → "Lưu".
7. Quay lại DH001 → "Tạo yêu cầu giao hàng" → Giao tới tự chọn "Kho 3K Bac Ninh (Mặc định)" → số lượng sửa 3000 → 1200 → "Gửi yêu cầu" → YCGH-261025-KJEV 1.200 cái "Chờ lên đơn"; đơn hiện Đang chờ giao 1.200, Còn phải giao 1.800, Giao được ngay 1.800.
8. Giao hàng → tick YCGH-261025-KJEV → "Lên lượt xe (1)" → chọn xe 51C-62318, tài xế Trần Văn Thạch Sang → "Lên lượt xe cho 1 đơn" → "Đã lên lượt LX-261025-7VC6… Kho thành phẩm đã nhận 1 đề nghị", DNX00004: TP-00004 1.200 cái, Xuất từ kho "Kho thành phẩm" → "Lưu cho kho".
9. Kho → DNX00004 → "Lập phiếu xuất" → Xuất từ kho "Kho thành phẩm", tồn 3.000, cấp 1200 lấy từ PNK00003, khối Giao hàng ghi 3K/DH001/YCGH-261025-KJEV/LX-261025-7VC6/51C-62318 → "Tạo và ghi sổ" → "Ghi sổ" → "Hoàn tất yêu cầu". DB: lô LOT-TP-00004 còn 1.800 cái, DNX00004 done gắn lượt xe 623. Đạt.

## Follow-up

- Danh sách yêu cầu mua (Từng món) không hiện yêu cầu vừa gửi cho tới khi tải lại trang. Gặp một lần; code đã gọi `mon.nap()`, nhánh này không đụng logic nạp lại.
- Khối Hoạt động ở phiếu tính giá hiện cả dòng của phiếu khác (PTG-2026-0008 vừa nhân bản đã có "Cập nhật phiếu 09/10/2026").
- Header "GIẤY NGUYÊN" sai khi nguồn là tờ đúng khổ in.
- Thiếu bước gấp nhận tờ in.
- "Thiếu công thức 0đ" trên bản clone.
- Cắt giấy cuộn/Tề sóng báo "Chưa tính được giờ".
- Duplex/Sóng E chưa có NCC khai bán; MH1 thiếu NCC bán Couche theo tờ.
- Đề xuất: đơn mua dòng tờ mà NCC bán theo kg thì nên tự quy tờ→kg.
- Đề xuất: phiếu nhập màng nên mặc định kho vật tư thay vì Kho giấy.
- Hệ quả của I2: công đoạn hệ thống Tề giấy in (TGI) PHẢI được gán tổ ở danh mục; nếu không, lệnh có khổ nguyên khác khổ in sẽ báo thiếu tổ/máy và không "sẵn sàng".
- Test đỏ sẵn `test_bien_cong_thuc::test_api_tra_dung_bo_loc`.

## Deferred minors

- Giá trị lô tờ quy từ kg lệch vài trăm đồng so với tiền hàng, vì đơn giá/tờ làm tròn số nguyên: PXK00004 2.587.000 vs 2.587.200, PXK00006 3.080.055 vs 3.080.000.
- `tinh_xuoi_tu_to` không bỏ qua Tề sóng.
- `thieu_kho_nguyen` chặn cả khi nguồn là `to_in`.
- Lỗi nguồn giấy trả HTTP 400 chứ không phải 422.
- Ô Nguồn giấy không đổi được rộng cuộn khi đang ở nguồn cuộn.
- `doi_nguon_giay` nhận `to_nguyen` khi thiếu khổ nguyên.

## Rulings đã quyết thay chủ dự án (đủ, theo thứ tự)

- Setup: Ruling: commit từng task trên nhánh riêng chuan-bi-giay (không push, không merge dev) — user duyệt plan có bước commit và chọn làm inline; merge dev vẫn phải hỏi — cost if wrong: gộp/xoá commit trên nhánh riêng, không ảnh hưởng dev.
- Setup: Ruling: khổ sóng = khổ in — user 24/10 "người yêu cầu/mua hàng sửa được khổ nên không sao" — cost if wrong: thêm ô khổ sóng ở phiếu.
- Task 1: Ruling: migration chèn dòng mới với pricing_basis='per_sheet' (dòng có sẵn chỉ điền khi trống) — _validate bắt buộc pricing_basis, để NULL thì không ai lưu được form công đoạn hệ thống — cost if wrong: đổi một hằng.
- Task 1: Ruling: schema là CongDoanRow (plan ghi CongDoanOut, không tồn tại) — cùng ý — cost if wrong: không.
- Task 2: Ruling: BỎ migration 0444 — DB dev 0 lô/giữ chỗ/phiếu giấy kg hai cạnh (đếm 24/10), prod trắng; quy riêng lô mà không quy sổ phiếu là lệch sổ — cost if wrong: DB nào có lô kg khổ hai cạnh thì lô đó vẫn đếm kg như cũ.
- Task 2: Ruling: quy kg→tờ đặt trong `VatLieuKhoService.quy_ve_goc(kho_rong, kho_dai)` (một cửa cho đề nghị + phiếu) và CHỈ cho yêu cầu NHẬP (`_validate_lines(nhap=)`), không cho đề nghị xuất / điều chuyển — spec §5 chỉ nói nhập; xưởng xin kg kèm khổ thành phẩm sẽ bị quy sai — cost if wrong: thêm cờ ở điều chuyển.
- Task 2: Ruling: router đề nghị kho cũng hiện số tờ quy đổi (bắt lỗi "không đổi được từ kg về tờ" bị bật oan) — test_phan_hoi_dong_kg_kho_hai_canh_quy_ra_to RED→GREEN.
- Task 2: Ruling: sửa test cũ trái spec §5 (test_kho_lo_giay: kg khổ hai cạnh ⇒ tờ; test_kho_ton_theo_kho: dòng kg riêng đổi sang cuộn 780) — giữ ý tách dòng kg — cost if wrong: không.
- Task 3: Ruling: bảng lô (ngăn chi tiết một mặt hàng) chỉ thêm Quy kg, KHÔNG thêm Định lượng — mọi lô cùng một gsm, nhắc lại mỗi dòng trái luật "mỗi thông tin nói một lần" — cost if wrong: thêm một cột.
- Task 3: Ruling: vitest đặt ở KhoTonKhoPage.quyKg.test.tsx (plan ghi khoNganA.test.tsx — file đó về NguonA) — cost if wrong: không.
- Task 4: Ruling: payload mua gửi kèm dinh_luong ⇒ 422 (plan ghi "bỏ qua") — schema vào cấm khoá lạ, không âm thầm nuốt — cost if wrong: client cũ gửi kèm bị chặn (hiện không có client nào gửi).
- Task 4: Ruling: thêm dinh_luong cho MatHangRow (ô chọn hàng) và lưới Từng món — form YCMH cần hiện gsm ngay lúc chọn, lưới món là nơi Mua hàng gom — cost if wrong: hai field thừa.
- Task 4: Ruling: cột Khổ/Định lượng ở chi tiết yêu cầu, form đơn, đơn mua, đợt giao chỉ hiện khi chứng từ có dòng giấy — chứng từ toàn vật tư khác khỏi hai cột trống — cost if wrong: cột nhảy theo chứng từ.
- Task 4: Ruling: lệch TDD — vitest lưới Từng món viết sau code, chưa thấy RED — cost if wrong: test có thể không bắt được hồi quy cột.
- Task 5: Ruling: KHÔNG thêm biến `so_to_song` vào từ điển biến công thức (bien_cong_thuc) — không task nào đọc nó; dòng sóng chạy công thức giá của mã sóng với to_nguyen = số tờ sóng, dai/rong_nguyen = khổ in (trống ⇒ công thức spec theo đơn vị giá) — cost if wrong: thêm một biến + chip FE.
- Task 5: Ruling: kiem_giay_song thêm kwarg `bang=` nạp sẵn cho cả phiếu — giữ số câu SQL lưu phiếu không tăng theo số sản phẩm (guard ở test_bao_gia_theo_phieu) — cost if wrong: không.
- Task 5: Ruling: mã giấy/sóng đã xoá khỏi danh mục không chặn lưu (FK mềm, phiếu cũ lưu lại được) — cost if wrong: phiếu trỏ mã ma, tiền 0.
- Task 5: Ruling: kiểm-xoá danh mục giấy (danh_muc_tham_chieu) đếm cả `song_id` — ngoài danh sách file của brief nhưng thiếu thì xoá được mã đang làm sóng; test test_xoa_ma_song_dang_dung_o_phieu_bi_chan RED→GREEN — cost if wrong: không.
- Task 5: Ruling: 3 test lệnh của test_loai_giay_song gắn giấy qua replace_routing thay vì chép từ bước phiếu; 2 test test_giay_vat_tu_buoc_lsx (lệnh chép giấy từ bước phiếu) ĐỂ ĐỎ tới Task 8 (plan giao Task 8 sửa file đó) — cost if wrong: nhánh giữa Task 5–8 có 2 test đỏ.
- Task 5: Ruling: test_tien_giay_cap_san_pham_khi_co_chuoi thêm assert buoc_idx None vì số tiền cũ (giấy ở bước In) trùng số mới, test không đỏ nếu chỉ so tiền — cost if wrong: không.
- Task 6: Ruling: tách ô Giấy + Sóng thành component OGiaySong.tsx, test ở OGiaySong.test.tsx (plan ghi PhieuTinhGiaDetailView.test.tsx) — dựng cả màn phiếu trong vitest cần mock cả chục API; payload kiểm qua export fromComponent/toThanhPhanIn — cost if wrong: không.
- Task 6: Ruling: giá theo danh mục hiện dưới CẢ ô Giấy lẫn ô Sóng (plan chỉ nói ô Giấy) — sale cần thấy giá sóng như giá giấy — cost if wrong: bỏ một dòng chữ.
- Task 6: Ruling: gỡ code chỉ phục vụ giấy-ở-bước (nhanKhoGiay của BuocVatTu, DinhMuc.kho, .tg-bvt__kho); BuocVatTuOut.hang_loai để string để đọc dòng giay sót mà bỏ qua — cost if wrong: không.
- Task 6: Ruling: test BuocVatTu "không nhóm Giấy/Sóng" ĐỎ trước khi sửa; test OGiaySong đỏ vì module chưa có (RED đúng) — bấm thử UI thật để Task 12.
- Task 7: Ruling: cuộn dò rộng w∈[cạnh, cạnh+30] của cả hai cạnh khổ nguyên qua callable ton_tu_do, chọn w nhỏ nhất đủ kg; w khớp cả hai cạnh ⇒ cạnh lớn là cạnh khớp — brief không nói cách dò khi tồn chỉ hỏi được theo khoá — cost if wrong: chọn cuộn rộng hơn cần vài mm
- Task 7: Ruling: thêm test cuộn không đủ kg và test dòng giấy lấy thẳng tờ in; thiếu khổ nguyên ⇒ mua + ly_do, dòng giấy tờ khổ in — brief không có ca này — cost if wrong: một test
- Task 8: Ruling: giữ nguyên dong_giay_theo_dau_vao (không gỡ nhánh con/cái/tay/—) và _dong_giay_cho_ma/_sl_ra_buoc_giay; lệnh có nguon_giay đi _dong_giay_khau_chuan_bi, lệnh NULL đi luật cũ — KHVT (ke_hoach_vat_tu_service:1331) còn gọi nhánh kg, Review Focus đòi lệnh cũ KHVT không đổi — cost if wrong: còn code chết cho lệnh 18/10 có giấy ở bước con/cái
- Task 8: Ruling: rộng cuộn lưu ở kho_rong của dòng giấy bước CGC (không thêm cột) — spec không chỉ chỗ lưu — cost if wrong: replace_routing gửi lại vat_tus ghi kho 0 thì dòng CGC mất rộng cuộn, _dong_bo giữ số cũ + ly_do (Task 9 đổi nguồn dựng lại)
- Task 8: Ruling: mã thiếu là 'thieu_kho_nguyen' (nhãn FE 'Thiếu khổ nguyên của giấy'), không phải chuỗi tiếng Việt trong kiem_thieu — kiem_thieu trả mã snake — cost if wrong: đổi nhãn
- Task 8: Ruling: phiếu kiểu cũ đã có bước dòng giấy đứng trước In (xả/cắt tờ) ⇒ không chèn khâu, nguon_giay NULL, giấy gắn bước đầu dòng giấy — chèn TGI là chia mảnh xả hai lần (test_hai_nguon_khop xa-giay đỏ 31≠62) — cost if wrong: phiếu cũ không được máy chọn nguồn
- Task 8: Ruling: thêm khoa_ung_vien(dv) ở chuan_bi_giay để đọc tồn tự do một lượt (GiuChoService với SimpleNamespace(lots=StockLotRepository)) — tránh ~60 lượt query dò cuộn — cost if wrong: không
- Task 8: Ruling: _dung_khau_chuan_bi trả list bước mới (Produces ghi None) để tao bung vật tư định mức — tương thích ngược — cost if wrong: không
- Task 8: Ruling: test_doi_cong_doan... gửi vat_tus=None cho bước khác là xoá sạch ⇒ sửa payload test chỉ gửi vat_tus cho bước đổi; test_giay_vat_tu_buoc_lsx viết lại theo giấy cấp sản phẩm — cost if wrong: client thật gửi None sẽ xoá giấy máy gắn
- Task 9: Ruling: test giao diện viết cho component riêng ONguonGiay (ONguonGiay.test.tsx) thay vì dựng cả LsxDetailView.test.tsx — màn lệnh 1.900 dòng, nạp hàng chục API; component nhận onDoi, màn lệnh gọi PUT rồi setD/setForm — cost if wrong: phần nối trong LsxDetailView chỉ được tsc + bấm thử Task 12 phủ
- Task 9: Ruling: khoá ô Nguồn giấy cả khi routing đang sửa dở (routingDirty) và khi không có quyền update — đổi nguồn nạp lại lệnh sẽ đè thay đổi chưa lưu — cost if wrong: phải lưu routing trước khi đổi nguồn
- Task 9: Ruling: rộng cuộn nhập tay phải nằm trong [cạnh khổ nguyên, cạnh+30] (422 nếu không), cùng luật CUON_DU_TOI_DA_MM của máy chọn — brief chỉ nói thiếu rộng ⇒ 422 — cost if wrong: không dùng được cuộn rộng hơn 30 mm
- Task 9: Ruling: ô Nguồn giấy hiện khi lệnh có nguon_giay hoặc quy cách có giay_id (lệnh cũ cũng đổi được, lúc đó máy chèn khâu lần đầu) — cost if wrong: lệnh cũ bị dựng khâu khi người kế hoạch chủ động đổi
- Task 10: Ruling: khâu chuẩn bị của bài là LỚP ĐÈ lên Cắt giấy cuộn / Tề giấy in của từng lệnh thành viên (dựng theo bai_ghep.nguon_giay), gộp tự động thành bước chung khi bài có In chung — không tạo bước chung không map — mô hình bước chung bắt buộc phủ ≥2 bước lệnh; bước chung không map thì xếp lịch/ghi sản lượng/buoc_lay_giay_bai_lo (spec §8 dẫn chính hàm này) không thấy — cost if wrong: lệnh trong bài vẫn hiện bước Tề/Cắt (bị đè), khác chữ "gỡ" của spec
- Task 10: Ruling: đổi tên test brief test_lenh_vao_bai_go_cat_cuon_te_rieng_giu_te_song → test_lenh_vao_bai_dung_khau_theo_nguon_bai_giu_te_song; thêm test tách In chung, phá bài, KHVT cuộn kg — theo ruling lớp đè — cost if wrong: đổi tên test
- Task 10: Ruling: bài chọn lại nguồn theo tồn ở tạo bài, thêm/bỏ thành viên, đổi giấy/khổ in; gộp/tách chỉ đồng bộ khâu chung; lệnh đã đúng nguồn (cùng rộng cuộn) thì không dựng lại — giữ tổ/máy đã khai — cost if wrong: tồn đổi giữa chừng không tự đổi nguồn bài
- Task 10: Ruling: không cho tách riêng khâu chung (422) — khâu đi theo In chung — cost if wrong: muốn chạy Tề riêng từng lệnh phải tách In chung
- Task 10: Ruling: chưa có ô đổi nguồn giấy cho BÀI (chỉ lệnh có) — spec §8 không nêu UI — cost if wrong: thêm endpoint + ô ở màn bài ghép
- Task 10: Ruling: KHVT bài nguồn cuộn ⇒ kg theo rộng cuộn trên dòng giấy bước thành viên mà Cắt giấy cuộn chung phủ, số tờ = SL vào bước chung (repo rong_cuon_cua_buoc_chung) — cost if wrong: dòng cuộn của bài lệch kg so với lệnh
- Task 10: Ruling: test_lsx_vat_tu_tu_phieu bỏ điều kiện "bước khác không vật tư" cho dòng GIẤY — Task 8 gắn giấy vào bước đầu là hành vi mới — cost if wrong: không
- Task 11: Ruling: 6 test ghim xanh ngay lần đầu, không sửa code — plan Step 2 cho phép (xanh thì giữ); test lệnh cũ dựng bằng cách gỡ khâu + đặt nguon_giay NULL + gắn giấy khổ in ở In — cost if wrong: không
- E2E TH2: Ruling: phiếu tính giá mời chọn công đoạn trước in (chip đầu là Cắt giấy cuộn) — trái spec §2 + luật 08/09 'chuỗi chỉ In + sau in'; chọn CGC/TGI ở phiếu thì lệnh coi là tuyến tự khai, mất chọn nguồn. Sửa: ô chọn + chip gợi ý của chuỗi PTG bỏ nhóm prepress (chonDuocTrongPhieu), bước cũ đã lưu vẫn hiện tên — test congDoanPhieuTinhGia.test.ts RED→GREEN, tsc sạch — cost if wrong: ai cần khai bước trước in ở phiếu phải sửa danh mục nhóm
- E2E TH2: Ruling: panel 'Giá vốn sản phẩm này' bỏ sót dòng sóng (engine gắn loai='song' từ 735c690d, FE nvlTheoLoai chỉ nhận giay/vat_tu) ⇒ báo lệch đúng bằng tiền sóng. Sửa: tách nhóm song, hiện dòng 'Sóng', cộng vào đối chiếu lệch — test nvlTheoLoai.test.ts RED→GREEN, tsc sạch — cost if wrong: không
- E2E TH8: Ruling: bảng routing (Bảng danh sách) gắn '⊘ đứt đơn vị' oan cho Cắt giấy cuộn của hộp sóng nguồn cuộn — loiDong so với dòng giấy LIỀN TRÊN theo thứ tự bảng, mà dòng đó là Tề sóng (nhánh riêng chỉ nối vào Bồi). Sửa: loiDong đi theo phu_thuoc_step_keys khi tuyến đã nối dây (xuyên qua bước ngoài dòng giấy), bảng chưa nối dây giữ luật cũ — test lsxBuoc.test.ts 'tuyến rẽ nhánh so với TIỀN NHIỆM THẬT' RED→GREEN 52/52, tsc sạch; bấm lại LSX26-0004 cột Cần xem lại sạch — cost if wrong: bảng bỏ sót đứt đơn vị ở tuyến có dây sai (máy chủ vẫn kiểm khi lưu)
- E2E TH12: Ruling: sơ đồ DAG xếp hàng chính theo chuỗi dài nhất, bước gốc nhánh phụ (Tề sóng) dời sát trước bước nó nối vào — user thấy "Tề sóng nối vào In" vì dây Tề sóng→Bồi chạy khuất sau các thẻ hàng chính — cost if wrong: chỉ là bố cục, người dùng kéo lại được, nút Sắp xếp tự động.
- E2E TH12: Ruling: Tề sóng đặt NGAY TRƯỚC bước bồi trong thứ tự (spec ghi "đầu thứ tự") — user hai lần đọc dải tên/bảng thành Tề sóng chảy vào nhánh giấy — cost if wrong: thứ tự hiển thị đổi, phụ thuộc không đổi; 3 test kỳ vọng thứ tự đã cập nhật.
- E2E TH11: Ruling: KHÔNG bấm UI — màn Bài ghép ẩn bằng cờ BAI_GHEP_ENABLED=false từ 10/09/2026 (menu + route + ma trận quyền), bật cờ để thử là mở lại màn chủ dự án đã ẩn ⇒ ngoài phạm vi; thay bằng test_bai_ghep_chuan_bi_giay 8/8 — cost if wrong: luồng bài ghép chỉ có bằng chứng test máy chủ, chưa có bằng chứng giao diện (người dùng hiện không tới được màn này).
- Final: Ruling: kg cuộn của CGC làm tròn LÊN 0,01 kg — đề nghị kho lưu Numeric(14,2), làm tròn lên để cấp đủ đề nghị là đủ nhu cầu — cost if wrong: dư tối đa 0,01 kg mỗi lệnh.
- Final: Ruling: fixture chung (_ptg_2_in hai file, _ptg_2_san_pham test_lsx_service) khai khổ nguyên 790×1090 ≠ khổ in 650×900 một mảnh ⇒ sau I2 mọc bước Tề chưa gán tổ, ~500 test xếp lịch/bài ghép/sản xuất đỏ. Đổi mặc định khổ nguyên = khổ in (lệnh In thuần, đúng ý các test viết trước khâu chuẩn bị giấy); lenh_chua_phat giữ 790×1090 cho test trọn gói — cost if wrong: các test đó không còn phủ đường có Tề (đã có test riêng ở test_lenh_chuan_bi_giay). Hệ quả thật: lệnh khổ nguyên ≠ khổ in nay luôn có Tề, công đoạn hệ thống TGI phải được gán tổ ở danh mục, không thì "sẵn sàng" báo thiếu tổ/máy (như lệnh nhiều mảnh vốn đã vậy).

## Nhật ký bấm thử e2e các ca trước (trích ledger)

- E2E TH5: đạt — PTG-2026-0006/BG26-0006/DH002 → LSX26-0005 Couche: nguồn 'Tờ đúng khổ in', 1 bước In, vật tư COUCHE-150 430×650 1.500 tờ ở In; KHVT 'Chưa giữ' 1.500 tờ.
- E2E TH6: đạt — LSX26-0006 Ivory (kho trống): nguồn 'Mua mới', Tề giấy in 500 tờ nguyên→1.000 tờ in → In; KHVT IVORY 650×860 thiếu 500 tờ 'Cần mua' (KHVT chỉ tính lệnh từ Sẵn sàng — luật cũ).
- E2E TH7: đạt — PTG-2026-0007 (ruột 64 trang tay 16 = 4 bài, Duplex 350 E2E; bìa Couche) → BG26-0007 → DH003 → LSX26-0007 ruột: nguồn Cuộn, Cắt giấy cuộn 2.000 tờ nguyên (395,85 kg cuộn 870) → Tề giấy in 4.000 tờ in → In 1.000 cuốn; LSX26-0008 bìa: Tờ đúng khổ in, COUCHE 430×650 250 tờ ở In. Ghi nhận ngoài phạm vi: danh mục chưa có bước gấp nào nhận 'tờ in' (Gạt/gấp, Gấp máy, Cắt demi đều nhận 'con') nên chuỗi In→Gấp của ruột sách bị luật cũ chặn 'đứt đơn vị' — dữ liệu danh mục, không phải lỗi nhánh.
- E2E TH8: đạt — LSX26-0004: Bảng danh sách → mở Cán màng → Loại bước 'Thuê ngoài' → Nhà gia công 'Cơ sở Gia công Cán màng Thành Công' → Xong → ghi lý do (luật cũ bắt buộc khi routing khác PTG) → Lưu công đoạn: '7 công đoạn · 1 thuê ngoài', nguồn vẫn Cuộn, Tề sóng/Cắt giấy cuộn/Tề giấy in giữ nguyên → Sẵn sàng lập kế hoạch thành công.
- E2E TH12: lỗi thật — lưu routing (replace_routing) dựng lại dòng giấy với kho_rong=0 ⇒ Cắt giấy cuộn mất rộng cuộn, 0 kg, Kế hoạch vật tư thiếu dòng Duplex cuộn. Sửa: dòng giấy giữ khổ của dòng cũ cùng mã. Test test_luu_routing_kem_vat_tu_giu_rong_cuon RED→GREEN.
- E2E TH12 đạt (sau sửa, commit da0bdc2e): đổi nguồn Tờ khổ nguyên → Cuộn 870, lưu công đoạn vẫn Duplex 870 mm 148,444 kg; Sẵn sàng → KHVT có Sóng E 1.500 tờ + Duplex 148,44 kg; Giữ hàng ⇒ Duplex "Có trong kho"; xếp lịch 26/10 14:00 trong ngăn, Phát hành ⇒ "Đã gửi kho 2 yêu cầu xuất": DNX00003 Duplex 148,44 kg (Xả cuộn 1, cần 26/10 14:00), DNX00004 Sóng E 1.500 tờ (Tổ bồi). In không có yêu cầu.
- E2E TH9 (nguồn cuộn) LỖI LOGIC, CHƯA SỬA — chờ user: đặt trọn gói xưởng cấp giấy cho LSX26-0007 (ruột, nguồn cuộn 870). Khối "Cấp giấy" chỉ đề xuất 2.000 tờ 650×860 (hết, thiếu 2.000) vì _de_xuat_giay chỉ nhận dòng tờ, rơi về quy cách phiếu; cuộn 870 tồn 5.000 kg không hiện. KHVT cùng lúc tính Duplex khổ 870 395,85 kg "Chưa giữ". Sửa = cho trọn gói cấp cuộn (kg theo rộng) — mở rộng module gia công ngoài + hộp Chọn giấy (mockup C) ⇒ hỏi user trước.
- E2E TH9: Ruling (user duyệt "như bạn đề xuất đi"): trọn gói xưởng cấp giấy được cấp CUỘN — _de_xuat_giay nhận dòng kg khổ (rộng, 0) của Cắt giấy cuộn; "Chọn giấy" liệt kê cả cuộn theo rộng (kg) lẫn tờ theo khổ, mỗi dòng mang don_vi; de_nghi_xuat_giay kho_dai=0 ⇒ dòng dvt kg; ô số kg nhận phần lẻ. Giữ bố cục hộp đã chốt (mockup C), không dựng 3 phương án — cost if wrong: chỉ thêm dòng cuộn vào danh sách, tờ không đổi. Kèm: 3 test cũ của test_gia_cong_tron_goi đỏ sẵn trên nhánh (lệnh mẫu nay mang giấy ở bước) ⇒ thêm _bo_giay_buoc để chúng thử đúng đường "lệnh cũ chưa khai giấy".
- E2E TH9 (nguồn cuộn) đạt: test_gia_cong_tron_goi 45/45 (2 test mới RED→GREEN), 6 file liên quan 36/36, giaCong.test 27/27, tsc sạch. UI LSX26-0007: Chọn giấy → "Lệnh cần 395,85 kg cuộn rộng 870 mm", dòng "cuộn rộng 870 mm, đúng lệnh, 5.000 kg tồn", ô "Số kg xin xuất" 395,85; gõ 400,5 nhận đúng; gõ lại 395,85 → Gửi ⇒ DNX00005 Chờ kho soạn, ô Giấy "cuộn rộng 870 mm 395,85 kg"; KHVT Duplex khổ 870 395,85 kg; DNX00005 Duplex 350 E2E khổ 870 mm LSX26-0007 395,85 kg.
- E2E TH9 (nhánh tờ) đạt: LSX26-0006 (Tờ rơi Ivory, nguồn Mua mới, Tề giấy in 500 tờ nguyên) → Gia công trọn gói → chọn Xưởng Gia công Bế hộp Minh Phát, 4.000, giữ tick Xưởng cấp giấy → Đặt ⇒ Đã phát hành; Chọn giấy ⇒ "Lệnh cần 500 tờ khổ 650 × 860 mm", dòng 650 × 860 đúng lệnh, hết, ô "Số tờ xin xuất" 500, cảnh báo thiếu 500 tờ → Gửi ⇒ DNX00006, ô Giấy "khổ 650 × 860 mm"; KHVT Ivory 650×860 500 tờ Cần mua. Sửa chữ hộp đặt trọn gói "chọn khổ và số tờ" → "chọn khổ và số lượng" (cuộn xin kg).
- E2E TH10 đạt: LSX26-0005 trước đặt có KHVT COUCHE 430×650 1.500 tờ → Gia công trọn gói → Công ty CP Giấy Việt Trì, bỏ tick Xưởng cấp giấy (chữ đổi "Nhà gia công tự lo giấy — kho không xuất gì") → Đặt ⇒ ô Giấy "Nhà gia công tự lo", chip "Không vướng gì"; KHVT không còn dòng nào của LSX26-0005. Sau đó Huỷ gia công (lý do "Thử ghép bài với bìa") ⇒ về Nháp.
- E2E TH13: YCMH Ivory 650×860 → DMH-261024-XZA2 (cột Khổ đặt + Định lượng 300 riêng) → duyệt ở Kế toán → Ghi đợt giao (khổ, định lượng điền sẵn) → tự tạo DNN00004. Đạt.
- E2E TH14: phiếu nhập DNN00004 84 kg → 500 tờ; lỗi ô "Vào tồn" nhân hệ số đã làm tròn (0,1 kg → 0,595 tờ, 50 kg → 297,6) — sửa 5f247942 (máy chủ trả kg_moi_dvt + gsm, FE toTuKg theo khổ thực nhận); 0,1 kg bị chặn "0,1 kg khổ 650×860 quy ra 0 tờ"; 84 kg ghi sổ PNK00004 lô 500 tờ.
- E2E TH15: tồn tờ có Quy kg 83,85 + Định lượng, cuộn trống Quy kg; xuất DNX00003 (148,44 kg lô cuộn PNK00002), DNX00006 (500 tờ PNK00004), DNX00005 (395,85 kg) đúng lô, tồn trừ đúng; DNX00004 Sóng E báo hết tồn. Lỗi: "Sắp xuất" treo 0,004 kg vì nhu cầu CGC nhiều số lẻ — sửa commit kế.
- E2E TH16: PTG-2026-0005 giấy Duplex 2.641.275 + sóng E 1.509.300 = 4.150.575 (kiểm tay khớp diễn giải); BG26-0005 giữ cả hai vật tư, giá vốn khóa 4.150.575, markup 20% → 4.980.690, VAT 498.069. Đạt.
- E2E bổ sung 25/10 (use case đa trường hợp, plan e2e mục "Bổ sung 25/10"):
- BC2 NXT: mỗi dòng khổ+đơn vị đầu+nhập−xuất=cuối; Duplex cuộn hiện "—" ở cột Khổ ⇒ sửa (KhoBaoCaoPage: chỉ cần kho_rong).
- BC1 Chi tiết phiếu: đúng đơn vị gốc từng phiếu; thành tiền dòng nhập lệch NXT (PNK00004 2.587.000 vs 2.587.200) ⇒ sửa: tiền nhập = đơn giá × số lượng gõ (test_so_dong_nhap_kg_quy_to_thanh_tien_khop_nxt RED→GREEN). Dòng xuất vẫn theo giá lô nguyên đồng (minor đã hoãn).
- K6/BC4 điều chuyển: KHÔNG ÁP DỤNG — FE tắt có chủ đích (khoShared.AN_DIEU_CHUYEN = true).
- K7 nhập DNN00006 màng 100 m² × 5.000 vào kho vật tư (không cột định lượng/khổ, không quy đổi); xuất 30 m² lô PNK00006 giá vốn 150.000.
- K5: DNX00004 sóng E "Hết tồn, kho chỉ còn 0 tờ"; DNX00007 IVORY 1.000 tờ tồn 605 ⇒ cấp 605 bắt "Lý do cấp thiếu 395 tờ" ⇒ "Đã cấp một phần", "Lập phiếu tiếp".
- K4 LỖI ⇒ sửa: đề nghị xuất COUCHE 20 kg khổ 430×650 báo Tồn 0/Thiếu 20 kg, phiếu "Kho chỉ còn 0 kg" dù 3.000 tờ.
- K1: giấy chốt cứng tờ+kg ở danh mục, nhưng form yêu cầu vẫn liệt kê "ram = 500 tờ" (họ tờ) ⇒ còn bấm được.
- K1 nhập ram: DNN00007 IVORY 650×860 2 ram × 1.000.000 → phiếu "Vào tồn 1.000 tờ (1 ram = 500 tờ)" → PNK00007 lô 1.000 tờ 2.000 đ/tờ. Đạt.
- MH LỖI ⇒ sửa: đợt giao đơn có dòng giấy CUỘN (khổ đặt chỉ rộng) bị chặn "Khổ nhận của giấy tờ cần đủ hai cạnh" (DeliveryDialog từ f1377161 của nhánh). Sửa: khoNhanThieuCanh chỉ chặn khi khổ đặt hai cạnh mà nhận thiếu, hoặc có dài không rộng; helpers.test "khoNhanThieuCanh" RED→GREEN 16/16, tsc sạch.
- MH3/MH4/MH5/MH6: YCMH-261025-F71A (Couche 650×860 2.000 tờ, Duplex khổ 860 300 kg, Màng 50 m²) → DMH-261025-SOBG An Phát (Couche 168 kg × 24.400, Duplex 300 kg × 17.200) + DMH-261025-JHT5 Đông Á → duyệt → đặt hàng → đợt 1 (Couche 100 kg + Duplex 300 kg, 8.208.000) → đợt 2 (Couche 68 kg khổ 640×860, cảnh báo "Khác khổ đặt") → DNN00008/00009 tự tạo → PNK00008 lô 1.192 tờ 650×860 + lô cuộn 300 kg 860×0, PNK00009 lô 823 tờ 640×860; màng DNN00010 → PNK00010 50 m² kho vật tư. Đạt. Ghi nhận: đơn mua dòng tờ đổi NCC bán kg thì ô số kg để trống, không tự quy tờ→kg (đề xuất, không phải lỗi). MH1 thiếu NCC khai bán Couche theo tờ.
- E2E MH1: đạt — YCMH-261025-3OEW DUPLEX 230 790×1090 1.000 tờ → DMH-261025-E2YO Giấy Việt Trì 2.500 đ/tờ VAT 8% = 2.700.000 → gửi duyệt → KT duyệt → đã đặt hàng → đợt 1 đủ → DNN00011 → phiếu nhập Kho giấy, lô LOT-DUPLEX-230-261025-01 1.000 tờ 790×1090 don_vi_goc=to 2.500 đ. Ghi nhận: sau "Gửi yêu cầu" danh sách Từng món chưa hiện dòng mới tới khi tải lại trang (gặp một lần, code đã gọi mon.nap(); nhánh này không đụng logic nạp lại) → follow-up.
- BH2: đã phủ bởi TH5 (tờ rơi Couche không sóng, PTG-2026-0006/BG26-0006) + TH7 (sách ruột Duplex + bìa Couche, PTG-2026-0007/BG26-0007) — không bấm lại.
- BH3: PTG-2026-0005 → Nhân bản → PTG-2026-0008 giữ Duplex 350 E2E 2.641.275 + Giấy sóng E 1.509.300 = 4.150.575 → Báo giá → BG26-0008 v1 Nháp, mô tả liệt kê cả hai giấy, giá vốn khoá 4.150.575. Đạt.
- BH4 (lượt đầu, sau đã bấm đủ, xem mục chuỗi trọn gói): KHÔNG bấm UI — DB clone không có lô thành phẩm nào trong KHO-TP (stock_lots chỉ giay/vat_tu), muốn có phải chạy trọn một lệnh tới nhập TP; nhánh không đổi code giao hàng/kho TP (SuaChuaMayPage đổi do merge dev). Thay bằng pytest 6 file giao hàng + kho TP + nhập TP 97/97.
- SC1: Sửa chữa máy mở danh sách 8 phiếu chờ sửa, mở SC-0012 (chi tiết, ảnh trước/sau, nút xác nhận), tab Yêu cầu báo hỏng — không lỗi.
- TS1: Tài sản & CCDC → tab Khấu hao từng tháng: tháng 10/2026 tổng 77.818.479 đ, 19 tài sản; mở TS-0001 hiện lịch khấu hao theo năm + lịch sử — không lỗi.
- BC1/BC2 lặp lại sau phiếu mới: NXT có PNK00008–00011 đúng khổ + đơn vị (Couche 640×860 823 tờ 1.659.200, 650×860 1.192 tờ 2.440.000, Duplex 230 1.000 tờ 2.500.000, Duplex 300 cuộn 300 kg 5.160.000, màng 150 m² 580.000); mọi dòng đầu+nhập−xuất=cuối.
- BC3: Kỳ kế toán → Khoá/mở kỳ → khoá toàn kho 01/10–25/10/2026 "Ky thang 10/2026 E2E" → Tính giá → "Đã chốt giá", giá trị cuối kỳ 97.502.513 = nhập 112.406.400 − xuất 14.903.887; Ivory 650×860 BQ 3.058: xuất 1.529.067 + cuối 3.058.133 = 4.587.200 (không rò làm tròn). Đạt.

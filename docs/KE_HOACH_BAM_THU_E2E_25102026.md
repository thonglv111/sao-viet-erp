# Kế hoạch bấm thử end-to-end và tình huống biên — bản 25/10/2026

Kế hoạch này nối tiếp `KE_HOACH_BAM_THU_TINH_GIA_DEN_GIAO_HANG.md` (18/10, mục A–P). Nó bao trọn code
dev đến commit `05768728`: hơn 110 commit sau 18/10, gồm cả nhánh khâu chuẩn bị giấy đã merge (kể cả 3 commit sửa
sau duyệt 581bf1f8, 5ea5c31d, b2c0d64a). Báo cáo bấm thử của nhánh đó: `superpowers/reports/2026-10-25-chuan-bi-giay-bao-cao.md`.

Bản cũ vẫn là xương sống luồng tính giá → giao hàng → hoá đơn. Bản này làm bốn việc:

1. Đánh dấu những ca cũ nay đã đổi hành vi (mục 1).
2. Thêm 11 mảng mới, mỗi ca kèm câu báo lỗi chép từ code (mục 3–13).
3. Thêm đối chiếu chéo giữa các module, và các ca ngang về tức thời, quyền, đua, ranh giới ngày, điện thoại (mục 14–15).
4. Gom 57 chỗ nghi lỗi đọc được từ code thành một bảng, mỗi chỗ trỏ tới ca sẽ xác nhận nó (mục 16).

Tình huống TH1–TH16 trong `superpowers/plans/2026-10-24-chuan-bi-giay-e2e-ui.md` vẫn chạy nguyên, ở đây
không lặp lại.

Cách đọc từng ca:
- **Ký hiệu cột "Loại":** **C** = luồng chính, **R** = nhánh rẽ, **X** = hệ thống phải chặn.
- **Chữ trong ngoặc kép:** nhãn nút hoặc câu báo chép từ code. Phần ghép từ biến (mã, ngày, số) phải
  khớp lại khi bấm thật.
- **Cột "Code":** tên file và dòng do agent đọc tại `9d6a90b9`; sau 5ea5c31d có thể lệch vài dòng ở
  chuan_bi_giay.py, lsx_service.py, giaCong.ts — tìm bằng tên file.
- **Ca "gọi API":** chỉ để chứng minh máy chủ chặn khi giao diện đã khoá. Phải ghi rõ là đi tắt.

---

## 0. Cách chạy

### Môi trường và nguyên tắc

- **Môi trường:** bản sao DB `svn_erp_e2e`, chép từ `svn_erp_trong` sau khi migration của `05768728` đã
  chạy. Redis riêng ở cổng 6392, backend 8010, frontend 5174, `SEED_DEMO=false`. Không đụng DB dev và
  server dev 8000/5173. Xong thì tắt server thử, xoá Redis riêng, xoá bản sao.
- **Trình duyệt:** tối đa 5 cùng lúc. Mở đợt mới thì tắt bản cũ.
- **Thao tác:** bấm chuột và gõ phím thật. Không gọi API thay bước nào, kể cả để dựng dữ liệu. Ca nào buộc
  phải đi tắt thì ghi ngay tại ca đó kèm lý do. Mọi ca "gọi API" trong bảng đều là loại này.
- **Ảnh, GPS, hai vai:** giữ cách ở mục 0 bản cũ:
  - Tệp ảnh: tải bằng Playwright.
  - GPS: ghi đè `navigator.geolocation`.
  - Hai vai: một tab ứng dụng cộng một Playwright, để kiểm badge và toast tới đúng người, không tải lại trang.
- **Ghi kết quả:** theo mã ca, mỗi ca một trong ba kết quả: Đạt / Lỗi (mô tả) / Không làm được trên giao diện (lý do).
  - Ca chặn: chép nguyên câu báo.
  - Ca nghi lỗi (mục 16): ghi "Xác nhận lỗi" hoặc "Không tái hiện".
- **Lỗi chặn luồng:** dừng, tìm nguyên nhân, báo trước khi sửa code.

### Giới hạn đã biết của giao diện

- **Bài ghép đang ẩn** bằng cờ `BAI_GHEP_ENABLED = false` (từ 10/09/2026). Các ca GS48–GS53, VT05, VT23 và
  phần bài ghép của VT24 ghi "Không làm được trên giao diện", trừ khi bật cờ trên bản sao. Bật cờ là đổi code
  thử, phải ghi rõ.
- **Điều chuyển kho tắt** có chủ đích (`AN_DIEU_CHUYEN = true`), không kiểm.
- **Công đoạn hệ thống Tề giấy in phải gán tổ** ở danh mục trước khi lập lệnh. Từ 5ea5c31d, lệnh có khổ
  nguyên khác khổ in luôn có Tề; TGI chưa gán tổ thì "Sẵn sàng" báo thiếu tổ/máy.

### Ngày giờ

Không chỉnh đồng hồ máy. Ca cần mốc thời gian thì dùng ngày quá khứ trên chứng từ.

- **Ranh giới tháng:** dùng 30/09 → 01/10, tức kỳ T09 sang T10. Hôm nay là 25/10, nên các mốc cuối tháng 10
  còn ở tương lai.
- **Ca cần 45–76 ngày** (hoa hồng): lùi ngày hoá đơn và ngày phiếu thu. Ô ngày không cho lùi thì ghi
  "Không làm được".
- **Ca "kỳ đã chốt":** chốt T09 trên bản sao, chạy SAU khi đã ghi đủ dữ liệu T09 (xem thứ tự ở mục 2).

### Vai thử

Tạo tài khoản ở bước A3 cũ, đủ các vai sau:

| Vai | Ghi chú |
|---|---|
| Sale CTV | có biểu hoa hồng |
| GĐ Kinh doanh | duyệt đặc thù |
| Kế hoạch | |
| Thủ kho | |
| Tổ trưởng In | có "Xác nhận sản lượng" |
| Thợ In | "Của tôi" |
| Tổ trưởng Cắt | |
| Tổ sửa chữa | |
| Người chỉ có Báo hỏng | `ky_thuat_may:request` + Xem tổ |
| Kế toán | đủ quyền |
| Kế toán chỉ xem | |
| Kế toán phạm vi tổ | xem/sửa Khoán theo tổ một tổ |
| Mua hàng | không có ô "Ghi đợt giao" |
| Vai Tính giá | tắt "Xem chi tiết giá vốn" |

### Bộ dữ liệu E2E (dựng qua giao diện)

| Mã | Dựng thế nào | Dùng ở |
|---|---|---|
| Giấy E2E-DUP350 | Giấy, 350 gsm, khổ 650×860. 1 tờ = 0,19565 kg; cuộn 870 cắt 650 = 0,197925 kg/tờ | GS, VT, mua hàng |
| Sóng E2E-SONGE | Loại Sóng, đơn vị tờ (sau đổi kg) | GS-B, GS-G |
| Khách E2E-KE | "Thuế TNDN trên kê" 20%, "Kê cho phép" 0–10%, Chiết khấu tối đa 5% | BG, CO, HD, HH |
| Báo giá E2E-KE | 1 dòng, 1.000 cái. "Giá bán" gõ tay 10.000.000. CK % 5 (= 500.000). Kê "Số" 1.000.000. VAT 8% | |
| Đơn E2E-KE | Từ báo giá trên. Giá bán sau kê 11.000.000, gồm VAT 11.880.000. Cọc 30% = 3.564.000. Giao 2 lượt 400 + 600 | |
| Sale E2E | Biểu CTV: đến 45 ngày 3%, trên 45 đến 60 ngày 2%, trên 60 đến 75 ngày 1%, trên 75 ngày 0% | HH |
| LSX-A | Nguồn Cuộn 870. Chuỗi In → Cán → Bế → Dán. Giấy E2E-DUP350 | VT, MT, SL, DM, KH |
| LSX-B | Nguồn Tờ khổ nguyên. Có sóng + Bồi TĐ | GS |
| LSX-C | Ghép bài với LSX-A | GS-E |
| LSX-D | Gia công trọn gói, xưởng cấp giấy | GS-G |
| LSX-E | Lệnh riêng để thu hồi phát hành | VT-T |
| LSX-F | Không có bước In (Bế + Dán, có giấy) | GS-C |
| Tổ X, Tổ Y | Tổ SX có chỉ tiêu ngày 1.500.000, tổ trưởng ăn chia 10%. Ba thợ: A L=8tr, B L=6tr, C L=6tr | KH |

---

## 1. Ca của bản 18/10 nay đã đổi hành vi

Khi chạy lại bản cũ, theo cột "Nay phải thấy" thay cho cột "Phải thấy" cũ.

| Ca cũ | Nay phải thấy | Code |
|---|---|---|
| C8 | Ô "Chiết khấu" có hai tab "%"/"Số". % nay tính trên giá bán trước kê, không còn tính trên giá vốn. Báo giá cũ khi tính lại tự suy % = CK cũ ÷ giá bán cũ | quotation_service.py:340-347 |
| C10 | Có thêm rào kê và rào CK, soi từng sản phẩm (BG10–BG12) | exception_gate.py:126-154 |
| C16, C17 | Bản in theo giá bán sau kê. Dòng đơn chép cả CK và kê | BaoGiaPage.tsx:2191 |
| C19 | Ô "% cọc" nay là "Cọc phải thu" hai tab (CO01–CO06) | DonHangBanPage.tsx:1056 |
| C21 | Thu cọc ở lối gộp chặn thu dư, lối lẻ không chặn (CO07; P7 vẫn còn) | LapPhieuThuGop.tsx:138 |
| E11, E13 | "Lưu đợt giao" tạo luôn yêu cầu nhập. Nút "Gửi kho" chỉ còn khi kho huỷ/từ chối, hoặc dòng chưa có mã. Ghi đợt cần thêm ô quyền "Ghi đợt giao" | purchase_service.py:3600-3616 |
| E15 | Thêm khoá "Kho đã lập phiếu, khoá sửa" | NganDonMua.tsx:791 |
| F4 | Tổ Cắt không còn nhận "chờ chốt giấy". Người phát hành thấy "Đã phát hành xuống xưởng. Đã gửi kho N yêu cầu xuất."; thủ kho nhận chuông + toast "🔔 LSX…: N yêu cầu xuất mới chờ lập phiếu" | cauBaoPhatHanh.ts:6-14 |
| F5 | Thu hồi huỷ luôn các yêu cầu xuất mà kho chưa ghi sổ (VT19–VT23) | release_update.py:483 |
| G1, G2 | Lần đầu không bấm "Yêu cầu cấp vật tư" nữa vì đã tự lập. Bấm thì ra "Đang có đề nghị chưa được kho lập phiếu — hãy sửa đề nghị đó thay vì tạo lần mới." | vat_tu_de_nghi.py:490 |
| G3 | BỎ. Không còn khâu tổ Cắt chốt giấy; giấy nằm ở bước nào thì bước đó tự lập yêu cầu | commit adb732c1 |
| G4, G5 | Thêm cổng vật tư: phải "Sẵn sàng" mới "Bắt đầu". Thứ tự chặn: thợ → người nghỉ → bước ghép → vật tư → đầu vào → máy dừng → khuôn | thuc_thi.py:270-313 |
| G6, G9, G10 | Ghi sản lượng xong thì tự đề xuất giao khi chỉ có một chặng sau. "Đề xuất giao" tay chỉ còn khi có nhiều chặng sau, nên G10 phải dựng lệnh nhiều chặng sau | san_luong.py:360-395 |
| G11 | "Đổi máy" chỉ liệt kê máy của tổ | thuc_thi.py:489-513 |
| G12 | Mục "⋯ → Báo sự cố" đã gỡ. Thay bằng nút "Báo dừng máy" trên thanh bàn tổ (DM01) | ThucHienSxPage.tsx:861 |
| L1 | Hoá đơn mang CK, kê và thuế TNDN trên kê (HD01) | chi_ck_ke.py:32-44 |
| L5 | Huỷ hoá đơn bị chặn nếu đã chi CK/kê. Hoá đơn điều chỉnh giảm đã gỡ hẳn (c119ec6b): muốn giảm thì Huỷ rồi ghi lại | accounting_service.py:2142 |
| M7 | Cột "Khoán SP" lấy từ khoán kỳ (KH40). Cột Hoa hồng tính theo tiền thu (HH03) | payroll_service.py:2240-2250 |
| N6 | Khoá sổ công nợ nay chặn lập/huỷ chứng từ trong kỳ (HD18), trừ phiếu chi CK/kê (HD19) | cong_no_khoa_ky.py:94 |
| O1, O4 | Báo cáo kinh doanh thêm 6 cột: "Chiết khấu phải chi", "Chiết khấu đã chi", "Tiền kê", "Thuế TNDN trên kê", "Kê phải chi", "Kê đã chi". Báo cáo thu chi thêm mục chi CK và chi kê | |

Tình trạng lỗ P1–P10 của bản cũ:

| Lỗ | Tình trạng | Ghi chú |
|---|---|---|
| P1 | Đã sửa | Còn lọt phiếu chi CK/kê (HD19) |
| P2, P3, P4, P5 | Đã sửa | Bấm lại để xác nhận |
| P6 | Đã sửa | Có lỗ mới: gõ 0 ở tab "Số" không xoá % cọc cũ (CO04) |
| P7 | **Còn** | Lối lẻ cho thu dư cọc, lối gộp chặn (CO07) |
| P8 | Đã sửa câu chữ | |
| P9 | Đã sửa | Kiểm lại bằng KH40 |
| P10 | Đã sửa | |

---

## 2. Thứ tự chạy

| Bước | Phần | Nội dung |
|---|---|---|
| 1 | A cũ | Vai, phân quyền, dựng bộ dữ liệu E2E |
| 2 | B cũ + GS01–GS11 | Danh mục: công đoạn hệ thống, giấy/sóng, đơn vị |
| 3 | C cũ (đã sửa theo mục 1) + GS12–GS17 + BG | Phiếu tính giá, báo giá, chiết khấu, kê |
| 4 | CO | Đơn bán và cọc |
| 5 | D cũ + GS18–GS32 + GS33–GS47 + GS48–GS53 | Lập lệnh, máy chọn nguồn, đổi nguồn, bài ghép |
| 6 | E cũ + MH + GS54–GS58 | Mua giấy, nhập kho kg/tờ |
| 7 | F cũ + VT01–VT10 | Xếp lịch, phát hành tự lập yêu cầu xuất |
| 8 | VT11–VT18, VT24–VT26 | Kho xuất, lọc kho, cổng Bắt đầu |
| 9 | G cũ (đã sửa) + MT + SL + DM, rồi H cũ | Bàn tổ, máy thuộc tổ, ghi sản lượng, dừng máy; sau đó kỹ thuật máy |
| 10 | VT19–VT23 trên LSX-E | Thu hồi phát hành. Chạy song song bước 9 được, vì là lệnh riêng |
| 11 | I, J, K cũ + GS59–GS65 | KCS, kho thành phẩm, giao hàng, gia công trọn gói |
| 12 | L cũ + HD | Hoá đơn theo lượt, thu tiền, chi CK/kê |
| 13 | LU + KH + HH | Chuyển về thử việc, khoán, Khoán theo tổ, điều chỉnh lương, hoa hồng → "Tính lại" bảng lương |
| 14 | — | Chốt kỳ T09 (và T10 nếu cần), rồi chạy các ca "kỳ đã chốt": KH54, DM12, HH08, HH09, HD18, HD19, và NG03 (NL-KH03) |
| 15 | O cũ + OO | Đối chiếu chéo |
| 16 | RT, QN, DUA, NG, DT | Các ca ngang còn lại |

Báo kết quả sau mỗi bước.

---

## 3. GS — Giấy/sóng và khâu chuẩn bị giấy

### 3.1 Danh mục

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| GS01 | X | Đổi tên công đoạn hệ thống qua Excel | Danh mục Công đoạn → Nhập Excel, dòng TGI đổi tên | "Công đoạn hệ thống «Tề giấy in»: không đổi tên." | cong_doan_service.py:256 |
| GS02 | X | Ngừng dùng công đoạn hệ thống | Tick "Cắt giấy cuộn" → Ngừng dùng (công tắc và thao tác hàng loạt) | "Công đoạn hệ thống «Cắt giấy cuộn»: không ngừng dùng được." | cong_doan_service.py:259,265 |
| GS03 | X | Xoá công đoạn hệ thống | Nút Xóa đã ẩn; thử bằng hộp xoá hàng loạt hoặc gọi API | "Không xóa được — đang dùng: công đoạn của hệ thống." | catalog_base.py:107,260 |
| GS04 | R | Nhân bản Tề giấy in | "Nhân bản" trên hàng TGI | Bản sao có mã mới, không ổ khoá, đổi tên được. Lập lệnh vẫn chỉ chèn TGI gốc | catalog_base.py:271 |
| GS05 | X | Xoá đơn vị tờ / kg | Danh mục Đơn vị → Xóa "tờ" | "Không xóa được — đang dùng: tờ và kg là đơn vị bắt buộc của giấy." | don_vi_do_service.py:122 |
| GS06 | X | Giấy nhập Excel ĐVT ram | Nhập Excel, ĐVT = ram | "Giấy chỉ có hai đơn vị Tờ và Kg — ĐVT chính chọn một trong hai, không dùng “Ram”." | vat_lieu_kho_service.py:262 |
| GS07 | X | Giấy nhập Excel thêm đơn vị tấn | don_vi_them = tấn | "Giấy chỉ có hai đơn vị Tờ và Kg — không thêm “Tấn”." | vat_lieu_kho_service.py:267 |
| GS08 | C | Thêm giấy mới | Thêm → Loại Giấy, Định lượng 350 → Lưu | Form không còn ô ĐVT. Cột ĐVT hiện kg kèm thẻ tờ. Ô Đơn giá gợi ý "Giá một kg…" | rebuildCatalogConfigs.tsx:653 |
| GS09 | X | Định lượng 0 hoặc âm | Định lượng (g/m²) = 0 → Lưu | "GSM phải > 0." | vat_lieu_kho_service.py:162 |
| GS10 | R | Đổi Loại Giấy → Sóng của mã đang dùng | Sửa mã → Loại = Sóng; mở phiếu dùng mã đó → Lưu | "Sản phẩm «…»: «…» là sóng, chọn ở ô Sóng." (danh mục không chặn, xem NL-GS15) | ptg_giay_buoc.py:119 |
| GS11 | R | Ngừng dùng giấy đang chọn ở phiếu | Ngừng dùng → mở lại phiếu | Ô Giấy hiện "Tên (ngừng dùng)". Mã không còn trong danh sách mời | OGiaySong.tsx:18-25 |

### 3.2 Phiếu tính giá

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| GS12 | R | Không mời khâu chuẩn bị | Thêm công đoạn cho sản phẩm | Danh sách không có Cắt giấy cuộn / Tề giấy in / Tề sóng. Gợi ý nhanh chỉ In và sau in | congDoanPhieuTinhGia.ts:5-7 |
| GS13 | X | Có sóng, chuỗi không có bồi | Sóng = E2E-SONGE, chuỗi In → Cán → Lưu | "Sản phẩm có sóng nhưng chuỗi chưa có bước bồi." | ptg_giay_buoc.py:123 |
| GS14 | R | Có sóng, không có giấy | Giấy "— Chọn giấy —", Sóng có, có Bồi TĐ → Lưu → lập lệnh | Lưu được, chỉ có tiền Sóng. Lệnh không có Nguồn giấy, không có TGI (xem NL-GS06) | lsx_service.py:2378 |
| GS15 | R | Giá sóng theo tờ và theo kg | Sóng ĐVT tờ, rồi đổi kg | Theo tờ: đơn giá × số tờ. Theo kg: gsm × khổ in × đơn giá × số tờ. Số tờ = SL vào của bước bồi đầu | thanh_phan_engine.py:883-898 |
| GS16 | R | Khổ nguyên có phần lẻ | Dài nguyên 860, Rộng 650,5 | Ô nhận phần lẻ. Sang lệnh, xem dòng giấy ở TGI ra 650 hay 651 (NL-GS09) | lsx_service.py:2381 |
| GS17 | R | Khổ nguyên = khổ in, kho trống | Khổ nguyên = khổ in = 650×430 → lập lệnh | Nguồn = Mua mới, không có TGI, giấy gắn ở In | chuan_bi_giay.py:45-47 |

### 3.3 Lập lệnh — máy chọn nguồn

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| GS18 | R | Biên tồn tờ khổ in | Tồn tờ 650×430 đúng bằng SL vào In; lần sau thiếu 1 tờ | Bằng thì chọn "Tờ đúng khổ in"; thiếu 1 tờ thì chuyển sang nguồn sau | chuan_bi_giay.py:85 |
| GS19 | R | Tờ khổ nguyên vừa đủ, chưa tính hao Tề | Tồn 650×860 = ceil(tờ in ÷ mảnh xả) | Chọn Tờ khổ nguyên, nhưng Kế hoạch vật tư báo thiếu đúng số tờ hao Tề (NL-GS07) | chuan_bi_giay.py:50,89 |
| GS20 | R | Biên rộng cuộn | Tồn cuộn 890 rồi 891; tồn cả 660 và 870 | 890 được (860+30), 891 bị bỏ qua. Có cả hai cuộn thì chọn 660 (hẹp nhất), cạnh còn lại 860 | chuan_bi_giay.py:18,54-57 |
| GS21 | R | Cuộn thiếu 0,01 kg | Tồn kg cuộn 870 nhỏ hơn nhu cầu 0,01 | Bỏ qua cuộn, chọn Mua mới | chuan_bi_giay.py:93 |
| GS22 | R | Có cả tờ khổ nguyên và cuộn | Nhập cả hai loại đủ tồn | Ưu tiên Tờ khổ nguyên | chuan_bi_giay.py:89-94 |
| GS23 | R | Lệnh A giữ chỗ hết cuộn | Giữ chỗ cho A → lập B cùng giấy | B chọn Mua mới (so tồn tự do) | lsx_service.py:2395 |
| GS24 | X | Thiếu khổ nguyên | Phiếu bỏ trống Dài nguyên → lập lệnh → "Sẵn sàng" | Chip "Thiếu khổ nguyên của giấy"; "Còn thiếu dữ liệu — bổ sung xong mới đánh dấu sẵn sàng" | lsx_service.py:1846,4007 |
| GS25 | R | Phiếu cũ có Cắt tờ trước In | Báo giá → đơn → lệnh từ phiếu cũ | Không chèn CGC/TGI. Ô Nguồn giấy "Chưa chọn". Giấy ở bước Cắt tờ | lsx_service.py:2443 |
| GS26 | R | Lệnh không có bước In (LSX-F) | Lập lệnh → tab Vật tư, Kế hoạch vật tư → chọn Nguồn giấy | Giấy nằm ở bước ĐẦU của lệnh (đã sửa 5ea5c31d, NL-GS05); Kế hoạch vật tư có nhu cầu giấy. Chọn nguồn: "Lệnh chưa có giấy hoặc chưa có bước In — không có gì để đổi nguồn." | lsx_service.py |
| GS27 | R | Hai bước nhóm In | In offset + In UV | Khâu chuẩn bị chèn trước bước In ĐẦU | lsx_service.py:2371 |
| GS28 | X | Bỏ bồi khi có Tề sóng | Routing xoá Bồi TĐ → Lưu | "Tề sóng cần bước bồi — giữ một bước bồi nối từ Tề sóng, hoặc bỏ luôn Tề sóng." | lsx_service.py:3902 |
| GS29 | X | Giấy thứ hai | Ngăn bước In → thêm mã giấy khác → Lưu | "Lệnh «LSX…» đang có 2 giấy: A, B. Mỗi lệnh chỉ một giấy." | ptg_giay_buoc.py:66 |
| GS30 | R | Thêm lại đúng mã giấy ở In | CGC đã mang giấy → In thêm E2E-DUP350 → Lưu | Không chặn. Kiểm Kế hoạch vật tư có cộng đôi nhu cầu không | ptg_giay_buoc.py:62 |
| GS31 | R | Xoá tay CGC / TGI | Routing xoá CGC → Lưu | Lưu được, mất dòng giấy, Nguồn giấy vẫn ghi Cuộn (NL-GS14) | lsx_service.py:3511 |
| GS32 | R | Danh mục đổi gsm sau lập lệnh | Lệnh Cuộn → danh mục gsm 350→300 → Lưu routing lệnh | Kg ở CGC tính lại theo gsm mới; số tờ TGI không đổi | lsx_service.py:2380,2585 |

### 3.4 Đổi nguồn giấy

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| GS33 | X | Lệnh đang giữ chỗ | Rê chuột ô Nguồn giấy | Ô xám, chú thích "Lệnh đang giữ chỗ vật tư — nhả chỗ ở màn Kế hoạch vật tư trước khi đổi nguồn giấy" | LsxDetailView.tsx:1646 |
| GS34 | X | Routing đang sửa dở | Sửa bước chưa Lưu → ô Nguồn giấy | "Lưu hoặc huỷ thay đổi routing trước khi đổi nguồn giấy" | LsxDetailView.tsx:1647 |
| GS35 | X | Lệnh Đã lập kế hoạch | Nguồn giấy → Tờ khổ nguyên | Băng đỏ "Lệnh đã lập kế hoạch — gỡ kế hoạch trước khi đổi nguồn giấy"; ô trở về nguồn cũ | lsx_service.py:2529 |
| GS36 | X | Lệnh Đã phát hành, giữ chỗ tắt | Phát hành không giữ chỗ → đổi Cuộn → Tờ khổ nguyên | PHẢI chặn. Code hiện cho qua và gỡ CGC đã có yêu cầu xuất (NL-GS01) | lsx_service.py:3360 |
| GS37 | X | Kho đã xuất cho CGC / bàn tổ đã bắt đầu CGC | Xuất kho hoặc "Bắt đầu" → đổi nguồn | PHẢI chặn. Hiện không có cổng nào (NL-GS01) | |
| GS38 | X | Lệnh trọn gói (nhà gia công tự lo giấy) / Đã đóng | Đổi nguồn | PHẢI chặn. Hiện cho qua, và lệnh thiếu dữ liệu bị kéo về "Chờ bổ sung" (NL-GS01) | tron_goi.py:164 |
| GS39 | X | Không có quyền sửa lệnh | Vai thiếu san_xuat.update → mở lệnh | Ô xám "Bạn không có quyền sửa lệnh"; gọi API ra 403 | LsxDetailView.tsx:1644 |
| GS40 | X | Rộng cuộn có phần lẻ | Cuộn → gõ "870,5" → Áp dụng | Ô nuốt dấu phẩy thành 8705, rồi báo "Rộng cuộn phải bằng một cạnh khổ nguyên (650 hoặc 860 mm), dư tối đa 30 mm." (NL-GS11) | ONguonGiay.tsx:77 |
| GS41 | X | Rộng cuộn trống / 0 | Chọn Cuộn, bỏ trống ô | Nút Áp dụng mờ | ONguonGiay.tsx:84 |
| GS42 | R | Đổi Cuộn 870 → 880 | Chọn lại Cuộn | Không hiện ô Rộng cuộn; phải qua nguồn khác rồi về Cuộn (NL-GS11) | ONguonGiay.tsx:55 |
| GS43 | X | Thiếu khổ nguyên chọn Cuộn | Cuộn + 870 → Áp dụng | "Lệnh thiếu khổ nguyên — chưa dựng được Cắt giấy cuộn theo rộng cuộn." | lsx_service.py:2540 |
| GS44 | R | Thiếu khổ nguyên chọn Tờ khổ nguyên | Chọn Tờ khổ nguyên | Không chặn, không có TGI. Giấy ở In theo khổ in, nhãn vẫn "Tờ khổ nguyên" | chuan_bi_giay.py:100-120 |
| GS45 | R | Đổi Tờ khổ nguyên ↔ Mua mới | Gán tổ/máy ở TGI → đổi sang Mua mới | TGI dựng lại, nên tổ/máy vừa gán mất | lsx_service.py:2546 |
| GS46 | R | Lệnh cũ (nguồn trống, giấy ở In) | "Chưa chọn" → Tờ khổ nguyên | Chèn TGI, giấy từ In sang TGI. Nhật ký "Đổi nguồn giấy lệnh …: chưa có → Tờ khổ nguyên" | lsx_service.py:2475,2558 |
| GS47 | R | Tuyến tự khai (phiếu cũ có Cắt tờ) | Chọn bất kỳ nguồn | Máy chủ không dựng gì nhưng ô vẫn hiện lựa chọn, nhật ký ghi đã đổi (NL-GS03) | lsx_service.py:2445,2556 |

Thêm: sau mỗi lần đổi nguồn, xem trạng thái lệnh. Lệnh thiếu khổ nguyên đang Nháp phải nhảy "Chờ bổ sung";
lệnh đủ dữ liệu đang Chờ bổ sung phải về Nháp (lsx_service.py:2551-2555).

### 3.5 Bài ghép

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| GS48 | R | Ghép hai lệnh khác nguồn | LSX-A Cuộn + lệnh Tờ khổ nguyên → tạo bài, gộp In | Cả hai dựng lại theo nguồn của BÀI. Khâu cùng mã có ≥ 2 lệnh thì thành bước chung trước In chung | bai_ghep_service.py:640-662 |
| GS49 | R | Ghép lệnh cũ với lệnh mới | Tạo bài, gộp In | Lệnh cũ giữ tuyến. Chỉ một lệnh có khâu nên không có khâu chung | bai_ghep_service.py:649 |
| GS50 | R | Hai khổ nguyên khác nhau | 650×860 ghép 700×1000 | Bài lấy khổ của thành viên đầu. Kiểm kg CGC của lệnh kia (NL-GS13) | bien_cong_thuc.py:572 |
| GS51 | X | Đổi nguồn ở lệnh thành viên | Mở lệnh trong bài → đổi Nguồn giấy | Bị chặn (đã sửa 5ea5c31d, NL-GS02). Chỉ có unit test vì màn Bài ghép ẩn | lsx_service.py |
| GS52 | X | Bài đang giữ chỗ, thêm/bỏ thành viên | Bật giữ chỗ bài → Thêm lệnh | "Bài ghép BG… đang giữ chỗ vật tư — nhả chỗ ở màn Kế hoạch vật tư trước, vì đổi thành viên là đổi luôn số giấy cả bài cần." | bai_ghep_service.py:240 |
| GS53 | R | Đổi giấy chung / khổ in của bài | Sửa bài → Giấy chung | Máy chọn lại nguồn bài, dựng lại khâu. Kế hoạch vật tư còn một dòng giấy theo khoá mới | bai_ghep_service.py:523 |

### 3.6 Kho nhập giấy kg/tờ

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| GS54 | X | Kg dưới một tờ | Yêu cầu nhập E2E-DUP350 650×860, ĐVT kg, SL 0,1; rồi 0,196 | "“E2E-DUP350”: 0,1 kg khổ 650×860 quy ra 0 tờ."; gõ 0,196 thì vào 1 tờ | vat_lieu_kho_service.py:591 |
| GS55 | R | Khổ thực nhận khác khổ đặt | Phiếu nhập: Khổ thực nhận 640×860 | "Vào tồn N tờ (làm tròn xuống theo khổ thực nhận)" với N tính theo 640. Lệnh cần 650×860 không thấy lô này | KhoYeuCauPage.tsx:2412 |
| GS56 | X | Khổ thực nhận một cạnh, dòng tờ khai kg | Xoá ô Dài → Lưu phiếu | Dòng "Vào tồn" biến mất. Lưu ra lỗi kiểu không đổi được từ "Kg" về tờ (NL-GS17) | stock_voucher_service.py:359 |
| GS57 | R | Số nhập khác số đề nghị | Đề nghị 500 kg, phiếu nhập 499,99 | Số tờ tính từ số gõ, làm tròn xuống | kho_request.py:245 |
| GS58 | R | Lô giấy tờ cũ đang lưu kg | Tồn kho lọc mã đó → lập lệnh → hộp Chọn giấy của trọn gói | Cột Quy kg trống, lệnh chọn Mua mới, hộp không liệt kê lô (NL-GS10) | kho_giay.py:63 |

### 3.7 Gia công trọn gói (xưởng cấp giấy)

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| GS59 | X | Kg quá nhỏ | Chọn giấy → dòng "cuộn rộng 870 mm" → Số kg xin xuất "0,004" | Ô giữ 2 số lẻ thành 0,00, rồi báo "Số lượng xin xuất phải lớn hơn 0." | giaCong.ts:195; tron_goi.py:346 |
| GS60 | R | Gõ "1.500,5" và "1.234" | Số kg xin xuất | Dấu chấm là chia nghìn (đã sửa 5ea5c31d): "1.500,5" ghi 1.500,5 kg; "1.234" ghi 1.234 kg. Nhánh chuẩn bị giấy đã bấm đạt ca đầu | giaCong.ts |
| GS61 | X | Gửi đề nghị hai lần | Gửi đề nghị xuất giấy lần 2 | "Lần này đã có đề nghị xuất giấy — xem ở Yêu cầu nhập xuất." | tron_goi.py:354 |
| GS62 | R | Trọn gói có sóng | Hộp có sóng → trọn gói xưởng cấp | Chỉ một dòng giấy được đề xuất, sóng không có (NL-GS12) | tron_goi.py:243 |
| GS63 | R | CGC đang 0 kg | Mở Chọn giấy khi chưa có rộng cuộn | Đề xuất rơi về tờ khổ nguyên, nguồn ghi "phiếu tính giá" | gia_cong_ngoai_repo.py:356 |
| GS64 | X | Huỷ trọn gói sau khi kho lập phiếu | Huỷ gia công | "Kho đã lập phiếu xuất giấy {mã} cho nhà gia công — không huỷ được. Nhập trả giấy về kho trước." | tron_goi.py:202 |
| GS65 | R | Kg cuộn làm tròn lên | Cuộn 870, 100 tờ nguyên | CGC 19,80 kg (từ 19,7925). Cấp đủ đề nghị thì bảng cân đối không còn lẻ gam | chuan_bi_giay.py:116 |

---

## 4. VT — Vật tư tự lập khi phát hành, cổng Bắt đầu, thu hồi

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| VT01 | C | Phát hành tự lập yêu cầu xuất | Xếp lịch → LSX-A (vật tư ở nhiều bước) → "Phát hành" | Xem bảng ngay dưới | vat_tu_tu_lap.py:163-191 |
| VT02 | R | Một món không lập được | Mã vật tư thiếu đơn vị gốc → "Phát hành" | Toast thêm "N món chưa tự lập được, tổ xin tay."; rê thấy "‹công đoạn›: ‹hàng› — ‹lý do›". Các món khác vẫn lập | vat_tu_tu_lap.py:137 |
| VT03 | R | Mọi món của bước lỗi | Như VT02, cả bước | Bước không bị khoá vật tư: ô Vật tư trống, Bắt đầu được | trang_thai_vat_tu.py:75 |
| VT04 | X | Công thức lượng ra 0 | Công đoạn chưa khai công thức lượng → phát hành → "Bắt đầu" | Chip đỏ "Chưa yêu cầu"; "Chưa yêu cầu vật tư. Bấm Yêu cầu cấp vật tư trước." | trang_thai_vat_tu.py:26 |
| VT05 | R | Bài ghép | Phát hành bài nhiều bước chung | Giấy chỉ ở bước chung nhận giấy; các bước chung khác chỉ vật tư khác | vat_tu_tu_lap.py:65-73 |
| VT06 | R | Giờ cần | Mở yêu cầu tự lập bên kho | Cột "Cần lúc" = giờ dự kiến bắt đầu bước; bước chưa có giờ thì lấy giờ phát hành | vat_tu_tu_lap.py:57 |
| VT07 | X | Tổ xin trùng | Ngay sau phát hành: tab Vật tư → "Yêu cầu cấp vật tư" | "Đang có đề nghị chưa được kho lập phiếu — hãy sửa đề nghị đó thay vì tạo lần mới." | vat_tu_de_nghi.py:490 |
| VT08 | C | Phát hành cập nhật dời giờ | Kéo lệnh sang giờ khác → "Phát hành cập nhật" (lý do) → "Đẩy lịch mới xuống xưởng" | Yêu cầu tự lập chưa bị tổ sửa và kho chưa ghi sổ: "Cần lúc" bên kho tự nhảy giờ mới | vat_tu_tu_lap.py:306 |
| VT09 | R | Tổ đã sửa giờ | Tổ "Sửa đề nghị" đổi giờ → kế hoạch cập nhật dời giờ | Giữ giờ của tổ | vat_tu_tu_lap.py:320 |
| VT10 | R | Kho đã ghi sổ rồi mới cập nhật | Kho ghi sổ → "Phát hành cập nhật" | Giờ cần không đổi | vat_tu_tu_lap.py:325 |
| VT11 | X | Chờ kho | Yêu cầu còn chờ → "Bắt đầu" | Nút mờ; "Vật tư chưa sẵn sàng: đang chờ kho. Đợi kho xuất xong mới bắt đầu được." | trang_thai_vat_tu.py:27 |
| VT12 | X | Kho đang soạn | Kho "Lập phiếu xuất" (chưa ghi sổ) | Chip bàn tổ tự đổi "Kho đang soạn" không cần F5; "Vật tư chưa sẵn sàng: kho đang soạn. Đợi kho xuất xong mới bắt đầu được." | trang_thai_vat_tu.py:28 |
| VT13 | X | Xuất một phần | Kho ghi sổ một phần | Chip cam "Cấp thiếu"; "Vật tư chưa sẵn sàng: kho mới cấp một phần. Đợi kho xuất nốt mới bắt đầu được." | trang_thai_vat_tu.py:29 |
| VT14 | R | Kho chốt thiếu | Kho chốt thực xuất < số xin rồi hoàn tất | Chip "Sẵn sàng"; rê thấy "‹hàng› xin X và đã xuất Y (kho chốt thiếu)"; Bắt đầu được | trang_thai_vat_tu.py:5-6,72 |
| VT15 | X | Kho huỷ yêu cầu tự lập | Kho → huỷ yêu cầu | Bước về "Chưa yêu cầu". Chấm đỏ vào kênh TỔ của bước, không vào người phát hành. "Yêu cầu bổ sung" mở được | stock_request_service.py:790 |
| VT16 | R | Bổ sung chờ kho khi đang tạm dừng | Việc Tạm dừng, lần bổ sung chờ kho → "Tiếp tục" | Không bị chặn (cổng chỉ áp cho lần bắt đầu đầu) | dau_vao.py:329 |
| VT17 | X | Lần 1 sẵn sàng, lần 2 chờ kho, chưa bắt đầu | "Bắt đầu" | Bị chặn: bước lấy mức chưa xong sớm nhất | trang_thai_vat_tu.py:64 |
| VT18 | C | Lọc vướng vật tư | Bàn tổ → lọc Vướng = "Chưa sẵn sàng vật tư" | Chỉ việc chưa bắt đầu đang kẹt vật tư | dieu-kien-ban-to.ts:82 |
| VT19 | C | Thu hồi khi kho chưa lập phiếu | LSX-E → "Thu hồi phát hành" (lý do) | Yêu cầu huỷ với lý do "Lệnh bị thu hồi phát hành"; badge chờ cấp của thủ kho tụt ngay | vat_tu_tu_lap.py:195,254 |
| VT20 | R | Thu hồi khi có phiếu nháp | Kho lập phiếu nháp → thu hồi | Phiếu nháp huỷ; nhật ký "Phiếu … huỷ theo yêu cầu …: lệnh bị thu hồi phát hành" | vat_tu_tu_lap.py:245 |
| VT21 | R | Thu hồi khi đã xuất một phần | Kho ghi sổ 1 phiếu → thu hồi → phát hành lại | Yêu cầu cũ giữ. Phát hành lại không lập yêu cầu mới; đề nghị cũ nối sang việc mới thành "Lần 1"; chip "Cấp thiếu" tới khi xuất nốt. Thêm: KHÔNG phát hành lại, xem yêu cầu có treo ở hàng chờ kho không (NL-VT02) | vat_tu_tu_lap.py:243,270 |
| VT22 | R | Thu hồi cuốn yêu cầu tổ tự bấm | Tổ "Yêu cầu bổ sung" (chưa xuất) → thu hồi | Yêu cầu tổ bấm cũng huỷ | vat_tu_tu_lap.py:209 |
| VT23 | R | Phát hành lại với số lần chạy khác | Lần cũ 2 phân đoạn, kho xuất phân đoạn 2 → gộp lại 1 → phát hành | Đề nghị phân đoạn 2 dồn về phân đoạn 1 | vat_tu_tu_lap.py:295 |
| VT24 | C | Kho lọc theo Lệnh | Kho → điều kiện "Lệnh" | Ra cả yêu cầu có dòng gắn bài ghép chứa lệnh | stock_request_repo.py (_dk_lenh) |
| VT25 | C | Kho lọc Tổ / Phòng ban | "Tổ" và "Phòng ban yêu cầu" | "Tổ" ra cả yêu cầu người phòng khác bấm cho bước của tổ; "Phòng ban yêu cầu" chỉ khớp phòng đứng tên | stock_request_repo.py:39-52 |
| VT26 | C | Kho lọc Vật tư | "Vật tư", chọn nhiều mã | Số đếm cạnh lựa chọn khớp số dòng | dieu-kien-yeu-cau-kho.ts:133 |

Ca VT01 phải thấy, theo từng người:
- **Người bấm:** toast "Đã phát hành xuống xưởng. Đã gửi kho N yêu cầu xuất."
- **Thủ kho trong phạm vi**, trừ người bấm: MỘT chuông và toast "🔔 LSX…: N yêu cầu xuất mới chờ lập phiếu".
- **Bàn từng tổ:** toast "📦 Đề nghị cấp vật tư của công đoạn vừa cập nhật".
- **Màn kho:** tag "Tự lập khi phát hành". Tab Vật tư cũng ghi "Tự lập khi phát hành" ở chỗ người lập.

---

## 5. MT — Máy thuộc tổ

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| MT01 | C | Khai tổ đứng máy | Danh mục Máy → "Tổ đứng máy" chọn 2 tổ → Lưu | Công đoạn đang tick hai tổ đó tự có dòng máy (công thức trống) | may_thiet_bi_service.py:96 |
| MT02 | X | Chọn tổ cha | "Tổ đứng máy" = phòng ban có tổ con | "Tổ đứng máy phải là tổ cuối trong cây tổ chức, không chọn phòng ban có tổ con." | may_thiet_bi_service.py:116 |
| MT03 | R | Tổ chưa có máy lúc lập lệnh | Công đoạn tick tổ chưa có máy → lập lệnh / đổi công đoạn ở routing | Bước ra đời loại "Tổ"; đổi công đoạn: "… Tổ chưa có máy chạy công đoạn này" | LsxRoutingTable.tsx:331 |
| MT04 | R | Chọn tổ không có máy | Ngăn bước → chọn tổ chưa có máy | "Tổ này chưa có máy chạy công đoạn này."; ô máy chỉ giữ máy đang gán | LsxBuocDrawer.tsx:894 |
| MT05 | X | Cặp tổ × máy lệch | Gọi API: lưu bước máy có máy không thuộc tổ | "Máy ‹mã› không thuộc ‹tổ›. Chọn máy của ‹tổ› hoặc đổi tổ." | may_to.py:91 |
| MT06 | R | Máy dùng chung | Mở ô máy, máy thuộc 2 tổ | Option "‹máy› — cũng thuộc ‹tổ khác›". Máy đang gán lệch tổ có gợi ý "Máy này không thuộc tổ đang chọn, máy của …" | LsxBuocDrawer.tsx:870 |
| MT07 | R | Máy in của phiếu quyết tổ | Phiếu chọn máy in thuộc tổ 4 màu, tổ mặc định 2 màu → lập lệnh | Bước In có tổ 4 màu | may_to.py:56 |
| MT08 | X | Đổi tổ/máy khi việc đã chạy | Ngăn bước của việc đã bắt đầu | Hai ô khoá, "Việc đã bắt đầu ở bàn tổ — đổi máy ở bàn tổ." | lsx_service.py:3634 |
| MT09 | C | Đổi tổ rồi phát hành cập nhật | Bước máy chưa bắt đầu → đổi tổ → "Phát hành cập nhật" | Việc sang bàn tổ mới; phân công cũ huỷ "Phát hành cập nhật — phân công cần xác nhận lại."; hai bàn tự nạp | release_update.py:396 |
| MT10 | R | Đổi máy ở bàn tổ | "⋯" → "Đổi máy" | Chỉ máy của tổ; máy dùng chung có dòng "Cũng thuộc …". Tổ hết máy khác: "Tổ không còn máy khác chạy công đoạn này. Việc chờ máy sửa xong." | ThsxDoiMay.tsx:66-104 |
| MT11 | X | Đổi sang máy tổ khác | Gọi API, hoặc tab mở lâu | "Máy ‹mã› không thuộc ‹tổ›. Chọn máy của ‹tổ› hoặc đổi tổ." | thuc_thi.py:561 |
| MT12 | R | Chuyển máy sang tổ khác ở danh mục | Việc tổ A đang chạy → danh mục chuyển máy sang tổ B | Việc vẫn chạy. Hồ sơ lệnh cảnh báo "Máy X không thuộc Tổ A"; sửa khác của lệnh vẫn lưu; Đổi máy ở bàn A không chọn lại được máy đó | lsx_service.py:3433 |
| MT13 | R | Đổi tổ ở bước loại Tổ | Bước Tổ chưa bắt đầu → đổi tổ → "Phát hành cập nhật" | Việc phải sang bàn mới. Code nghi vẫn ở bàn cũ (NL-MT01) | release_update.py:397 |

---

## 6. DM — Báo dừng máy

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| DM01 | C | Máy hư hôm nay, đủ hai quyền | Bấm "Báo dừng máy", khai từng ô rồi gửi (xem dưới bảng) | Xem dưới bảng | dung_may.py:222-324 |
| DM02 | R | Báo lại khi yêu cầu chờ tiếp nhận | Báo lại cùng máy, mức cao hơn + triệu chứng mới | Không đẻ yêu cầu 2; "Đã gắn vào YC… đang chờ tổ sửa chữa nhận"; mức chỉ nâng; tổ sửa chữa được toast lại | dung_may.py:275,336 |
| DM03 | R | Máy đã có phiếu sửa mở | Hộp hiện "Đã báo SC…, gửi nữa sẽ gắn vào đây" → gửi, có tick "Máy đang dừng" | "Đã gắn vào phiếu sửa SC… đang mở"; tổ sửa chữa nhận "🔔 … báo thêm triệu chứng …". Thêm: việc khác trên máy đó "Bắt đầu" có bị chặn không (NL-DM02) | dung_may.py:277,327 |
| DM04 | R | Chỉ có quyền Báo hỏng | Vai Báo hỏng mở hộp | Chỉ phần máy hư hôm nay; không ngày, lý do, người hưởng, bảng đã báo; nút "Gửi tổ sửa chữa". Thêm: tick "Máy đang dừng" rồi gửi (NL-DM03) | BaoDungMayModal.tsx:105 |
| DM05 | X | Không quyền nào | Gọi API | "Bạn không có quyền Báo hỏng (Sửa chữa máy) ở tổ này" | dung_may.py:118 |
| DM06 | X | Tổ không có máy | Mở hộp, hôm nay, Máy hư | "Tổ chưa có máy nào. Khai "Tổ đứng máy" ở danh mục Máy, hoặc chọn ngày đã qua để chỉ tính ngày dừng."; nút khoá | BaoDungMayModal.tsx:262 |
| DM07 | X | Máy không phải của tổ | Gọi API với máy tổ khác | "Máy này không phải máy của tổ — chọn máy tổ đứng hoặc máy đang chạy việc của tổ." | dung_may.py:242 |
| DM08 | X | Ngày tương lai | Ô ngày chặn `max`; gọi API | "Ngày dd/mm chưa tới — chỉ báo dừng máy hôm nay hoặc ngày đã qua." | dung_may.py:195 |
| DM09 | X | Tổ cha | Gọi API id tổ cha | "Đây là tổ cha (chỉ là nhóm) — báo dừng máy ở từng tổ con." | dung_may.py:193 |
| DM10 | X | Trùng ngày | Báo bù ngày đã có dòng → "Lưu" | "Tổ đã báo dừng máy ngày dd/mm."; ô tick lương mờ "Tổ đã báo dừng máy ngày dd/mm, sửa ở bảng dưới nếu cần." | dung_may.py:199 |
| DM11 | X | Hai máy cùng Lưu | Hai trình duyệt cùng tổ, cùng ngày, Lưu cùng lúc | Lượt sau nhận "Tổ đã báo dừng máy ngày dd/mm." | dung_may.py:206 |
| DM12 | X | Kỳ lương đã chốt | Chọn ngày tháng đã chốt; Sửa/Xoá dòng cũ | Băng "Kỳ lương tháng MM/YYYY đã chốt — ngày thuộc kỳ này không báo, sửa hay xoá được nữa."; dòng "Kỳ đã chốt". Kỳ đã chi: băng vẫn ghi "đã chốt" (NL-DM08) | dung_may.py:94 |
| DM13 | X | Người hưởng sai | Bỏ tick hết; gọi API người tổ khác | Nút khoá + "Chọn ít nhất một người hưởng ngày dừng máy."; API "Người hưởng không thuộc tổ: …" | dung_may.py:170 |
| DM14 | C | Sửa ngày đã báo | "Đã báo tháng …" → "Sửa" → đổi người/lý do → "Lưu" | Tiêu đề "Sửa ngày dừng máy dd/mm", ngày không đổi được; toast "Đã sửa ngày dừng máy dd/mm." | dung_may.py:366 |
| DM15 | C | Xoá, và xoá đua | "Xoá" → "Xoá hẳn ngày dd/mm?" → "Xoá"; máy kia xoá cùng dòng | "Đã xoá ngày dừng máy dd/mm."; lượt sau 404 "Không tìm thấy ngày dừng máy — có thể đã xoá ở máy khác." | dung_may.py:392 |
| DM16 | X | Gắn phiếu của máy tổ khác | Gọi API `sua_chua_id` máy tổ khác | "Phiếu SC… là của máy không phải máy của tổ." | dung_may.py:181 |
| DM17 | X | Máy dừng chặn Bắt đầu | Sau DM01, việc khác cùng máy → "Bắt đầu" | "Máy đang dừng chờ sửa (YC…) — sửa xong hoặc đổi máy rồi mới bắt đầu được." | thuc_thi.py:295 |
| DM18 | R | Ngày dừng vào lương | Ngăn soi khoán kỳ | Dòng "Dừng máy" = chỉ tiêu ngày chia theo lương ca máy. Tổ chưa khai chỉ tiêu: "Tổ ‹tên› chưa khai chỉ tiêu ngày — ngày dừng máy dd/mm chưa tính." | khoan_ky.py:628 |
| DM19 | R | Báo dừng ngày Chủ nhật | Báo bù một ngày CN | Hiện NHẬN và cộng trọn chỉ tiêu. Cần chủ chốt (NL-DM05) | dung_may.py:190 |
| DM20 | R | Máy hư thuộc 2 tổ | Máy dùng chung, tổ X báo hư | Việc của tổ Y trên cùng máy có tạm dừng không (NL-DM04) | dung_may.py:254 |
| DM21 | R | Báo hư máy tổ đứng nhưng chưa từng chạy việc | Máy có phiếu mở → báo hư + tick lương → "Sửa" dòng | Phải sửa được. Code nghi chặn "Phiếu … là của máy không phải máy của tổ." (NL-DM01) | dung_may_repo.py:79 |

Ca DM01 thao tác lần lượt:
1. Bấm "Báo dừng máy". Chọn Lý do "Máy hư", ngày hôm nay, rồi chọn máy.
2. Tick "Máy đang dừng, không chạy được".
3. Chọn "Mức độ theo bạn thấy" và gõ "Triệu chứng".
4. Tick "Tính ngày dừng cho lương".
5. Bấm "Gửi tổ sửa chữa và lưu ngày dừng".

Ca DM01 phải thấy:
- **Người bấm:** toast "Đã gửi YC… tới tổ sửa chữa, việc trên máy đã tạm dừng, đã lưu ngày dừng dd/mm."
- **Tổ sửa chữa:** toast "⚠️ ‹máy› đang dừng vì hỏng (‹người› báo)".
- **Việc trên máy:** chuyển Tạm dừng, lý do "Sự cố YC…: …".

---

## 7. SL — Ghi sản lượng

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| SL01 | R | Ghi 0 | "Ghi sản lượng" Tốt 0, Hỏng 0 | Lưu được, không tự đề xuất giao | san_luong.py:252,384 |
| SL02 | C | Tự đề xuất giao | Bước có 1 chặng sau khác tổ → ghi | Lần giao "chờ xác nhận"; bên nhận được báo. Cùng tổ + cùng lệnh thì tự xác nhận. Nhiều chặng sau thì không tự giao | san_luong.py:360-395 |
| SL03 | X | Giờ tương lai | Giờ kết thúc ở tương lai | "Giờ kết thúc đang ở sau thời điểm hiện tại — chỉ ghi phần đã làm xong." | san_luong.py:271 |
| SL04 | X | Sửa số vượt trần | "Sửa số" tăng quá trần | "Vượt …: …, các lần khác đã ghi X — lần này ghi tối đa Y" / "đã ghi đủ số kế hoạch, không ghi thêm được." | dau_vao.py:220 |
| SL05 | X | Sửa về 0 khi đã giao | "Sửa số" = 0 | "Sản lượng lần này đã giao sang bước sau — không sửa về 0 được." | san_luong.py:467 |
| SL06 | X | Giảm dưới số bước sau đã ghi | "Sửa số" giảm | "Không giảm được: ‹bước sau› đã ghi X, giảm thế thì số nhận chỉ đủ cho Y." | dau_vao.py:281 |
| SL07 | X | Giảm dưới số KCS đạt | "Sửa số" giảm | "KCS đã kiểm đạt X ở bước này — tổng sản lượng không xuống dưới số đó được (sửa thế thì còn Y)." | san_luong.py:476 |
| SL08 | R | Giảm khi lần giao khác tổ đã xác nhận | "Sửa số" giảm | Lần giao đổi theo; bên nhận phải xác nhận lại | san_luong.py:495 |
| SL09 | C | Tuỳ chọn khi ghi | Công đoạn khai tuỳ chọn → "Ghi sản lượng" có "Tuỳ chọn lần này" | Chi tiết lần ghi có dòng "Tuỳ chọn" với chip | ThsxExecPanels.tsx:391 |
| SL10 | R | Sửa chỉ tuỳ chọn / không đổi gì | "Sửa số" giữ số, đổi tick; lưu lần nữa không đổi | Lần đầu lưu được; lần sau "Số mới trùng số đang ghi." / "Số và người làm đều chưa đổi gì." | san_luong.py:459,578 |
| SL11 | X | Tuỳ chọn sai | Ô số âm; gọi API mã lạ; công đoạn chưa cấu hình Khoán | '"‹tên›" không được âm.' / "Tuỳ chọn không có ở công đoạn: …" / "Công đoạn chưa cấu hình Khoán nên không có tuỳ chọn khi ghi." | viec_khoan.py:315,389 |
| SL12 | X | Thợ bấm Sửa số | Vai Thợ In | Nút không hiện; API "Bạn không có quyền Xác nhận sản lượng ở tổ này" | quyen_to.py:53 |
| SL13 | R | Sửa số sau khi công đoạn đổi khai tuỳ chọn | Ghi có tuỳ chọn T → danh mục bỏ T → "Sửa số" lần ghi đó | Tuỳ chọn cũ phải giữ. Code nghi chụp lại theo khai mới (NL-SL02) | san_luong.py:454 |

---

## 8. BG — Báo giá: chiết khấu, kê, làm tròn, duyệt

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| BG01 | C | CK % trên giá bán | Dòng không gõ tay, vốn 1.000.000, Markup 20, CK "%" 5 | Giá bán 1.276.596; CK 63.830; lợi nhuận 212.766; Markup vẫn 20% | quotation_service.py:540-567 |
| BG02 | C | CK 0% | Như BG01, gõ 0 | Giá bán 1.200.000; "Chiết khấu (chi lại khách)" ghi "0 đ" | BaoGiaPage.tsx:1863 |
| BG03 | X | CK quá lớn | Markup 20, CK 100 (hoặc Markup 25, CK 80) → rời ô | "Chiết khấu quá lớn so với lợi nhuận — không có giá bán nào chừa đủ phần chiết khấu". Gõ trên 100 thì ô kẹp về 100 | quotation_service.py:545 |
| BG04 | R | CK sát trần làm giá phình | Markup 24, CK 80% | Giá bán = vốn × 155 mà không chặn. Phải nổi "Giá trị đơn cao" hoặc rào CK nếu khách có rào | quotation_service.py:544 |
| BG05 | R | Làm tròn ,5 | Giá gõ tay 10.000.002 → CK % 25 → Lưu | Lúc gõ hiện 2.500.001, sau Lưu 2.500.000 (NL-BG02) | quotation_service.py:562 |
| BG06 | C | Kê % | E2E-KE: Kê tab "%" 10 | Kê 1.000.000; "Giá bán sau kê" 11.000.000; khối tổng thêm "Kê (chi lại người bên khách) +1.000.000 đ"; VAT 880.000; tổng 11.880.000 | quotation_service.py:1312 |
| BG07 | R | Kê giữ tiền khi đổi markup | Sau BG06 sửa Markup | Kê giữ 1.000.000; % kê đổi, có thể vượt rào | BaoGiaPage.tsx:951 |
| BG08 | X | Kê âm | Gõ "-5" | Ô về 0, không câu lỗi; máy chủ 422 | schemas/quotation.py:27 |
| BG09 | R | VAT làm tròn xuống | Giá gõ tay 1.234.567, VAT 10% | VAT 123.456, gồm VAT 1.358.023. Khối tổng, lịch sử phiên bản, danh sách, đơn khớp nhau | bao-gia-tong.ts:25 |
| BG10 | R | Rào CK chừa 1 đ | Khách CK tối đa 5%. Giá 10.000.000, CK "Số" 500.001 rồi 500.002 | 500.001 "Gửi khách" thẳng được; 500.002: "Chiết khấu ngoài mức cho phép của khách: ‹SP›" | exception_gate.py:126 |
| BG11 | R | Rào kê đúng trần | Khách kê tối đa 5%. Giá 10.000.030 → Kê % 5 | Kê 500.002 bị "Kê ngoài mức cho phép của khách: ‹tên›" dù gõ đúng trần (NL-BG01) | exception_gate.py:147 |
| BG12 | X | Thiếu kê dưới rào tối thiểu | Khách kê tối thiểu 2%, dòng không kê → "Gửi khách" | "Báo giá thuộc diện đặc thù — phải TRÌNH DUYỆT để Giám đốc Kinh doanh duyệt trước khi gửi khách." | quotation_service.py:1442 |
| BG13 | R | Giá trị cao tính cả kê | Giá bán 950tr + kê 60tr | Nổi "Giá trị đơn cao" (ngưỡng 1 tỷ trước VAT, gồm kê) | exception_gate.py:109 |
| BG14 | X | Khai rào ngược | Khách → "Kê cho phép" 10 đến 5; "Thuế TNDN trên kê" 120 | "Kê tối thiểu đang lớn hơn tối đa." / "Thuế TNDN trên kê không quá 100%." | KhachHangPage.tsx:1786 |
| BG15 | R | Kê "Số" cho nhóm ruột + bìa | 2 dòng cùng nhóm, Kê "Số" 1.000.001 | Chia theo giá bán, dòng cuối nhận dư, tổng đúng 1.000.001 | BaoGiaPage.tsx:967 |
| BG16 | R | Khách chốt một phần có kê | "Khách chốt" tick 1 trong 2 dòng → "Tạo đơn hàng" | Tổng chỉ cộng dòng khách lấy; dòng đơn chép đúng kê và CK | order_service.py:626 |
| BG17 | R | Tức thời cho người duyệt | Hai phiên: Sale "Trình duyệt", GĐ mở sẵn | GĐ thấy chấm đỏ + toast "🔔 Báo giá BG… chờ bạn duyệt". GĐ "Duyệt" → Sale nhận toast. "Gửi khách" tự đổi màn người kia | quotations.py:729 |
| BG18 | R | Người duyệt phạm vi Phòng khác Sale | GĐ phạm vi Phòng, khác phòng Sale | Không thấy chấm đỏ. Cần chủ chốt có đúng ý không | quotations.py:735 |
| BG19 | R | Giá vốn khi tắt "Xem chi tiết giá vốn" | Vai Tính giá mở phiếu, rồi mở Báo giá | Tính giá chỉ thấy giá vốn tổng; Báo giá vẫn thấy cột "Giá vốn" và Markup. Cần chủ chốt | quotations.py:206 |
| BG20 | R | Bản duyệt và chuyển kê giữa sản phẩm | Duyệt vì kê ngoài rào → chuyển kê từ SP1 sang SP2, tổng không tăng → "Gửi khách" | Phải đòi duyệt lại. Code nghi coi bản cũ còn hiệu lực (NL-BG03) | exception_gate.py:183 |

---

## 9. CO — Đơn bán và cọc

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| CO01 | C | Cọc bằng số tiền | "Sửa" → "Cọc phải thu" tab "Số" 3.000.000 → "Lưu" | "Cọc quy định 3.000.000 đ"; % cọc cũ bị xoá | order_service.py:708 |
| CO02 | X | Cọc lớn hơn tổng đơn | Tab "Số" 11.880.001 | "Tiền cọc không được vượt giá trị đơn hàng (11.880.000 đ)." | order_service.py:712 |
| CO03 | R | Cọc 100% | Tab "%" 100 → chốt → thu đủ → ghi hoá đơn lượt 1 | Hoá đơn "Đã thu đủ" ngay nhờ trừ cọc; vào "Chờ chi CK / kê" luôn | coc.py:10; chi_ck_ke.py:94 |
| CO04 | R | Gõ 0 ở tab Số khi đang cọc % | Đơn 30% → tab "Số" 0 → "Lưu" | Phải về không cọc. Code nghi vẫn 30% mà không báo gì (NL-CO02) | order_service.py:703 |
| CO05 | R | Cọc % ra số lẻ | Đơn 1.358.023, cọc 30% | Cần cọc 407.407 | coc.py:15 |
| CO06 | R | % cọc thập phân | Tab "%" gõ "12,5" | Phải nhận 12,5. Code nghi ô thành 100 (NL-CO01) | DonHangBanPage.tsx:1920 |
| CO07 | R | Thu cọc dư: lẻ khác gộp (P7) | Lẻ: "Lập phiếu thu cọc" 4.000.000 khi thiếu 3.564.000. Gộp: "Đơn hàng chờ thu" → tick cọc → "Lập một phiếu thu" → 4.000.000 | Lẻ: "Thu dư 436.000 đ so với phần cọc còn thiếu." và vẫn lập được. Gộp: "‹DH› Cọc thu quá phần còn phải thu (3.564.000 đ)." | DepositReceiptDialog.tsx:236 |
| CO08 | R | Cọc thu vượt tổng đơn | Thu cọc lẻ 12.000.000 cho đơn 11.880.000 | Phiếu chi → "Chờ trả lại khách" hiện 120.000 ngay | ban_hang_cho_thu_chi.py:116 |
| CO09 | X | Huỷ đơn đã có hoá đơn | "Hủy đơn" | "Đơn đã có hóa đơn còn hiệu lực; hãy hủy hóa đơn trước khi hủy đơn." | order_service.py:976 |
| CO10 | X | Thu gộp cọc của đơn vừa huỷ | Tab "Đơn hàng chờ thu" mở sẵn; người khác huỷ đơn → tick cọc → lập | "Đơn DH… đã huỷ, không ghi cọc." | accounting_service.py:3000 |

---

## 10. HD — Hoá đơn theo lượt, chiết khấu và kê, khoá sổ

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| HD01 | C | Hoá đơn lượt 1 | Lượt 400 → "Ghi hóa đơn" (gợi ý 4.752.000) → "Ghi nhận" | "chiết khấu 200.000", "kê 400.000", "thuế TNDN trên kê 80.000", "trừ cọc 3.564.000"; còn phải thu 1.188.000 | accounting_service.py:2087 |
| HD02 | C | Hoá đơn lượt 2 | Lượt 600 → 7.128.000 | CK 300.000, kê 600.000, thuế 120.000 | chi_ck_ke.py:58 |
| HD03 | R | Hoá đơn khác giá trị lượt | HĐ1 gõ 3.000.000 cho lượt 1; HĐ2 lượt 2 gõ 8.880.000 | HĐ1: CK 126.263, kê 252.525, thuế 50.505. HĐ2: CK 373.737, kê 747.475, thuế 149.495. Cộng đúng 500.000 / 1.000.000 | chi_ck_ke.py:62 |
| HD04 | X | Vượt phần chưa ghi | Gõ 11.880.001 | "Giá trị hóa đơn phải từ 1 đến 11.880.000 đ." | DonHangBanPage.tsx:1376 |
| HD05 | X | Ghi khi đã đủ | "Ghi hóa đơn" thêm lần | "Đơn đã ghi hóa đơn đủ tổng giá trị đơn." | accounting_service.py:2073 |
| HD06 | R | CK/kê chỉ vào hàng chờ khi thu đủ | HĐ1 thu 1.000.000, rồi 188.000 | Lần 1 "Chờ chi CK / kê" chưa có. Lần 2 có hai dòng (CK còn 200.000; Kê còn 320.000); Phiếu chi chấm đỏ, toast "🔔 Hóa đơn … đã thu đủ, chờ chi chiết khấu/kê", mỗi hoá đơn một lần | chi_ck_ke.py:84,149 |
| HD07 | X | Thu dư hoá đơn | Thu 300.000 khi còn 188.000 | "Thu quá số còn phải thu 112.000 đ. Phiếu thu một hoá đơn không được vượt số còn nợ." | ThuTienHoaDon.tsx:407 |
| HD08 | C | Chi CK một phần | Phiếu chi → "Chờ chi CK / kê" → dòng CK → "Lập phiếu chi" → 150.000 | Người nhận khoá theo khách ("Chiết khấu trả đúng khách của hóa đơn"); còn 50.000 | accounting_service.py:1666 |
| HD09 | X | Chi CK vượt | 60.000 khi còn 50.000 | "Hóa đơn X chi quá phần còn phải chi (50.000 đ)." | LapPhieuChiCkKeModal.tsx:126 |
| HD10 | X | Chi gộp khác khách / khác loại | Tick CK khách A rồi kê A, hoặc CK khách B | Ô khoá, title "Khác khách hoặc khác khoản chi" | HangChoCkKe.tsx:64 |
| HD11 | X | Chi kê không người nhận | Để trống người nhận | "Ghi người nhận tiền." | LapPhieuChiCkKeModal.tsx:129 |
| HD12 | X | Huỷ hoá đơn đã chi CK | HĐ1 → "Hủy" | "Hóa đơn đã có phiếu chi chiết khấu/kê — huỷ phiếu chi trước." | accounting_service.py:2142 |
| HD13 | R | Huỷ phiếu chi rồi huỷ hoá đơn | Huỷ phiếu chi CK → huỷ HĐ → ghi lại cùng lượt | Khoản quay lại hàng chờ rồi mất khi huỷ HĐ; HĐ ghi lại nhận lại CK | chi_ck_ke.py:9 |
| HD14 | R | Huỷ hoá đơn khách đã trả | HĐ2 thu đủ, chưa chi CK → "Hủy" | Tiền về quỹ đơn ("trừ tiền đã thu"). Đơn đã ghi đủ thì sang "Chờ trả lại khách"; ghi lại HĐ thì tự trừ | accounting_service.py:2140 |
| HD15 | R | Huỷ phiếu thu sau khi chi CK | Sau HD08 huỷ phiếu thu HĐ1 | Phải chặn hoặc cảnh báo. Code nghi cho huỷ, HĐ còn nợ mà CK đã chi (NL-HD01) | accounting_service.py:3221 |
| HD16 | R | Trả lại ngoài đơn | Công nợ phải thu → trả lại 5.000.000 không gắn đơn | HĐ ghi "cộng lại 5.000.000 đã trả khách ngoài đơn"; cột "Trả lại ngoài đơn" ở "Đơn hàng chờ thu" và Báo cáo kinh doanh | accounting_service.py:520 |
| HD17 | R | Khách trả không qua đơn | "Phiếu thu khác" cho khách | Công nợ phải thu không giảm; không sinh hoa hồng | cong_no_khoa_ky.py:12 |
| HD18 | X | Chứng từ trong kỳ phải thu đã khoá | Khoá kỳ → "Ghi hóa đơn", "Hủy" HĐ, lập phiếu thu ngày trong kỳ | "Kỳ công nợ phải thu chứa ngày dd/mm/yyyy đã khoá — không lập, sửa hay huỷ hoá đơn bán có ngày trong kỳ này. Mở lại kỳ rồi mới làm." (đổi "hoá đơn bán" thành "phiếu thu"/"phiếu chi") | cong_no_khoa_ky.py:94 |
| HD19 | R | Phiếu chi CK/kê trong kỳ khoá | Lập rồi huỷ phiếu chi CK ngày trong kỳ khoá | Hiện KHÔNG chặn. Cần chủ chốt (NL-HD02) | cong_no_khoa_ky.py:39 |

Kiểm thêm ở mọi câu lỗi tiền phía máy chủ: số có in "188,000 đ" (dấu phẩy) không (NL-HD03).

---

## 11. HH — Hoa hồng theo tiền thu

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| HH01 | C | Khai biểu CTV | Hồ sơ lương → "Hoa hồng kinh doanh theo số ngày thu tiền" → "＋ Thêm bậc" 45/3, 60/2, 75/1, bậc cuối 0 → Lưu | Nhãn tự nối "Đến 45 ngày", "Trên 45 đến 60", "Trên 75 ngày" | BacHoaHongField.tsx:45 |
| HH02 | X | Biểu sai thứ tự | Mốc 60 rồi 45 → Lưu | Ô đỏ "Mốc phải lớn hơn mốc của bậc trên nó"; máy chủ "Mốc số ngày phải tăng dần." | bac_hoa_hong.py:38 |
| HH03 | C | Cọc và hai hoá đơn theo bậc | E2E-KE: cọc thu ngày chốt; HĐ1 thu sau 50 ngày; HĐ2 thu sau 45 ngày → Bảng lương "Tính lại" → bấm ô Hoa hồng | Cọc: 2.850.000 × 3% = 85.500. HĐ1: 950.000 × 2% = 19.000. HĐ2: 5.700.000 × 3% = 171.000. Tổng gốc 9.500.000 | hoa_hong_service.py:80-151 |
| HH04 | R | Biên bậc ngày | HĐ2 thu ngày 46 / 61 / 76; thu trước ngày HĐ | 114.000 / 57.000 / 0; "Ngày thu không được trước ngày hóa đơn." | bac_hoa_hong.py:13 |
| HH05 | R | Tiền về khác kỳ | HĐ 28/09, thu 03/10 | Khoản ở bảng lương 10/2026, số ngày 5 | hoa_hong_service.py:104 |
| HH06 | R | Đổi biểu sau chốt đơn; lãnh đạo | Đổi biểu sau "Chốt đơn"; lãnh đạo "Mọi số ngày" 0,5 | Đơn đã chốt theo biểu cũ, đơn sau theo biểu mới; lãnh đạo thu sau 200 ngày vẫn 0,5% | order_service.py:162,939 |
| HH07 | R | % riêng của đơn | Ngăn soi → "Đặt % riêng" | Không lý do thì "Lưu % riêng" xám; Lưu xong tự Tính lại; gõ 0 loại đơn; "Bỏ % riêng" về biểu; kỳ đã chốt không có nút | SoiHoaHong.tsx:85,195 |
| HH08 | R | Huỷ phiếu thu sau chốt lương | Chốt kỳ → huỷ phiếu thu HĐ2 → ngăn soi | Cột giữ số lúc chốt; banner "Tổng chi tiết (…) khác cột Hoa hồng trên bảng lương (…) — kỳ đã chốt nên cột giữ số lúc chốt."; kỳ sau không tự trừ | SoiHoaHong.tsx:113 |
| HH09 | R | Phiếu thu lùi ngày vào kỳ đã chốt | T09 đã chốt; lập phiếu thu ngày 30/09 | Phải vào kỳ nào đó. Code nghi không kỳ nào trả (NL-HH02) | hoa_hong_service.py:109 |
| HH10 | R | Đơn huỷ sau khi thu cọc | Thu cọc → "Hủy đơn" → trả lại cọc → "Tính lại" | Không được tính hoa hồng trên cọc đã trả lại. Code nghi vẫn tính (NL-HH01) | hoa_hong_service.py:116 |

---

## 12. MH — Mua hàng

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| MH01 | C | Lưu đợt giao tự tạo yêu cầu nhập | Đơn mua → "Ghi đợt giao" → "Lưu đợt giao" | Chip "Kho chưa nhập" + mã DNN…, không có "Gửi kho"; kho nhận "🔔 Có yêu cầu kho mới … chờ lập phiếu" | purchase_service.py:3600 |
| MH02 | X | Thiếu ô "Ghi đợt giao" | Vai Mua hàng có Sửa, thiếu ô | Không thấy nút; gọi API 403 | PurchaseDetailDrawer.tsx:92 |
| MH03 | R | Sửa/xoá đợt trước và sau khi kho lập phiếu | Sửa SL; "Xoá" đợt; kho lập phiếu rồi thử sửa | Yêu cầu nhập đổi theo SL; hộp xoá "Yêu cầu nhập kho DNN… cũng bị huỷ theo."; sau đó "Kho đã lập phiếu, khoá sửa" | stock_request_service.py:244 |
| MH04 | R | Kho huỷ yêu cầu; dòng chưa có mã | Kho "Hủy yêu cầu"; đơn cũ có dòng không mã → Lưu đợt | Đợt về "Chờ gửi kho" và có "Gửi kho" | purchase_service.py:3573 |
| MH05 | R | Cột Định lượng | Tạo yêu cầu mua giấy từ Kế hoạch vật tư và từ Kho; một đơn chỉ vật tư | Cột "Định lượng" chỉ đọc ở form yêu cầu, ngăn yêu cầu, form đơn, hộp đợt giao; đơn chỉ vật tư không có cột | RequestFormDrawer.tsx:290 |

---

## 13. LU + KH — Nhân sự, khoán, Khoán theo tổ, lương khối sản xuất

Quy ước: L = "Lương ca máy" (lương vị trí + trách nhiệm + phụ cấp của người không thử việc).

### 13.1 Nhân sự: thử việc và điều chỉnh lương

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| LU01 | R | Hết thử việc giữa kỳ | Ngày hết thử việc 15/10 → mở danh sách Nhân sự | Tự sang "Hết thử việc" hiệu lực 16/10. Cả T10 vẫn hệ số thử việc + mặc định công nhật tới khi "Chuyển chính thức". Gợi ý ở hồ sơ lương phải nói đúng điều này (NL-LU01) | employee_service.py:974 |
| LU02 | C | Chuyển về thử việc | Hồ sơ "Đang làm việc" → "Chuyển về thử việc", ngày hết 31/12 | Trạng thái Thử việc; Quá trình công tác có "Chuyển về thử việc" | employee_service.py:913 |
| LU03 | X | Chuyển về thử việc sai ngày | Bốn biến thể (xem dưới bảng) | Xem dưới bảng | ActionDialog.tsx:50; employee_service.py:224,872-918 |
| LU04 | R | Chuyển về thử việc, hiệu lực quá khứ | Hiệu lực 01/10, ngày hết 20/10 → danh sách Nhân sự → Bảng lương T10 "Tính lại" | Hồ sơ thành "Hết thử việc"; T10 thử việc, công nhật ⇒ khoán 0; chip "thử việc" và "ăn công nhật" ở Khoán theo tổ | employee_service.py:994 |
| LU05 | R | Hiệu lực trước ngày vào làm / kỳ đã chốt | Chuyển về thử việc hiệu lực trước ngày vào làm; hoặc ngày thuộc kỳ đã chốt | Phải chặn. Code nghi không chặn (NL-LU02) | employee_service.py:913 |
| LU06 | C | Điều chỉnh lương | Bảng lương → sửa dòng → "Điều chỉnh lương (cộng, gõ âm để trừ)" −310.552 → Lưu | Gross giảm 310.552 (sàn 0); phiếu lương có dòng "Điều chỉnh lương"; "Tính lại" giữ số | LineEditModal.tsx:247; payroll_service.py:2846 |
| LU07 | R | Xoá trắng ô Điều chỉnh / Ghi chú | Xoá trắng ô Điều chỉnh → Lưu; xoá trắng Ghi chú → Lưu → mở lại | Ghi chú mất thật. Ô Điều chỉnh trắng thành 0 không hỏi lại (NL-LU03) | LineEditModal.tsx:247 |

Ca LU03, bốn biến thể và câu phải thấy:

| Biến thể | Câu phải thấy |
|---|---|
| (a) Bỏ trống ngày hết thử việc | "Chọn ngày hết thử việc." |
| (b) Ngày hết trước ngày hiệu lực | "Ngày hết thử việc không được trước ngày hiệu lực chuyển về thử việc." |
| (c) Ngày hiệu lực sau hôm nay | "Ngày hiệu lực không được sau hôm nay (25/10/2026) — máy áp thay đổi ngay lúc bấm, tới ngày đó hãy bấm." |
| (d) Gọi API khi hồ sơ đang Thử việc | "Không thể 'probation_restart' từ trạng thái hiện tại (probation)." |

### 13.2 Công thức khoán và lần ghi

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| KH01 | C | Ô công thức trống ⇒ 0đ | Công đoạn → tab Khoán, xoá trắng "Công thức khoán" → Lưu → ghi một lần | Lần ghi không hiện trong sổ Khoán theo tổ, khoán = 0 | khoan_ky.py:220,501 |
| KH02 | X | Chip chưa khai | Gõ `sl_ghi * abc` → Lưu | "Công thức khoán: Biến không xác định: abc" | thanh_phan_engine.py:452 |
| KH03 | X | Công thức chưa xong | Gõ `sl_ghi *` → Lưu | "Công thức khoán: câu “sl_ghi *” chưa viết xong hoặc sai cú pháp" | thanh_phan_engine.py:449 |
| KH04 | R | Chia 0 lọt lúc Lưu | `gia_co_dinh / (so_lan_chay - so_lan_thu_viec)`, mọi lần ghi có thợ thử việc | Lưu được. Lần ghi tiền 0 kèm "công thức khoán lỗi — Lỗi công thức: float division by zero"; cảnh báo trước chốt "N lần ghi sản lượng chưa có tiền khoán vì thiếu giá / công thức lỗi…" | khoan_ky.py:453; payroll.py:1189 |
| KH05 | R | Sản lượng không nhân đơn giá | Công thức `sl_ghi` | "Công đoạn X: công thức khoán có sản lượng mà không nhân Đơn giá khoán — sản lượng đang cộng như tiền đồng…" | khoan_ky.py:447 |
| KH06 | C | Chụp công thức vào lần ghi | Ghi lần 1 → đổi công thức thành `2*sl_ghi*don_gia_khoan` → ghi lần 2 | Lần 1 giữ số cũ, có chip "danh mục đổi" và dòng "Công thức của ‹công đoạn›"; lần 2 số mới | viec_khoan.py:348,486 |
| KH07 | C | Cập nhật theo danh mục | Mở lần 1 → "Xem thay đổi" → "Cập nhật theo danh mục" | Tiền theo công thức mới, băng mất | viec_khoan.py:543 |
| KH08 | R | Gỡ hết khoán của công đoạn | Gỡ cấu hình Khoán → mở lần ghi cũ | "‹tên› — đã xoá khỏi công đoạn", "Danh mục nay" ghi "đã gỡ khỏi danh mục", nút Cập nhật xám; lương "cấu hình Khoán của công đoạn đã bị gỡ" | viec_khoan.py:479 |
| KH09 | R | Gỡ tuỳ chọn, lần ghi cũ đã chụp | Bỏ tuỳ chọn T khỏi công thức → lần cũ "Cập nhật theo danh mục" | Tuỳ chọn còn khai giữ giá trị; mã mới = 0 | viec_khoan.py:557 |
| KH10 | C | Bậc giá Bài in theo số màu | Lệnh 4 màu, bậc 3–4 màu có giá tổ → ghi | Cột Công đoạn có tên bậc; tiền theo đơn giá bậc | viec_khoan.py:136 |
| KH11 | X | Lệnh AB không chọn mặt | In 2 mặt khác nhau → ghi, không chọn mặt | "Lệnh in hai mặt khác nhau (AB): chọn mặt A hay mặt B cho lần ghi này." | viec_khoan.py:333 |
| KH12 | R | Số màu không khớp bậc | Lệnh 8 màu → ghi | Ghi được; lương "lệnh 8 màu chưa khớp bậc giá nào" | viec_khoan.py:181 |
| KH13 | R | Tổ chưa có giá bậc | Bỏ trống ô (tổ, bậc) → ghi | "tổ chưa có giá bậc ‹Tên› (lệnh 4 màu)" | khoan_ky.py:421 |
| KH14 | C | so_lan_chay | `gia_co_dinh / so_lan_chay`, giá 300.000, 3 lần cùng lệnh cùng công đoạn trong tháng | Mỗi lần 100.000 | khoan_ky.py:249 |
| KH15 | R | so_lan_chay rải hai tháng | 2 lần T09, 1 lần T10 | T09 mỗi lần 150.000; T10 lần mới 100.000 (đếm 3) ⇒ cả lệnh 400.000. Ghi nhận, cần chủ xác nhận | khoan_ky.py:250-271 |
| KH16 | C | so_lan_thu_viec | 3 lần, 1 lần có thợ thử việc | Mỗi lần 300.000/2 = 150.000 | khoan_ky.py:283 |
| KH17 | C | chay_tiep cùng ngày | Cùng máy ghi liền hai lần cùng công việc, cùng ngày; `if(chay_tiep, 0, gia_co_dinh)` | Lần 2 = 0 | khoan_ky.py:315 |
| KH18 | R | chay_tiep qua đêm | Lần 1 bắt đầu 22:00 ngày 30/09, lần 2 bắt đầu 00:30 ngày 01/10 | Lần 2 chay_tiep = 0, tức ăn giá lên bài | khoan_ky.py:325 |
| KH19 | R | Lần ghi qua nửa đêm, qua tháng | Bắt đầu 30/09 22:00, kết thúc 01/10 02:00, chip tien_gio | Thuộc kỳ T09, ngày 30/09; giờ = 4 | khoan_ky.py:347 |
| KH20 | C | tien_gio | A nền 7.800.000, B 5.200.000, 4 giờ | (7,8tr + 5,2tr) ÷ 26 ÷ 8 × 4 = 250.000 | khoan_ky.py:444 |
| KH21 | R | Giờ kết thúc = giờ bắt đầu | Sửa số cho kết thúc = bắt đầu | "công thức tính theo giờ mà lần ghi chưa có giờ kết thúc", không vào sổ | khoan_ky.py:426 |
| KH22 | C | tu_tro | Lệnh in tự trở, `if(tu_tro, 2, 1)*sl_ghi*don_gia_khoan` | Hệ số 2 | khoan_ky.py:229 |
| KH23 | C | Chia theo lương ca máy | Lần ghi 1.000.000; A 8tr, B 6tr, C 6tr | A 400.000, B 300.000, C 300.000; bóng % "lương bù lỗ 8.000.000 ÷ (…) = 40%" | khoan_ky.py:512 |
| KH24 | X | Người chưa có lương ca máy | Tick người không có hồ sơ lương | "‹Tên› chưa có lương ca máy", lần ghi không chia | khoan_ky.py:409 |
| KH25 | X | Không tick người | Ghi không người | "chưa tick người làm" | khoan_ky.py:406 |
| KH26 | R | Người ăn công nhật | B chọn "Công nhật" ở "Cách trả lương" | B vẫn trong tỷ lệ chia; "0 / công nhật về 0"; đối chiếu "− phần công nhật không hưởng"; A, C không tăng | payroll_service.py:1687 |
| KH27 | C | Việc phát sinh có "Cách tính giá" | PS "Xuống bài" `0.5*gia_co_dinh`, số lượng 2, giá cố định 200.000 | +200.000 | khoan_ky.py:471 |
| KH28 | R | PS có công thức khi thiếu giá chính | KH13 + PS có công thức | 'việc phát sinh "X" tính theo công thức mà lần ghi chưa có giá' | khoan_ky.py:477 |
| KH29 | X | PS số lượng ≤ 0 | PS số lượng 0 | 'Số lượng của "X" phải lớn hơn 0.' | viec_khoan.py:368 |
| KH30 | R | Đổi Cách tính giá PS sau ghi | Sửa công thức PS → mở lần ghi | Băng "Cách tính giá của ‹PS›" | viec_khoan.py:497 |
| KH31 | C | CN trùng lễ, tổ thường | Lần ghi 500.000 vào CN là lễ | Cột Tiền 1.000.000 (+ "× 2"); "Chủ nhật trùng lễ — sản lượng ×2"; quỹ chỉ tiêu ngày dùng 500.000 | khoan_ky.py:508 |
| KH32 | R | Tổ in ngày CN / lễ | Tổ có cờ tổ in, ghi ngày CN | Tiền gạch ngang, quỹ 0; "tổ in ngày Chủ nhật / lễ — ngày đó ăn công…" | khoan_ky.py:505 |
| KH33 | C | Tăng ca khoán | Chỉ tiêu 1.500.000, tổ làm 2.000.000/ngày | "tăng ca khoán 250.000" = 50% × 500.000, chia theo phần; không vào phép so | khoan_ky.py:609 |
| KH34 | R | Tổ con chưa khai chỉ tiêu | Chỉ tổ cha khai | Tổ con ăn chỉ tiêu tổ cha | khoan_ky.py:598 |
| KH35 | C | Tổ trưởng ăn chia 10% | KH23 + mốc chia 10% | A 360.000, B 270.000, C 270.000; tổ trưởng +100.000 dù không làm | khoan_ky.py:721 |
| KH36 | C | Tổ trưởng ăn thưởng 10% | Đổi chế độ sang thưởng | Không ai bị trừ; tổ trưởng +100.000; "+ tổ trưởng thưởng công ty trả" | khoan_ky.py:728 |
| KH37 | X | Đầu tổ không có hồ sơ | Đầu tổ là tài khoản không có hồ sơ nhân viên | "Tổ X khai tổ trưởng ăn chia 10% nhưng chưa có người đứng đầu tổ có hồ sơ nhân viên — chưa trích." | khoan_ky.py:706 |
| KH38 | R | Đổi tỷ lệ tổ trưởng giữa kỳ | 10% từ 01/10, 15% từ 20/10 | Cả tháng 15% (mốc ngày cuối kỳ) | khoan_ky_repo.py:223 |
| KH39 | C | Dừng máy | 1 ngày dừng, chỉ tiêu 1.500.000, tick A, B | Chia 1.500.000 theo L; không vào quỹ tổ trưởng | khoan_ky.py:628 |
| KH40 | C | Khoán vào bảng lương (P9) | Bảng lương → "Tính lại" | Cột "Khoán SP" = Lương khoán ở Khoán theo tổ (người ăn khoán) | payroll_service.py:2240 |

### 13.3 Khoán theo tổ: sửa tay của kế toán

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| KH41 | C | Gõ đè tiền lần ghi | Ô Tiền → gõ 450.000 → Enter | Tam giác đỏ, số máy gạch dưới, rê "Kế toán gõ"; chia lại theo L | KhoanTheoToTab.tsx:149,563 |
| KH42 | C | Trả về số máy | Ô đã gõ → Delete, hoặc chuột phải "Trả về số máy" | Mất tam giác, về số máy | KhoanGoTay.tsx:150 |
| KH43 | R | Gõ đúng số máy | Gõ lại số đang gạch | Coi như bỏ số tay | KhoanTheoToTab.tsx:569 |
| KH44 | X | Tiền âm | Gõ -50000 | "Tiền phải là số, không âm." | KhoanTheoToTab.tsx:530 |
| KH45 | R | Gõ đè lần ghi thiếu giá | KH13 → gõ 300.000 | Lần ghi ra tiền; cảnh báo thiếu giá mất khỏi câu chốt | khoan_ky.py:499 |
| KH46 | R | Đổi danh mục sau gõ đè | KH41 → đổi giá → "Cập nhật theo danh mục" | Tiền vẫn 450.000; số máy gạch đổi theo giá mới | khoan_ky.py:494 |
| KH47 | R | Gõ đè lần ghi tổ in ngày CN | KH32 → gõ 400.000 | Vẫn gạch, quỹ +0 | khoan_ky.py:506 |
| KH48 | C | Thêm dòng tay | Dòng trống cuối sổ, Tiền 200000 → Enter | Ngày = hôm nay (kỳ hiện tại) hoặc ngày cuối kỳ; mặc định cả tổ (L > 0); chia theo L; Quỹ có "+ Dòng tay" | KhoanTheoToTab.tsx:536 |
| KH49 | X | Dòng tay ngoài tháng | Ngày "05/11" khi xem T10; "31" ở tháng 30 ngày | "Ngày phải nằm trong tháng 10/2026." | KhoanGoTay.tsx:47 |
| KH50 | X | Dòng tay không người | Tổ không ai có L > 0 → gõ dòng mới; bỏ tick người cuối | "Tổ chưa có ai có lương ca máy để chia dòng tay." / ô tick không cho bỏ người cuối | KhoanTheoToTab.tsx:557 |
| KH51 | R | Người trong dòng tay mất L | Gỡ hồ sơ lương người đã tick | Chữ đỏ "‹Tên› chưa có lương ca máy", không chia. Xem câu ở cảnh báo trước chốt (NL-KH09) | khoan_ky.py:557 |
| KH52 | C | Cộng thêm âm/dương/xoá | Cột Cộng thêm "−50.000" → Enter; rồi Delete | Số đỏ âm, vào bảng lương ngoài phép so; Delete (hoặc 0) bỏ dòng. Xem bảng lương có cột nào hiện số này (NL-KH08) | KhoanTheoToTab.tsx:600 |
| KH53 | X | Cộng thêm gõ chữ | Gõ "abc" | "Cộng thêm phải là số (gõ số âm để trừ)." | KhoanTheoToTab.tsx:601 |
| KH54 | X | Kỳ đã chốt | Chốt T09 → Khoán theo tổ T09 | Ô chỉ đọc + "Kỳ lương 09/2026 đã chốt nên không sửa tay được."; API 409 "Kỳ lương tháng 09/2026 đã chốt/đã chi — không sửa khoán được." | khoan_sua_tay.py:57 |
| KH55 | R | Kỳ chưa tạo bảng lương | Xem kỳ chưa "Khởi tạo bảng lương" | Sửa tay được; banner "Kỳ 10/2026 chưa tạo bảng lương nên chưa có phân bổ lương bù lỗ và lương chính…" | KhoanTheoToTab.tsx:726 |
| KH56 | R | Tính lại giữ số tay | Gõ đè + dòng tay + cộng thêm → "Tính lại" 2 lần | Số giữ nguyên; "Điều chỉnh lương" giữ nguyên | payroll_service.py:2245 |
| KH57 | R | Sửa tay chưa vào bảng lương | Gõ đè xong sang Bảng lương, chưa "Tính lại" | Cột Khoán SP còn số cũ tới khi Tính lại | khoan_sua_tay.py:10 |
| KH58 | X | Phạm vi quyền | Vai phạm vi tổ, tổ có người tổ khác được tick (hoặc chọn tổ khác) | 403 "Tổ này có người ngoài phạm vi quản lý của bạn."; sửa tay: "Có người ngoài phạm vi quản lý của bạn." Thêm: mở màn lần đầu có dính 403 ngay không (NL-KH06) | khoan_theo_to.py:105 |
| KH59 | X | Không quyền xem / sửa | Thiếu `luong:view_payroll_table` / thiếu `luong:update` | Tab ẩn / ô chỉ đọc | payroll.py:1561 |
| KH60 | R | Người chuyển tổ giữa kỳ | A tổ X 1–15, sang tổ Y ngày 16 → xem tổ X | Ở X: A cuối bảng chia, có tên tổ Y, "lương chính tính ở tổ của họ"; ở Y: phần ở X vào "Ở tổ khác". Thêm: xem tháng cũ sau khi chuyển, và cộng thêm gõ ở tổ cũ (NL-KH04) | khoan_theo_to.py:79 |
| KH61 | C | Khoán km tài xế | Chuyến 100 km × 5.000, phụ xe 70/30; đi một mình | Tài xế 350.000, phụ 150.000; một mình 500.000 | khoan_km_service.py:81 |
| KH62 | R | Chuyến xe kết thúc rạng sáng mùng 1 | Chuyến kết thúc 01/10 05:00 giờ VN | Phải thuộc kỳ T10. Code nghi rơi vào T09 (NL-KH01) | khoan_km_service.py:54 |
| KH63 | R | Gõ lại ô CN trùng lễ | KH31 → mở ô Tiền, gõ lại đúng số đang thấy (1.000.000) → Enter | Phải giữ 1.000.000. Code nghi thành 2.000.000 (NL-KH02) | KhoanTheoToTab.tsx:150 |
| KH64 | R | Công thức ra âm | `sl_ghi - 3000` với sl_ghi 2.000 | Phải kẹp về 0 hoặc cảnh báo. Code nghi ra tiền âm (NL-KH05) | khoan_ky.py:454 |
| KH65 | R | Tổ trưởng lồng nhau | Hai mốc chia ở tổ cha và tổ con | Số không phụ thuộc thứ tự mốc (NL-KH07) | khoan_ky.py:694 |

---

## 14. OO — Đối chiếu chéo cuối luồng

Bổ sung cho mục O của bản cũ. Lấy đúng chứng từ đã tạo ở trên.

| Mã | Đối chiếu | Phải khớp |
|---|---|---|
| OO01 | Kg giấy LSX-A | Kg ở bước CGC (làm tròn lên 0,01) = số kho đề nghị = phiếu xuất = tồn giảm. Bảng cân đối không còn lẻ gam |
| OO02 | Tờ giấy nhập kg | Số tờ vào tồn = làm tròn xuống (kg ÷ kg/tờ theo khổ thực nhận). Báo cáo kho NXT khớp |
| OO03 | Vật tư tự lập | Số yêu cầu tự lập của từng bước = công thức lượng (gồm hao). Sau khi kho chốt thiếu, chip và "Thực dùng" khớp phiếu |
| OO04 | Khoán theo tổ ↔ Bảng lương | Σ "Lương khoán" từng người ở mọi tổ = cột "Khoán SP" sau "Tính lại". Quỹ tổ = Σ lần ghi + dòng tay + dừng máy. Phần tổ trưởng khớp mốc |
| OO05 | Ghi sản lượng ↔ sổ khoán | Mỗi lần ghi ở bàn tổ có đúng một dòng ở sổ Khoán theo tổ (trừ lần ghi tiền 0 / bị chặn có lý do). Ngày dừng máy = dòng "Dừng máy" |
| OO06 | CK và kê | Σ CK các hoá đơn = CK dòng báo giá = CK dòng đơn (500.000). Σ kê = 1.000.000. Thuế TNDN = 20% kê. Báo cáo kinh doanh 6 cột mới khớp. Báo cáo thu chi: mục chi CK, chi kê = tổng phiếu chi |
| OO07 | Công nợ E2E-KE | Hoá đơn − cọc trừ − thu + trả lại ngoài đơn = còn nợ, ở Công nợ phải thu, Sao kê, Báo cáo kinh doanh. Sau mỗi huỷ (HD13, HD14) vẫn khớp |
| OO08 | Hoa hồng | Σ gốc = doanh thu thực 9.500.000. Σ hoa hồng ngăn soi = cột Hoa hồng. Mỗi phiếu thu một dòng, đúng kỳ theo ngày thu |
| OO09 | Mua hàng ↔ kho | Mỗi đợt giao đã lưu có đúng một yêu cầu nhập sống. Xoá đợt thì yêu cầu huỷ. Công nợ phải trả theo đợt |
| OO10 | Nhật ký | Thao tác mới có dòng, đúng người, nhãn tiếng Việt: đổi nguồn giấy, tự lập/huỷ yêu cầu xuất, sửa tay khoán, cộng thêm, điều chỉnh lương, chuyển về thử việc, báo/sửa/xoá dừng máy, đặt % riêng hoa hồng |
| OO11 | Hồi quy T08 | Chạy lại script đối chiếu T08 trên bản sao: 0 dòng lệch, tổng chênh 2đ. Script chỉ đọc, không phải thao tác UI, ghi rõ là đi tắt |

---

## 15. Ca ngang: tức thời, quyền, đua, ranh giới ngày, điện thoại

Phần lớn đã có ở các mục trên. Bảng này gom lại để chạy theo chủ đề, kèm vài ca chưa có ở đâu.

| Mã | Chủ đề | Ca |
|---|---|---|
| RT01 | Tức thời | VT01, VT12, VT15, VT19, MT09, DM01–DM03, SL02, SL08, BG17, HD06, MH01: người nhận thấy badge/toast trong vài giây, KHÔNG F5 |
| RT02 | Tức thời | Hai kế toán mở cùng tổ ở Khoán theo tổ. Người 1 gõ đè một ô thì màn người 2 tự nạp, không mất ô người 2 đang gõ dở |
| RT03 | Tức thời | Tab mở lâu: backend khởi động lại giữa chừng thì toast vẫn tới sau khi SSE nối lại, không phải tải lại trang |
| QN01 | Quyền | GS39, MT08, DM04, DM05, SL12, KH58, KH59, MH02, BG19 |
| QN02 | Quyền | Kế toán chỉ xem: mở Khoán theo tổ, Bảng lương, ngăn soi hoa hồng, Báo cáo kinh doanh. Không thấy nút sửa nào; nút đã ẩn thì gọi API phải 403 |
| QN03 | Quyền | Tiền chỉ người có quyền xem: vai không có xem giá vốn mở hồ sơ lệnh, Kế hoạch vật tư, Khoán theo tổ. Không lộ cột tiền ở máy chủ (xem JSON trả về) |
| DUA01 | Đua | VT (thu hồi đua ghi sổ): kho bấm ghi sổ đúng lúc kế hoạch bấm "Thu hồi". Chỉ một trong hai kết quả; không có phiếu ghi sổ dưới yêu cầu đã huỷ (vat_tu_tu_lap.py:216-244) |
| DUA02 | Đua | DM11, DM15, CO10 |
| DUA03 | Đua | Hai người cùng bấm "Bắt đầu" một việc, cùng phiên bản. Chỉ một phiên chạy (NL-SL03) |
| DUA04 | Đua | Hai người báo hư cùng một máy cùng lúc, không tick lương. Chỉ một yêu cầu sửa (NL-DM06) |
| DUA05 | Đua | Hai kế toán cùng gõ đè một ô khoán. Số sau cùng thắng, nhật ký có cả hai lần |
| NG01 | Ranh giới ngày | KH15, KH18, KH19, KH62, HH04, HH05, HH09 |
| NG02 | Ranh giới ngày | Ngày xưởng khác ngày máy khách: máy khách đặt múi giờ UTC, mở hộp Báo dừng máy lúc 00:30 giờ VN. Ô ngày có cho chọn hôm nay theo xưởng không (NL-DM07) |
| NG03 | Ranh giới ngày | Kỳ đã chốt chặn đủ đường: KH54, DM12, HH07, HD18. Và những đường code nghi CHƯA chặn: "Cập nhật theo danh mục" và "Sửa số" lần ghi thuộc kỳ đã chốt (NL-KH03), chuyển về thử việc ngày thuộc kỳ đã chốt (LU05) |
| NG04 | Ranh giới ngày | Ô ngày giờ gõ năm 6 chữ số ở hộp Ghi sản lượng, dòng tay khoán, phiếu thu: bị chặn |
| DT01 | Điện thoại 375px | Bàn tổ: danh sách việc, "Bắt đầu", "Ghi sản lượng", "Báo dừng máy", "Đổi máy". Nút đủ to, không tràn ngang, không có thao tác chỉ hiện khi rê chuột |
| DT02 | Điện thoại 375px | Chấm công GPS và phiếu lương cá nhân |

---

## 16. Nghi lỗi đọc từ code — chờ xác nhận bằng thao tác thật

Mức độ:
- **Nặng:** sai tiền, sai kho, hỏng dữ liệu hoặc chặn mất việc.
- **Vừa:** sai luật nhưng có đường vòng.
- **Nhẹ:** chữ hoặc hiển thị.

Cột "Ca" là ca sẽ xác nhận lỗi đó.

### Nặng

| Mã | Nghi lỗi | Code | Ca |
|---|---|---|---|
| NL-GS01 | Đổi Nguồn giấy không chặn lệnh Đã phát hành / Đã đóng / trọn gói. Gỡ CGC/TGI đã có yêu cầu xuất, đã xuất kho hoặc đang chạy; trạng thái bị ép về Chờ bổ sung | lsx_service.py:3360-3374, 2525-2561; LsxDetailView.tsx:1641 | GS36–GS38 |
| NL-GS02 | ĐÃ SỬA 5ea5c31d (chặn đổi nguồn khi lệnh trong bài ghép). Còn kiểm: ô có xám trên giao diện khi bài đang giữ chỗ | lsx_service.py | GS51 |
| NL-GS10 | Thiếu migration 0444 "lô giấy tờ kg → tờ" (spec §5 có ghi). Lô cũ không hiện khi chọn nguồn và trong hộp Chọn giấy | kho_giay.py:63; db_migrations.py | GS58 |
| NL-GS05 | ĐÃ SỬA 5ea5c31d (giấy giữ ở bước đầu). Bấm lại GS26 | lsx_service.py | GS26 |
| NL-GS07 | Chọn nguồn so tồn với số chưa cộng hao Tề/Cắt, trong khi số xin kho đã cộng hao. Chọn nguồn "đủ" rồi báo thiếu | chuan_bi_giay.py:50, 89-118 | GS19 |
| NL-GS14 | Sửa routing cho xoá hoặc chèn tay CGC/TGI. Mất dòng giấy hoặc ra hai TGI, nguồn giữ giá trị cũ | lsx_service.py:3511 | GS31 |
| NL-VT02 | Thu hồi khi kho đã xuất một phần: yêu cầu giữ trạng thái xuất một phần, kho vẫn xuất tiếp cho lệnh không còn dưới xưởng; không phát hành lại thì treo mãi | vat_tu_tu_lap.py:243 | VT21 |
| NL-DM02 | Báo lại máy có phiếu mở, tick "Máy đang dừng", không dựng cờ dừng. Việc khác vẫn Bắt đầu được trên máy | dung_may.py:279; may_trang_thai.py:246; thuc_thi.py:299 | DM03 |
| NL-DM03 | Tick "Máy đang dừng" mà thiếu quyền Thực hiện lệnh thì 403 và rollback cả lần báo hỏng, hộp không báo trước | dung_may.py:281-313; thuc_thi.py:363 | DM04 |
| NL-DM01 | `may_cua_to` chỉ suy từ lịch sử việc, bỏ qua bảng Tổ đứng máy. Dòng ngày dừng gắn phiếu không sửa được; máy đã chuyển tổ vẫn tính tổ cũ | dung_may_repo.py:79-85; dung_may.py:76,185,291 | DM21 |
| NL-KH02 | Ô Tiền ngày CN trùng lễ hiện số ×2 nhưng mở ra là ×1. Gõ lại số đang thấy thành ×4 | KhoanTheoToTab.tsx:150-152 | KH63 |
| NL-KH03 | "Cập nhật theo danh mục" và "Sửa số" (cả đổi tuỳ chọn) không hỏi kỳ lương đã chốt, chỉ dừng máy bị khoá. Số khoán của kỳ đã chốt đổi sau chốt | viec_khoan.py:524; san_luong.py:398-534 | NG03 |
| NL-KH04 | Thành viên tổ lấy theo tổ HIỆN TẠI. Xem tháng cũ sai tổ; cộng thêm gõ ở tổ cũ bị ẩn nhưng vẫn cộng vào lương | khoan_ky_repo.py:247; khoan_ky.py:747 | KH60 |
| NL-KH05 | Công thức ra số âm không kẹp về 0 | khoan_ky.py:454,481 | KH64 |
| NL-KH10 | Số gõ tay vào lần ghi bị chặn trước (không người, thiếu L, thiếu giờ kết thúc) im lặng không ăn | khoan_ky.py:403-428 | KH24 + gõ đè |
| NL-KH01 | Kỳ khoán km tính theo nửa đêm UTC. Chuyến kết thúc 00:00–06:59 sáng mùng 1 rơi vào kỳ trước | khoan_km_service.py:54-60,103 | KH62 |
| NL-HH01 | Hoa hồng không lọc đơn huỷ, không trừ tiền trả lại. Vẫn trả trên cọc đơn huỷ và trên phần cọc thu dư | hoa_hong_service.py:116 | HH10 |
| NL-HH02 | Phiếu thu lùi ngày vào kỳ lương đã chốt thì hoa hồng mất hẳn | hoa_hong_service.py:109; KhungFormPhieu.tsx:45 | HH09 |
| NL-HD01 | Huỷ phiếu thu không xét CK/kê đã chi. Hoá đơn còn nợ lại trong khi CK đã trả | accounting_service.py:3221 | HD15 |
| NL-CO02 | Tab "Số" gõ 0 không xoá % cọc cũ | order_service.py:703; DonHangBanPage.tsx:1885 | CO04 |
| NL-CO01 | Ô % cọc chỉ nhận chữ số: "12,5" thành 100 | DonHangBanPage.tsx:1921 | CO06 |

### Vừa

| Mã | Nghi lỗi | Code | Ca |
|---|---|---|---|
| NL-GS03 | Tuyến tự khai: chọn nguồn bị nuốt im lặng, nhật ký vẫn ghi đã đổi, ô vẫn hiện lựa chọn | lsx_service.py:2445,2556 | GS47 |
| NL-GS04 | "Thiếu khổ nguyên" bật cho mọi lệnh có nguồn, kể cả "Tờ đúng khổ in"; màn lệnh không sửa được khổ nguyên nên kẹt Sẵn sàng | lsx_service.py:1846 | GS24 + nguồn tờ khổ in |
| NL-GS06 | Sóng không có giấy: dòng sóng mang loại giấy nên `thieu_giay` không bật | lsx_service.py:1839 | GS14 |
| NL-GS08 | SL vào In = 0 thì luôn chọn tờ khổ in dù kho trống | chuan_bi_giay.py:85 | GS18 biến thể |
| NL-GS09 | Khổ lẻ: một chỗ cắt `int()`, chỗ khác làm tròn ⇒ khoá tồn lệch 1 mm | lsx_service.py:2381; kho_giay.py:21 | GS16 |
| NL-GS12 | Trọn gói: chỉ một dòng giấy, lệnh có sóng không được cấp sóng. (Vế dấu chấm ĐÃ SỬA 5ea5c31d) | tron_goi.py:243 | GS62 |
| NL-GS13 | Bài ghép lấy khổ nguyên, gsm theo thành viên đầu; rộng cuộn áp lệnh khác khổ không kiểm | bien_cong_thuc.py:572; chuan_bi_giay.py:54 | GS50 |
| NL-GS15 | Danh mục không chặn đổi Loại Giấy ↔ Sóng của mã đang dùng; phiếu/lệnh cũ lưu lại ra 422 | ptg_giay_buoc.py:119 | GS10 |
| NL-GS16 | Giấy cũ có ĐVT ram/tấn có thể không sửa được qua giao diện | vat_lieu_kho_service.py:262 | Sửa một giấy cũ ĐVT ram |
| NL-MT01 | Đổi tổ ở bước loại Tổ không xuống bàn mới; khoá "việc đã bắt đầu" chỉ áp khi có bước máy | release_update.py:397; lsx_service.py:3634 | MT13 |
| NL-VT01 | Đổi tổ qua phát hành cập nhật, yêu cầu tự lập vẫn đứng tên tổ cũ; tin thủ kho theo tổ cũ, chuông phản hồi vào tổ mới | vat_tu_tu_lap.py:154; stock_request_service.py:724,779 | MT09 + VT25 |
| NL-DM04 | Máy thuộc nhiều tổ: chỉ tạm dừng việc của tổ báo | dung_may.py:254 | DM20 |
| NL-DM05 | Không chặn ngày CN/lễ ở dừng máy, mà lương trả trọn chỉ tiêu. Cần chủ chốt | dung_may.py:190; khoan_ky.py:634 | DM19 |
| NL-DM06 | Đua báo hư cùng máy ra 2 yêu cầu sửa | dung_may.py:264; ky_thuat_may_service.py:551 | DUA04 |
| NL-DM09 | Tổ không có máy không lưu được ngày dừng "Máy hư" HÔM NAY chỉ để tính lương | BaoDungMayModal.tsx:132 | DM06 biến thể |
| NL-SL02 | "Sửa số" chụp lại tuỳ chọn theo khai hiện tại, mất giá trị cũ | san_luong.py:454 | SL13 |
| NL-SL03 | "Bắt đầu" không khoá dòng công việc, hai người bấm cùng lúc có thể ra 2 phiên | thuc_thi.py:241 | DUA03 |
| NL-KH06 | Ô chọn tổ lấy tổ đầu theo tên, người phạm vi tổ mở màn dính 403 ngay | khoan_theo_to.py:64 | KH58 |
| NL-KH07 | Tổ trưởng ăn chia lồng nhau ra số phụ thuộc thứ tự mốc | khoan_ky.py:694 | KH65 |
| NL-KH08 | Bảng lương không có cột "Cộng thêm khoán", cộng các cột không ra gross | BangLuongTab.tsx:202 | KH52 |
| NL-KH09 | Dòng tay thiếu L rơi vào câu "lần ghi / ngày dừng máy" ở cảnh báo trước chốt | payroll.py:1189 | KH51 |
| NL-KH11 | Màn Khoán theo tổ và ngăn soi tính lại số sống cả với kỳ đã chốt, lệch dòng lương đã chốt | khoan_theo_to.py:58; payroll_service.py:2689 | KH54 |
| NL-HH03 | Ngăn soi hoa hồng kỳ đã chốt đọc số sống, không có bản chụp để đối sổ | payroll_service.py:2582 | HH08 |
| NL-LU02 | Chuyển về thử việc không chặn ngày trước ngày vào làm, không hỏi kỳ đã chốt; gợi ý còn khuyên chọn ngày vào làm | employee_service.py:913; ActionDialog.tsx:142 | LU05 |
| NL-LU03 | Ô "Điều chỉnh lương" xoá trắng thành 0, xoá khoản điều chỉnh không hỏi | LineEditModal.tsx:247 | LU07 |
| NL-BG01 | Rào kê không chừa biên làm tròn như rào CK; gõ đúng trần vẫn bị bắt duyệt | exception_gate.py:147 | BG11 |
| NL-BG02 | Làm tròn ,5: máy chủ `round()` (về số chẵn), màn `Math.round`. Số lúc gõ lệch 1 đ số đã lưu; ảnh hưởng cả thuế TNDN | quotation_service.py:548,562; chi_ck_ke.py:69 | BG05 |
| NL-BG03 | Kiểm bản duyệt còn hiệu lực không xét kê/CK từng sản phẩm | exception_gate.py:183 | BG20 |
| NL-HD02 | Phiếu chi CK/kê lọt khoá kỳ công nợ. Cần chủ chốt có cố ý không | cong_no_khoa_ky.py:39 | HD19 |
| NL-CO03 | P7: lối lẻ cho thu dư cọc, lối gộp chặn | LapPhieuThuGop.tsx:138 | CO07 |

### Nhẹ

| Mã | Nghi lỗi | Code | Ca |
|---|---|---|---|
| NL-GS11 | Ô rộng cuộn: đang Cuộn không đổi được rộng; nuốt dấu phẩy | ONguonGiay.tsx:55,77 | GS40, GS42 |
| NL-GS17 | Phiếu nhập dòng tờ khai kg, khổ thực nhận một cạnh: dòng gợi ý ẩn lặng lẽ, máy chủ báo lỗi đơn vị khó hiểu | KhoYeuCauPage.tsx:2414 | GS56 |
| NL-DM07 | Ô ngày hộp Báo dừng máy lấy `max` theo ngày máy khách, không theo xưởng | BaoDungMayModal.tsx:233 | NG02 |
| NL-DM08 | Băng khoá luôn ghi "đã chốt" kể cả kỳ "đã chi" | BaoDungMayModal.tsx:241 | DM12 |
| NL-LU01 | Gợi ý ở hồ sơ lương nói "Hết thử việc tự về Lương khoán", thực tế vẫn công nhật tới khi Chuyển chính thức | SalaryModal.tsx:729 | LU01 |
| NL-HD03 | Câu lỗi máy chủ in số kiểu "188,000 đ" | accounting_service.py:1709,2079,2922,3023 | HD07, HD09 |

Các điểm cần chủ chốt trước khi coi là lỗi: DM19 (dừng máy ngày CN), BG18 (người duyệt phạm vi Phòng),
BG19 (giá vốn ở báo giá), HD19 (phiếu chi CK trong kỳ khoá), KH15 (so_lan_chay rải hai tháng).

---

## Không kiểm

Giữ danh sách "Không có trên giao diện" của bản cũ. Thêm:
- **Khoán km tài xế:** chỉ kiểm qua KH61, KH62, không dựng thêm chuyến.
- **Đối chiếu sổ T08 đầy đủ:** chỉ chạy lại bằng script ở OO11, không bấm lại 76 dòng gõ đè.

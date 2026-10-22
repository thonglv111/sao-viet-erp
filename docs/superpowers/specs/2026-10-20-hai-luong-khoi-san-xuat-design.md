# Hai lương cho khối Sản xuất — bỏ công tắc Lương khoán và Tăng ca

Trạng thái: CHỐT THIẾT KẾ 20/10/2026, CHƯA CODE (chờ "làm đi").

## Chốt của chủ

1. Cứ thuộc **khối Sản xuất** (cờ `la_san_xuat`, kế thừa xuống cây tổ) là tính **2 lương**, ăn bên lớn
   hơn. Không phân biệt tổ lá / tổ cha, không còn công tắc theo tổ.
2. Bỏ hai công tắc ở Lương → Cấu hình lương → Cơ chế lương theo bộ phận:
   - **Lương khoán / sản lượng** — thay bằng luật 1.
   - **Tăng ca** — mọi tổ đều được trả tăng ca. Hiện không tổ nào tắt (bảng
     `department_salary_components` không có dòng `tang_ca` nào) ⇒ bỏ đi không đổi đồng nào.
   - Giữ **Chuyên cần**.
3. Không có tổ "Xe nâng" trong Sản xuất (đã gỡ trên DB dev).

## Cách tính mỗi người khối Sản xuất, mỗi tháng

Hai vế, so MỘT lần cho cả tháng:

- **Lương thời gian** = (vị trí + trách nhiệm + phụ cấp) ÷ 26 × công
  \+ tiền giờ tăng ca = (vị trí + trách nhiệm) ÷ 26 ÷ 8 × giờ × hệ số (1,5 / 2 / 3)
  \+ phụ cấp tăng ca đêm.
  Tính y như người công nhật hiện nay.
- **Lương khoán** = tiền sản lượng chia cho người đó (màn Khoán theo kỳ)
  \+ 50% phần vượt chỉ tiêu ngày. Không có tiền giờ tăng ca — giờ làm thêm đã vào quỹ chia
  (sổ T08: giờ chia = (NC + CN) × 8 + TC; cột "Ngoài giờ/Tăng ca" của dòng sản lượng = 0).

Ăn vế lớn hơn. Cộng NGOÀI phép so cho cả hai: phần thêm ngày CN / lễ, cơm (cơm ca, cơm tăng ca,
cơm CN), chuyên cần, thưởng.

Lý do tăng ca nằm TRONG vế thời gian: cộng ngoài phép so thì người thắng vế khoán được trả giờ làm
thêm hai lần (qua quỹ chia và theo giờ). Người công nhật trong khối có vế khoán = 0 nên luôn ăn vế
thời gian, đủ tăng ca — khớp sổ (Hồng Châu 71,5 giờ ⇒ 3.403.125 đ).

Ví dụ (26 công):

| | Thời gian | Khoán | Ăn |
|---|---|---|---|
| Quí (dán), 10 giờ TC | 10.000.000 + 432.692 | 15.974.665 | khoán |
| Quí, tháng ít hàng | 10.432.692 | 8.000.000 | thời gian (có TC) |
| Hồng Châu, 71,5 giờ TC | 11.000.000 + 3.403.125 | 0 | thời gian |

## Giữ nguyên

- Cờ **Tổ in** (đích danh, không kế thừa): CN/lễ bỏ sản lượng ngày đó, ăn 2 / 3 / 5 công.
- Cờ **Giao hàng**: vế khoán = tiền km (60/40 tài xế / phụ xe). Tổ Giao hàng không thuộc khối SX.
- Thử việc ở khối SX: khoán = 0, ăn vế thời gian.

## Nghỉ phép có lương (chủ chọn cách A, 20/10/2026)

- Ngày phép có lương là một CÔNG trong vế thời gian, như người công nhật ⇒ gỡ chặn ở
  `leave_service` (đảo chốt khách 15/09/2026 "người khoán không nghỉ phép có lương") và bỏ dòng trừ
  `cong_phep_tra` khỏi công đem so.
- Người thắng vế khoán thì ngày phép không ra thêm tiền tháng đó. Chủ: "thường cuối năm sẽ trả lại
  tiền nghỉ" — việc trả tiền phép cuối năm làm NGOÀI hệ thống, chủ chốt KHÔNG làm chức năng này.
- Ví dụ Quí (1 công 384.615), 24 ngày làm + 2 ngày phép: vế thời gian 26 công = 10.000.000; khoán
  15tr ⇒ ăn 15tr; khoán 8tr ⇒ ăn 10tr (gồm 2 ngày phép).

## Phạm vi code

- Một hàm duy nhất "người này tính 2 lương?" = tổ thuộc khối SX (kế thừa) hoặc tổ Giao hàng; thay
  mọi chỗ đang đọc `has_piece_work` / `COMP_LUONG_KHOAN`: `payroll_service._che_do_khoan`,
  `leave_service`, `san_xuat/board.py`, `san_xuat/thuc_thi.py`, `lenh_sx/*`.
- `payroll_service._compute`: tiền giờ tăng ca + phụ cấp TC đêm chuyển vào vế thời gian của phép so
  (bỏ `0.0 if khoan_mode`, bỏ `he_so_tc = … not khoan_mode`); `COMP_TANG_CA` coi như luôn bật.
- Bỏ `luong_khoan`, `tang_ca` khỏi `SALARY_COMPONENT_KEYS`, bỏ 2 dòng ở `CoCheTab.tsx`. Dòng cũ trong
  `department_salary_components` và cột `departments.has_piece_work` để nguyên, thôi đọc — không
  migration.
- Tiền khoán vẫn = 0 cho tới khi nối màn Khoán theo kỳ (`deps.get_piece_work_service` đang rỗng).

### Ba luật theo NGÀY của vế khoán (chủ 20/10: đưa vào phạm vi đợt này)

Cần tiền sản lượng của TỪNG NGƯỜI THEO TỪNG NGÀY, không chỉ tổng tháng:

1. **50% phần vượt chỉ tiêu ngày** (chủ chốt 20/10): chỉ tiêu là của TỔ cho CẢ MỘT NGÀY, không
   theo từng thợ. Mỗi ngày lấy TỔNG sản lượng quy ra tiền của tổ đó — gồm cả lần ghi có người tổ
   khác sang phụ trong ngày — so với chỉ tiêu (`khoan_chi_tieu_ngay`, mốc hiệu lực tại ngày đó).
   Vượt thì 50% phần vượt chia cho những người làm ở tổ hôm đó (kể cả người sang phụ), cùng cách
   chia quỹ sản lượng của tổ (giả định). Ô "Chỉ tiêu" trên màn Cơ chế lương đổi đơn vị "đ/công" →
   "đ/ngày" của tổ.
2. **Tổ in** (cờ `la_to_in`): sản lượng ngày Chủ nhật / lễ KHÔNG vào vế khoán (ngày đó trả 2 / 3 / 5
   công ngoài phép so).
3. **Chủ nhật trùng lễ** (tổ thường): sản lượng ngày đó tính GẤP ĐÔI trong vế khoán.

Loại ngày lấy từ Lịch làm việc (`calendar_service`: `paid_holidays_in_month`, `la_ngay_nghi_tuan`,
`is_working_day`) — cùng nguồn Chấm công dùng để chia công lễ / nghỉ tuần.

Câu còn phải trao đổi trước khi code: nguồn tiền sản lượng theo ngày theo người lấy từ đâu khi màn
Khoán theo kỳ chưa có (giờ chia "tính sau"); 50% vượt tính trên số gốc hay số đã nhân đôi.

Chủ chốt 20/10: 50% phần vượt = **tiền tăng ca khoán**, CỘNG VÀO LƯƠNG KHOÁN rồi mới so với lương
thời gian (khác sổ lk_2mau vốn cộng cột "Ngoài giờ" sau phép so).

### Hai loại tăng ca phải RẠCH RÒI (chủ dặn 20/10)

| | Tăng ca khoán | Tăng ca theo giờ |
|---|---|---|
| Thuộc | lương khoán | lương thời gian |
| Tính từ | 50% phần tổng sản lượng tổ vượt chỉ tiêu ngày, chia cho người làm hôm đó | giờ làm thêm × (vị trí + TN) ÷ 26 ÷ 8 × 1,5 / 2 / 3 |
| Cột lưu | cột MỚI `payroll_lines.tang_ca_khoan` (migration) — KHÔNG nhét vào `khoan` hay `ot_pay` | `tien_gio_tang_ca` (đã có, trong `ot_pay`) |

- Người ăn lương khoán: nhận tăng ca khoán, tăng ca theo giờ = 0. Người ăn lương thời gian: ngược lại.
  Không bao giờ nhận cả hai.
- Bảng lương, phiếu lương, file Excel: HAI dòng / cột riêng tên "Tăng ca khoán" và "Tăng ca theo
  giờ"; không dùng chữ "Tăng ca" trơn. Ngăn so 2 lương hiện cả hai số để thấy vì sao ăn bên nào.

### Tổ trưởng ĂN CHIA (chủ xác nhận 20/10 bằng sổ cán màng T08)

Mỗi kỳ lương (cả tháng, không theo ngày): lấy tổng tiền sản lượng của tổ, trích tỷ lệ tổ trưởng
(`khoan_to_truong.ty_le`) cho người đứng đầu tổ (`departments.head_user_id`), phần còn lại chia cho
cả tổ — tổ trưởng vẫn có phần chia như mọi người. Tiền trích nằm trong LƯƠNG KHOÁN của tổ trưởng.

Sổ cán màng T08: tổng tổ 105.491.142 × 5% = 5.274.557 cho Phạm Gia Phú; 100.216.585 còn lại chia 5
người; năm số thực nhận cộng lại đúng 105.491.142 (quỹ chia hết, không công ty bù). Cách chia phần
còn lại xấp xỉ giờ × hệ số nhưng chưa ra khớp từng đồng — kiểm lại khi chốt cách chia quỹ.

### Công thức khoán thợ in (chủ chốt 21/10; đã code ở cb054910)

Tiền tính trên TỪNG LẦN GHI (không gom theo bài, không gom theo lệnh):
`giá bài + max(0, số lượng lần ghi − 3000) × giá tờ rớt`, ví dụ máy 2 màu CMYK
`150000 + max(0, sl − 3000) × 30`. Mỗi loại bài là một công đoạn. Cần biến mới "số lượng của lần ghi"
(biến hiện có là số kế hoạch) và ô công thức khoán phải được tính thật.

Giá theo máy (chủ chốt 21/10): GIỮ một công đoạn, khai giá riêng cho từng tổ máy. Công đoạn có MỘT
công thức chung `gia_bai + max(0, sl_ghi − 3000) × gia_to_rot`; bảng giá theo tổ phụ trách điền hai số
đó, ví dụ "Bài in 1–2 màu (CMYK)": 2M 150.000/30, 4M 250.000/30, 5M 144.000/20, 6M 200.000/20,
7M 200.000/20. Lần ghi lấy giá theo TỔ của lần ghi. Việc phát sinh cũng có giá theo tổ (thay kẽm
100.000 mọi máy; xuống bài do lỗi máy/bộ phận khác 2M 187.500, 4M 150.000, 5M 90.000, 6M/7M 125.000;
lỗi thợ = 0, không khai). Tổ chưa khai giá ⇒ báo thiếu giá, không đoán.

### Tổ trưởng ĂN THƯỞNG (chủ 20/10: "tương tự")

Cũng mỗi kỳ lương, tổ trưởng được tỷ lệ × tổng tiền sản lượng của tổ (tổ làm 100 đồng ⇒ thưởng 5
đồng), nhưng công ty TRẢ THÊM: quỹ tổ không bị trừ, cả 100 đồng vẫn chia cho tổ.

Chủ chốt 20/10: tiền ăn chia và tiền ăn thưởng BẢN CHẤT đều cộng vào LƯƠNG KHOÁN của tổ trưởng rồi
mới so với lương thời gian.

Theo bảng lương T08 bản 12.09 (bản mới nhất): chỉ Cán màng ăn chia 5% (Phú) và Dán nhóm 1/2/4 ăn
chia 5% (trưởng máy). Sổ sản lượng bản cũ từng có "HH tổ trưởng" Bế = 5% × tổng SL cả tổ bế cho Nhất
(ăn thưởng ở TỔ CHA), nhưng bản 12.09 đã gỡ dòng đó, Nhất chuyển sang bù lỗ 14tr/26 × công. Khi bỏ
công tắc vẫn nên gỡ điều kiện "tổ phải bật Lương khoán mới khai được" ở `khai_to_truong` và cho tổ cha
khai được (tính trên tổng SL các tổ con), phòng khi chủ dùng lại ăn thưởng kiểu Bế.

## Đợt 2 — công thức khoán phủ mọi công đoạn (chủ duyệt 21/10)

Mockup: `docs/mockups/khoan-cong-thuc-bo-sung.html`. Nguồn: bảng lương T08 bản 12.09, đọc hết các
sheet tổ (in 2/4/5/6/7, cán màng, bồi, các kíp bế, gỡ phôi, dán, thành phẩm, cột dây, cắt Phương /
Duy / Than / giấy cắt MĐ, xe). Đợt 1 (cb054910) đã có: giá theo tổ (giá cố định + đơn giá), biến
`sl_ghi` / `sl_tot` / `gia_co_dinh`, công thức tính thật có `if` / `max` / `min`, việc phát sinh giá
theo tổ, báo thiếu giá. Đợt 2 chỉ thêm những gì sổ cần mà đợt 1 chưa có.

**Mỗi mã giá trong sổ = một công đoạn** (D1MEB, KDCC, C5L1, …), giá khai theo tổ. In UV / metalize
là công đoạn riêng, giá đã gồm ×2 / ×3 — không cần hệ số. Đây là nhập danh mục, không phải code.

Công thức của từng tổ (biến mới của đợt 2: `trung_khuon`, `xa_doi`, `so_lo`, `so_lan_chay`, `tien_gio`, `tu_tro`):

| Tổ trong sổ | Công thức khoán |
|---|---|
| In | `(gia_co_dinh + max(0, sl_ghi * (1 + tu_tro) - 3000) * don_gia_khoan) * if(so_mau_pha > 0, 1.1, 1)` — ĐÃ THAY bằng công thức của "Bài in" (IN-12, `2026-10-22-gop-bai-in-khoan-design.md`): giá theo tổ × bậc màu. Mọi lần ghi ăn đủ giá bài kể cả bài ghép in liên tục và "chạy tiếp" (sổ 2M WIPRO 413 = 381.000); sổ 7M 393A / 393C bỏ giá bài là ghi sai (chủ chốt 22/10) |
| Bế | `(1 - trung_khuon) * gia_co_dinh + sl_ghi * (1 + xa_doi) * (don_gia_khoan + if(so_lo >= 7, 50, if(so_lo >= 1, 20, 0)))` |
| Cán màng, Bồi | `sl_ghi * dai_in * rong_in * don_gia_khoan`; chụp film = việc phát sinh |
| Cắt | `sl_ghi * dai_nguyen * rong_nguyen * dinh_luong * don_gia_khoan` (đ/kg) |
| Dán | `gia_co_dinh / so_lan_chay + sl_ghi * don_gia_khoan` (canh máy 50.000/lệnh = giá cố định, chia đều số lần chạy như sổ) |
| Gỡ, Thành phẩm, Cột dây, Đục lỗ tay | `sl_ghi * don_gia_khoan` |
| Thành phẩm trả theo giờ (lau chùi, đếm bỏ bọc) | `tien_gio` |

Số lượng trong công thức (chủ 21/10): CHỈ MỘT chip `sl_ghi` = cột "Số lượng" của lần ghi ở bàn tổ (tab
Sản lượng) — đúng số thợ gõ. Không nói tốt / hỏng: gỡ chip `sl_tot` khỏi ô Công thức khoán. Công đoạn
bỏ trống công thức = 0 đồng (chủ 22/10 ĐẢO luật cũ "trống = `gia_co_dinh + sl_ghi × don_gia`": tiền
phải tường minh trên công thức). Mg 0434 chép công thức đó vào mọi ô đang trống để tiền giữ nguyên.
Kết quả công thức LÀ tiền (chủ 22/10): bỏ luật ngầm "công thức không có chip tiền thì máy tự × đơn
giá khoán". Công thức có sản lượng mà không có `don_gia_khoan` chỉ bị nhắc trước chốt, không tự nhân.

Màu pha (chủ 21/10): sổ in ghi "màu pha 10% tổng bài in" = lần ghi của bài có màu pha cộng 10% tiền.
Viết trong công thức bằng chip có sẵn `so_mau_pha` (`if(so_mau_pha > 0, 1.1, 1)`), không code riêng.

Phần thêm:

1. **Giá cố định chung** — ô mới cạnh Đơn giá chung ở tab Khoán. Bảng giá theo tổ để trống thì mọi tổ
   dùng cả hai giá chung (nay giá cố định chung luôn 0 ⇒ bế 6 kíp cùng giá phải gõ 6 dòng).
2. **Tuỳ chọn khi ghi** — khối mới ở tab Khoán của công đoạn: tên hiện cho thợ, mã biến, kiểu
   Có/không (vào công thức là 1/0) hoặc Số, gợi ý. Mỗi tuỳ chọn thành chip trong ô Công thức khoán,
   hiện ở hộp Ghi sản lượng và Sửa số (đặt trên việc phát sinh), lưu theo lần ghi. Không tick / bỏ
   trống = 0. Ví dụ: Bế có "Trùng khuôn", "Xả đôi", "Số lỗ đục".
3. **Chip `so_lan_chay`** cho mọi công đoạn (chủ 21/10, sổ DÁN cột "tiền canh máy" = `$O$119 / số lần
   chạy`): số lần ghi của CÙNG lệnh ở CÙNG công đoạn, đếm tới cuối kỳ đang tính lương (tối thiểu 1).
   Tiền khoán tính lại mỗi lần bấm Tính lại nên lần ghi sau làm số của lần trước đổi theo — đúng sổ.
   Lệnh vắt hai kỳ: kỳ trước đã đếm 1 lần ⇒ 50.000; kỳ sau 2 lần ⇒ lần mới 25.000 (tổng 75.000, chấp
   nhận). Dòng sổ ghi "phước canh" (người khác canh, nhóm không ăn) ⇒ tuỳ chọn khi ghi "Không canh
   máy" `khong_canh`: công thức `(1 - khong_canh) * gia_co_dinh / so_lan_chay + …`.
4. **Chip `tien_gio`** cho mọi công đoạn: Σ người làm (lương vị trí + lương trách nhiệm) ÷ 26 ÷ 8 × số
   giờ của lần ghi (giờ kết thúc − giờ bắt đầu). Chủ 21/10 chỉ ảnh bảng lương T07: cột Ngoài giờ =
   `(K + L) / 26 / 8 × 1,5 × giờ` ⇒ chia 26 cố định, KHÔNG cộng phụ cấp; `tien_gio` là cùng gốc đó, bỏ
   × 1,5 (giờ làm thêm đi theo tăng ca theo giờ hiện có).
5. **Báo dừng máy** — nút mới ở bàn tổ (tổ trưởng): ngày, lý do Máy hư / Hết hàng, phiếu sửa máy nếu
   có, ghi chú. Ngày đó tổ ăn chỉ tiêu ngày (`khoan_chi_tieu_ngay`), chia cho người có công hôm đó.
6. **Chip quy cách in cho ô Công thức khoán** — đã dùng được sẵn (thừa hưởng bộ quy đổi, `khoan_ky`
   bơm `ngu_canh_lenh`): `so_mau`, `so_mau_pha`, `so_mau_phu`, `so_mat`, `so_kem`, khổ in, định lượng.
   Thiếu: `so_mat` = 2 cho CẢ in AB lẫn tự trở / trở nhíp nên không tách được tự trở ⇒ thêm chip
   **`tu_tro`** = 1 khi quy cách in của lệnh là tự trở hoặc trở nhíp, ngược lại 0. Bài ghép lấy quy
   cách của bài.
7. **Ngăn soi Khoán SP** — mỗi lần ghi hiện thẻ tuỳ chọn đã chọn ("trùng khuôn", "3 lỗ", "xả đôi");
   thêm dòng ngày dừng máy kèm lý do và phiếu sửa.

Ngoài đợt 2: xe tải (tính theo chuyến, bậc km — mục riêng); bế sô ×1,5 / ×2 CN (sheet đã ẩn).

Còn phải chốt trước khi code:
- Hệ số 0,7 ở sheet Duy / Than và 0,6 / 0,8 ở sheet xe — chủ 21/10: KHÔNG làm, bỏ qua.
- Ngày dừng máy mà vẫn có ghi sản lượng — chủ 21/10: CỘNG CẢ HAI (chỉ tiêu ngày + tiền các lần ghi).
- Việc trả theo giờ — chủ 21/10: `tien_gio` chỉ là lương giờ × số giờ, KHÔNG nhân 1,5; giờ làm thêm
  đi theo tăng ca theo giờ hiện có của phần mềm (vế thời gian).
- In tự trở — chủ 21/10: SL × 2, viết ngay trong công thức. Sổ nhân 2 ở chính ô SL rồi mới so 3.000
  ⇒ ngưỡng so với số ĐÃ nhân đôi (công thức mẫu ở bảng trên); muốn khác thì sửa công thức, không phải
  code.
- Cách chia tiền trong tổ — ĐÃ CHỐT (chủ 21/10: "áp cho mọi tổ luôn"): MỌI tổ chia theo tỷ lệ LƯƠNG
  CA MÁY = (lương vị trí + lương trách nhiệm + phụ cấp) của người, cùng mức nền với bù lỗ (sổ in: Tuấn
  16,5tr / Huy 14,5tr ⇒ 0,532 / 0,468). Tiền MỖI LẦN GHI chia cho những người được tick ở lần ghi đó
  theo tỷ lệ lương ca máy giữa chính họ ⇒ ai không làm lần đó không ăn, thử việc lương thấp tự ăn ít
  (thay cho chia giờ × hệ số, tỷ lệ kíp gõ tay, 1/3 – 1/4 của sổ). Tăng ca khoán và trích tổ trưởng
  giữ cách đợt 1 (theo phần mỗi người đã ra). Người lương ca máy = 0 ⇒ báo thiếu, không chia đều.
  Đợt 1 (cb054910) đang chia ĐỀU (`khoan_ky.py`, giả định 1) ⇒ phải sửa.
  "Lương ca máy" lấy ĐÚNG mức nền bù lỗ đang dùng (`payroll_service._compute`, `bu_lo_theo_cong =
  (daily_rate + don_gia_phu_cap) × công`), không dựng mức mới:
  - nền = `eff_monthly` = (lương vị trí + lương trách nhiệm) × hệ số thử việc (`probation_ratio`);
  - phụ cấp = `phu_cap_thang` = ô Phụ cấp khác (`employee_salaries.allowance`) + các khoản thu nhập
    gán ở HỒ SƠ (`employee_salary_components`, trừ khoản kind = trừ); KHÔNG nhân hệ số thử việc;
  - KHÔNG gồm cơm ca / phụ cấp ca (`work_shifts`, trả theo ngày đi làm), cơm tăng ca, khoản phát sinh
    riêng kỳ (`payroll_line_components`), chuyên cần.
  Mức lấy theo hồ sơ lương hiệu lực của kỳ (như bù lỗ). Người tổ khác sang phụ dùng mức của chính họ.
  Người THỬ VIỆC (chủ chốt 21/10): vẫn đứng trong tỷ lệ chia của lần ghi như mọi người, nhưng giữ luật
  16/09 — tiền khoán về 0, luôn ăn bù lỗ do công ty trả. Phần chia của họ KHÔNG dồn sang người chính thức
  (vd Tuấn + Linh thử việc: Tuấn ăn 0,647, phần 0,353 của Linh bỏ).
### Giả định đã trình chủ 21/10 (chủ không gạch ⇒ coi là duyệt)

- Mỗi mã giá trong sổ = một công đoạn (~150 công đoạn, nhập qua Excel danh mục).
- Xả đôi, số lỗ đục, trùng khuôn, không canh máy do THỢ tick / gõ ở từng lần ghi (không lấy
  từ quy cách lệnh). In UV / metalize là công đoạn riêng. Chụp film là việc phát sinh.
- Cán màng / bồi tính m² theo khổ tờ in; cắt tính kg theo khổ tờ nguyên × định lượng (cắt thành phẩm
  chưa đối chiếu sổ — khổ khác thì sửa công thức, không phải code).
- Mức lương ca máy lấy theo hồ sơ hiệu lực của kỳ (như bù lỗ); người có mức = 0 ⇒ lần ghi báo thiếu.
  Phụ cấp = mọi khoản thu ở hồ sơ (nhà ở, trang phục, đi lại, phụ cấp khác…), không gồm cơm ca.
- Báo dừng máy: tổ trưởng bấm, tính cả ngày, không theo giờ.
- Ngày của lần ghi = theo giờ bắt đầu (ca qua đêm tính vào ngày bắt đầu).
- 50% vượt chỉ tiêu so trên tiền GỐC (trước nhân đôi CN trùng lễ); tổ chưa khai chỉ tiêu lấy của tổ cha.
- Tổ trưởng: mốc tỷ lệ lấy tại ngày cuối kỳ; quỹ gồm tổ con; ăn chia trừ mỗi người theo phần họ làm ra
  (thay chữ "chia đều" ở mục Tổ trưởng ĂN CHIA).
- Giá áp lên lần ghi theo ẢNH CHỤP lúc ghi — khai giá mới không đổi lần ghi cũ.
- Dòng gõ tay "+10", "+50" vào đơn giá ở sổ ⇒ khai việc phát sinh "Cộng đơn giá" (thợ tick + gõ số).
- Sổ không trả khi thiếu NPL: phần mềm KHÔNG xử lý (vẫn tính tiền lần ghi).
- Ví dụ tăng ca của Quí ở spec (432.692) gõ nhầm; công thức đúng ra 721.154 (10 giờ × 1,5).
- Ô "Lương khoán: Có" ở màn Phòng ban là cờ cũ, gỡ khỏi màn.

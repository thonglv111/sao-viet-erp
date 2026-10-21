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

### Công thức khoán thợ in (chủ chốt 21/10, đang bàn)

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

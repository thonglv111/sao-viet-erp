# Hoa hồng kinh doanh theo tiền thu về, bậc theo số ngày thu

Ngày: 23/10/2026. Nguồn: sổ lương T08/2026 (`D:\BẢNG LƯƠNG T08.2026 ( 12.09).xls`, sheet DOANH THU T8,
Lương KD CTV, BL CT). Chủ đã duyệt hướng này ngày 23/10/2026.

## Vì sao làm

Máy hiện tính hoa hồng khác sổ ở mọi khâu: mốc là hoá đơn (sổ là tiền thu về), một % phẳng cho mọi
khoản (sổ chia bậc theo số ngày thu), sale có % hằng tháng (sổ không trả), lãnh đạo và CTV chưa có
tài khoản nên máy ra 0. Nếu đưa dữ liệu bán tháng 8 vào, máy trả Thịnh khoảng 32tr hoa hồng trong khi
sổ trả 0, và trả Sơn, Kim Dung, Ngọc Sơn 0đ trong khi sổ trả 23,39tr, 14,93tr và 19,63tr.

## Luật của sổ (đã đối chiếu số)

- Gốc tính = **doanh thu thực của khoản thu về trong tháng**: phần trước VAT trừ chiết khấu và kê
  của hoá đơn, kể cả chiết khấu chưa chi (ghi chú ô: "đưa vào để tính doanh thu thực cho KD").
- Số ngày thu = ngày thu tiền − ngày bán (ngày hoá đơn).
- Mỗi người hưởng một biểu riêng:

| Người hưởng | Biểu | Đối chiếu T08 |
|---|---|---|
| Lãnh đạo phụ trách khách (TGĐ Sơn, PGĐ Kim Dung) | 0,5% mọi khoản, không giới hạn ngày | 4.677.451.077 × 0,5% = 23.387.255; 2.985.786.787 × 0,5% = 14.928.934 |
| CTV (Ngọc Sơn) | 0–45 ngày 3% · 46–60 2% · 61–75 1% · từ 76 ngày 0% | 654.435.387 × 3% = 19.633.062 |
| Sale (Thịnh, Hiệp, Huyên, Hoa, Tiến) | không có hoa hồng tháng | 0 |

### Đối chiếu kỹ file Excel (23/10)

- Doanh thu thực = doanh thu gồm VAT ÷ 1,08 − cột "chiết khấu KH": đúng 407/430 dòng. 11 dòng bán không
  hoá đơn (INAN, không số HĐ) lấy nguyên số, tương đương đơn VAT 0% của máy.
- Bậc ngày của K Dung cộng lại theo 0–7/8–45/46–60/61–75/76+ khớp từng đồng với bảng của sổ.
- Trừ TOÀN BỘ kê, không phải phần 80% chi ra: CTV 738.751.198 ÷ 1,08 − 29.593.500 = 654.435.387.
  Sheet DOANH THU T8 quên trừ kê ở các dòng N SƠN (ra 684.028.887), sheet Lương KD CTV mới trừ, và
  hoa hồng tính theo số đã trừ.
- 12 dòng kế toán bỏ trống không tính: thu không phải bán hàng, hoá đơn không giao hàng, và 6 khoản
  KARTA 128–271 ngày của S SƠN Đ, trong khi khoản 383 ngày của S SƠN L vẫn tính. Đây là loại tay, không
  theo luật số ngày; máy không mô phỏng, kế toán điều chỉnh tay nếu cần.
- HĐ 00001767 có CK 5% (302.250) ở sổ bán ra nhưng DOANH THU T8 không trừ: sổ sót, máy sẽ trừ.
- **CK của sổ là % trên doanh số bán trước kê** (KI WORKS 3% × 36.668.200 = 1.100.046; Powertech
  5% × 16.848.000). Báo giá của máy tính CK theo % trên GIÁ VỐN (`quotation_service._gia_dong`). Gõ cùng
  một con số % thì ra tiền CK khác ⇒ CK trên hoá đơn, tiền chi CK và gốc hoa hồng đều khác sổ.
  Chủ chốt 23/10: đổi theo sổ, tiền CK = % × giá bán trước kê (DS BÁN RA T8 cột T `=(O−Q)*N*R`).
  Luật lợi nhuận của báo giá giữ như 18/10 (% trên vốn + CK). Làm CÙNG đợt với hoa hồng (chủ chốt 23/10:
  làm trọn để ra đúng số sổ) — xem mục 6.

### Bảng so sánh sổ T08 ↔ phần mềm hiện tại ↔ thiết kế này

| Khâu | Sổ T08 (nguồn) | Phần mềm hiện tại (nguồn) | Thiết kế này |
|---|---|---|---|
| Tiền chiết khấu | % × (đơn giá − kê/cái) × SL — DS BÁN RA T8 cột T `=(O−Q)*N*R` | % × giá vốn, hoặc gõ số tiền — `quotation_service.py:518` | % × giá bán trước kê (chốt 23/10) |
| Tiền kê | kê/cái × SL — DS BÁN RA T8 cột S `=Q*N` | % trên giá bán hoặc số tiền, cộng sau giá bán — `calculate_pricing` | giữ |
| Chi kê cho người bên khách | 80% kê — Lương KD CTV | kê − 20% thuế TNDN | giữ |
| Gốc tính hoa hồng | có HĐ: tiền ÷ 1,08 − CK − kê; không HĐ: tiền − CK − kê — DOANH THU T8 cột I | tiền HĐ × tỷ lệ trước VAT − CK − kê — `hoa_hong_service.py` | giữ, chia theo từng lần thu |
| Tháng ghi nhận | ngày thu tiền | ngày xuất hoá đơn | ngày thu tiền |
| Số ngày | ngày thu − ngày bán | không dùng | ngày thu − ngày HĐ; thu trước HĐ = 0 |
| Lãnh đạo (Sơn, K Dung) | 0,5% mọi khoản, không giới hạn ngày | 0 (chưa tài khoản) | 0,5% không giới hạn ngày |
| CTV (N Sơn) | 3/2/1/0% theo 45/60/75 ngày — Lương KD CTV | 1 tỷ lệ phẳng, đang 0 | biểu bậc |
| Sale | không hoa hồng tháng, KPI quý | % phẳng mỗi tháng (Thịnh 2%) | 0, KPI kế toán chỉnh tay |
| Trợ lý | 0,1% | không có | kế toán gõ tay |
| Đơn ngoại lệ | Wipro 1%, loại khỏi KPI | không có | % riêng trên đơn |
| Khoản loại tay | 12 dòng để trống | không có | kế toán điều chỉnh tay |

Dòng thật áp vào:

| Dòng sổ | Sổ T08 | Phần mềm hiện tại | Thiết kế này |
|---|---|---|---|
| DS BÁN RA T8 dòng 706, KI WORKS: 13.190 × (3.780 − 1.000) × 3% | CK 1.100.046 | 3% × giá vốn, nhỏ hơn, trừ khi gõ số tiền | 1.100.046 |
| DS BÁN RA T8 dòng 718, Powertech: 1.200 × 14.040 × 5% | CK 842.400 | 5% × giá vốn | 842.400 |
| DOANH THU T8 dòng 249, K Dung – GOODY, HĐ 25/04 thu 27/08 (124 ngày), gốc 51.889.000 | 259.445 vào T08 | 0, rơi vào tháng 4 | 259.445 vào T08 |
| Lương KD CTV, N Sơn – PINACO, HĐ 23/07 thu 22/08 (30 ngày), gốc 47.448.800 | 1.423.464 vào T08 | 0, rơi vào tháng 7 | 1.423.464 vào T08 |
| DOANH THU T8 dòng 395, Thịnh – Thiết bị điện, thu 15/08 trước HĐ 27/08, gốc 3.935.185 | 0 | 78.704 (2%) | 0 |
| DOANH THU T8 dòng 421, Tiến – MĂMMY HĐ 1767 | gốc 6.045.000, sót CK 302.250 | gốc 5.742.750 | 5.742.750 |

## Phạm vi

Làm: tiền chiết khấu theo giá bán, mốc tiền thu, biểu bậc theo người, % riêng từng đơn, người hưởng là
lãnh đạo/CTV, đối chiếu số tháng 8.

Không làm (chủ chốt 23/10):
- **KPI quý của sale** (mức 85%/60%, đơn loại khỏi KPI): kế toán lương điều chỉnh tay ở "Điều chỉnh
  lương" hoặc "Khoản phát sinh". Không thêm cờ "không tính KPI" lên đơn.
- **Trợ lý kinh doanh**: kế toán gõ tay "Khoản phát sinh" mỗi tháng.
- **Luật "khách hạn 60 ngày được cộng 15 ngày"**: sổ chỉ dùng nó cho KPI và trợ lý, cả hai đều tay.
- **Kê của CTV** (trả 80% sau thuế TNDN 20%): đi đường kê/chi chiết khấu đã có, ngoài bảng lương.

## Thiết kế

### 1. Mốc = dòng phiếu thu

`HoaHongService._moc_phat_sinh` đổi sang đọc `payment_receipt_lines` của phiếu `received` có
`receipt_date` trong kỳ. Mỗi dòng sinh một khoản hoa hồng:

```
gốc(dòng)   = dòng.amount_vnd × tỷ_lệ_trước_VAT(đơn) − (CK + kê của hoá đơn) × dòng.amount_vnd / hoá_đơn.amount_vnd
số_ngày     = phiếu.receipt_date − hoá_đơn.invoice_date
hoa hồng    = max(0, gốc) × %(biểu của đơn, số_ngày)
```

- Dòng cọc (`sales_invoice_id` NULL) chưa có hoá đơn: số ngày = 0, CK/kê trừ theo tỷ lệ CỦA ĐƠN:
  `gốc = cọc × (Σ line_total − Σ chiet_khau − Σ ke_gia) / tổng đơn gồm VAT`. Không trừ thì phần tiền
  cọc được tính hoa hồng trên cả CK và kê. Cọc cấn FIFO vào hoá đơn là phép tính sống, không sinh dòng
  phiếu thu mới, nên không bị tính hai lần.
- Phiếu thu bị huỷ thì không còn trong kỳ. Kỳ đã chốt không tính lại; huỷ sau khi chốt thì kế toán
  trừ tay ở kỳ sau (giữ nguyên cách chốt kỳ hiện nay).
- `tỷ_lệ_trước_VAT` giữ nguyên hàm hiện có.

### 2. Biểu bậc thay ô % phẳng

- `employee_salaries.bac_hoa_hong` (JSON, nullable): danh sách bậc tăng dần
  `[{"den_ngay": 45, "pct": 0.03}, {"den_ngay": 60, "pct": 0.02}, {"den_ngay": 75, "pct": 0.01},
  {"den_ngay": null, "pct": 0}]`. `den_ngay: null` = không giới hạn. NULL/rỗng = không hưởng hoa hồng.
  Versioned sẵn theo `effective_from` như mức lương.
- `employee_salaries.commission_pct` thôi dùng. Migration chuyển dữ liệu: `pct > 0` ⇒
  `[{"den_ngay": null, "pct": pct}]`.
- Chụp lúc chốt đơn: `orders.bac_hoa_hong` (JSON) chụp biểu của người phụ trách tại ngày chốt, đúng
  nguyên tắc hiện có "tiền đã hứa thì không sửa ngược" (`order_service.confirm`). Migration chuyển
  `orders.commission_pct > 0` ⇒ biểu một bậc.
- Engine tra % theo số ngày trên biểu ĐÃ CHỤP của đơn, không đọc biểu sống của người.

### 3. % riêng từng đơn

- `orders.hh_rieng_pct` (Numeric, nullable) + `orders.hh_rieng_ly_do` (String 255). Có giá trị thì
  dùng % này cho mọi lần thu của đơn, bỏ qua biểu (đơn Wipro 1%).
- Chỉ người có quyền sửa hồ sơ lương mới đặt được, sale thì không, giữ đúng quyết định 21/08/2026
  "không cho sale gõ % trên chính đơn mình bán". Mỗi lần đổi ghi nhật ký (`audit_registry.py`).
- Đặt trên đơn đã chốt vẫn được, vì ngoại lệ thường lộ ra sau khi chốt. Đơn của kỳ lương đã chốt
  không tính lại.

### 4. Người hưởng

- Người hưởng = hồ sơ nhân viên của người phụ trách đơn (`orders.sale_user_id` → `employees.user_id`),
  giữ nguyên cách nối hiện nay.
- Lãnh đạo và CTV phụ trách khách thì phải có tài khoản để đứng tên phụ trách đơn. CTV dùng tài khoản
  chỉ có "Phiếu lương của tôi". Đây là việc khai dữ liệu, không phải code.
- Sale: đặt biểu rỗng (Thịnh trên dev đang 2% thì xoá về rỗng).

### 5. Cho kế toán soát số

Ô "Hoa hồng" của dòng lương mở ra bảng từng lần thu: số phiếu thu, đơn, ngày hoá đơn, ngày thu,
số ngày, gốc, %, tiền. Không có bảng này thì kế toán không đối được với sổ.

### 6. Tiền chiết khấu trên báo giá

- `calculate_pricing`: nhập %CK ⇒ giá bán trước kê = vốn × (1 + %LN) ÷ (1 − %CK × (1 + %LN)), làm tròn,
  rồi tiền CK = %CK × giá bán đã tròn; lợi nhuận = phần còn lại. Giá gõ tay ⇒ CK = %CK × giá gõ. Số tiền
  CK gõ thẳng giữ nguyên. Chặn %CK × (1 + %LN) ≥ 100%.
- `_gia_dong`: suy % = tiền CK cũ ÷ giá bán cũ (không còn ÷ giá vốn cũ).
- `BaoGiaPage.calcItem` tính sống khớp máy chủ; nhãn "Chiết khấu (%) trên giá bán trước kê".
- Không đổi DB. Báo giá/đơn/hoá đơn cũ giữ số tiền CK đã lưu.

## Giao diện chịu ảnh hưởng

Chủ chốt 23/10: KHÔNG dựng 3 phương án HTML, bám khuôn có sẵn.

1. Hồ sơ lương (`SalaryModal.tsx`, khối "Tạm ứng định kỳ & Hoa hồng kinh doanh"): ô "% hoa hồng"
   thành bảng bậc GIỐNG HỆT ô bù hao của công đoạn (`danh-muc/fields/Bands.tsx`): hai cột "Khi số ngày
   thu tiền" | "Thì hoa hồng"; chỉ gõ mốc trên, nhãn tự nối "Đến 45 ngày" / "Trên 45 đến 60" / "Trên 75";
   bậc cuối vô hạn không xoá được; "＋ Thêm bậc" chèn trước bậc vô hạn; mốc phá thứ tự tô đỏ. Ô giá trị
   chỉ có %, không có nút Tờ. Lãnh đạo = một bậc "Mọi số ngày 0,5%".
2. Bảng lương tháng: ngăn soi hoa hồng theo lần thu (khuôn ngăn soi khoán km). Người có ô
   `luong:update` đặt "% riêng" + lý do cho từng đơn NGAY trong ngăn này — kế toán lương phát hiện ngoại
   lệ lúc soát lương, nên không đặt ô ở màn đơn hàng (màn của sale). `hh_rieng_pct = 0` dùng để loại tay.

## Kiểm chứng

- Test đơn vị trên `HoaHongService`:
  - bậc CTV: khoản thu ngày 45 ra 3%, ngày 46 ra 2%, ngày 76 ra 0;
  - lãnh đạo: khoản thu ngày 200 vẫn ra 0,5%;
  - thu từng phần: hai phiếu thu cùng hoá đơn ở hai kỳ thì mỗi kỳ chỉ tính phần của mình, CK/kê
    chia theo tỷ lệ;
  - phiếu thu huỷ thì không tính;
  - `hh_rieng_pct` thắng biểu;
  - đổi biểu của người sau khi chốt đơn thì đơn cũ vẫn ra theo biểu đã chụp.
- Đối chiếu sổ: nhập phiếu thu T08 từ sheet DOANH THU T8 vào DB dev, tính lại kỳ tháng 8. Phải ra
  Sơn 23.387.255, Kim Dung 14.928.934, Ngọc Sơn 19.633.062, sale 0.
- Bấm thử trên dev-browser: khai biểu bậc ở hồ sơ lương, đặt % riêng trên một đơn, Tính lại, mở chi
  tiết hoa hồng.

## Migration (`db_migrations.py`) + `docs/DB_SCHEMA.md`

- `employee_salaries.bac_hoa_hong` JSON NULL; backfill từ `commission_pct`.
- `orders.bac_hoa_hong` JSON NULL; backfill từ `commission_pct`.
- `orders.hh_rieng_pct` Numeric(6,4) NULL, `orders.hh_rieng_ly_do` String(255) NULL.
- Backfill viết raw SQL đích danh cột, không dùng ORM full-select.
- Hai cột `commission_pct` cũ để lại (DORMANT), không đọc nữa.

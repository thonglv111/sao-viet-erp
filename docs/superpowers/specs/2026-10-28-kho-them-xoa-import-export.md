# Kho: thêm, xoá, import, export vật tư — thiết kế

Chốt với user 27–28/10/2026. Chưa code — chờ "làm đi".

## 0. Nhu cầu (lời user, tóm lại)

1. Vào **màn của từng kho** (Kho giấy, kho vật tư, Kho thành phẩm…) để **thêm** hoặc **xoá** vật tư trong kho.
   Vật tư lấy từ danh mục giấy và danh mục vật tư; xoá ở kho KHÔNG đụng danh mục.
2. **Import** và **export** Excel được.
3. Form Thêm có **đúng các trường như file import**, có cả **khổ**, có **tiền**.
4. **Trùng thì coi là cập nhật**, không thêm dòng mới.
5. **Xoá thì xoá luôn**, không chia trường hợp, không ghi tăng/giảm.
6. Thêm, xoá, import, export gộp thành **một quyền chi tiết** trong từng kho.
7. Hàng nhập tay liên quan tới **đầu kỳ** của báo cáo kho.
8. Không có cột "Loại" — mã hàng tự nói là giấy hay vật tư.

## 1. Dữ liệu hiện có (đã xem DB, 28/10)

- Một dòng trên màn Tồn kho = **mã + khổ + ĐVT** của một kho, gộp từ nhiều **lô** (`stock_lots`). Ví dụ Kho giấy:
  COUCHE 150GSM 790×1090 tờ có 2 lô (261 tờ giá 3.152, 232 tờ giá 3.155).
- Tiền nằm ở từng lô (`don_gia_nhap`). Cột Giá trị = tổng các lô.
- Màn Tồn kho đọc từ **lô**; Báo cáo kho (Nhập-Xuất-Tồn, đầu kỳ, giá BQ) đọc từ **dòng phiếu nhập/xuất**.
  ⇒ Hàng thêm tay phải có phiếu đi kèm thì hai màn mới khớp nhau.
- Mọi phiếu kho bắt buộc ứng với một yêu cầu (`stock_vouchers.request_id` NOT NULL).
- Đầu kỳ của báo cáo: lấy số đã chốt của kỳ trước nếu kỳ đó đã khoá sổ, không thì cộng dồn mọi phiếu có ngày trước kỳ.

## 2. Bộ trường (form Thêm = file Import = file Export)

Một dòng = một mặt hàng trong kho, khoá bằng **mã + khổ + ĐVT**.

| Cột | Nhập tay / import | Ghi chú |
|---|---|---|
| Mã hàng | bắt buộc | tra cả danh mục giấy và vật tư; mã có ở cả hai ⇒ lỗi dòng, sửa ở danh mục |
| Tên hàng | máy tự điền | lấy theo mã, gõ khác cũng bỏ qua |
| Định lượng | máy tự điền | chỉ giấy, lấy theo danh mục |
| Khổ rộng (mm) | tuỳ chọn | chuẩn hoá cạnh ngắn trước như hiện nay |
| Khổ dài (mm) | tuỳ chọn | trống = chỉ có khổ rộng; trống cả hai = không khổ |
| ĐVT | bắt buộc | ĐVT đã khai của món, hoặc đơn vị cùng nhóm quy đổi (gõ ram ⇒ máy quy về tờ, giấy hai cạnh gõ kg ⇒ quy ra tờ); Số lượng + Đơn giá hiểu theo đơn vị gõ |
| Số lượng | bắt buộc, ≥ 0 | số tồn của dòng |
| Đơn giá | bắt buộc với dòng mới | đồng, ≥ 0 |
| Thành tiền | máy tự tính | = số lượng × đơn giá |
| Vị trí | tuỳ chọn | phải là vị trí đã khai của kho đó |
| Hạn dùng | tuỳ chọn | |
| Ngày nhập | tuỳ chọn | trống = hôm nay; quyết định đầu kỳ hay nhập trong kỳ (mục 5) |
| Nhà cung cấp | tuỳ chọn | chữ tự do như cột `ncc` của lô |
| Ghi chú | tuỳ chọn | |

## 3. Bốn thao tác

### 3.1 Thêm (nút "Thêm hàng" trên màn Tồn kho của kho)

- Ngăn bên phải có đủ các ô ở mục 2. Chọn mã ⇒ tên, định lượng, danh sách ĐVT hiện ra; ô khổ dùng `KhungKho`.
- Gõ xong mã + khổ + ĐVT mà kho **đã có** dòng đó ⇒ ngăn đổi sang "Cập nhật", điền sẵn số hiện tại (mục 4).
- Lưu ⇒ máy tự lập yêu cầu nhập + phiếu nhập **đánh dấu nhập tay**, ghi sổ ngay, sinh lô. Người dùng không thấy bước này.

### 3.2 Import

Kiểm **y như import khách hàng** (`services/customer_excel.py`, `POST /customers/import-excel`):

1. **Tải mẫu** ⇒ file rỗng chỉ có dòng tiêu đề + sheet ẩn `_meta` (loại = kho, kèm mã kho). Ô ĐVT, Vị trí có
   danh sách chọn; ô số, ngày định dạng sẵn. Export cũng mang `_meta` nên sửa xong nhập lại được.
2. **Import** ⇒ chọn file ⇒ gọi `mode=preview`. Xem trước chạy **y hệt lúc ghi thật rồi rollback** — không có bản kiểm
   "sơ bộ" nhẹ hơn, nên số xem trước là số thật.
3. **Lỗi cả file** (từ chối ngay, không xem trước):
   - không đọc được, không phải .xlsx, vượt trần dung lượng (`doc_gioi_han` + `TRAN_EXCEL` như khách hàng);
   - thiếu `_meta` hoặc `_meta` là của màn khác;
   - `_meta` là của **kho khác** — file xuất từ Kho giấy không nhập vào Kho vật tư được;
   - thiếu sheet, sheet trống, thiếu cột bắt buộc (Mã hàng, ĐVT, Số lượng).
4. **Lỗi từng dòng** (dòng, cột, lý do):
   - mã trống, mã không có trong danh mục, mã có ở cả giấy và vật tư;
   - cùng mã + khổ + ĐVT nằm ở nhiều dòng — nêu số các dòng đó;
   - ĐVT — xem mục 3.2a; khổ không phải số hoặc âm;
   - số lượng trống, không phải số, âm; đơn giá trống ở dòng mới, không phải số, âm;
   - vị trí chưa khai trong kho; ngày/hạn dùng sai dạng; ngày nhập rơi vào kỳ đã tính giá;
   - lỗi nghiệp vụ lộ ra lúc service ghi ⇒ trả thành lỗi dòng, không 500.
   Dòng trắng hoàn toàn bỏ qua, không tính lỗi.
5. **Kết quả xem trước**: Tổng dòng / Thêm mới / Cập nhật / Không đổi, bảng lỗi, bảng thay đổi "cũ → mới" từng ô
   (ví dụ `Số lượng 261 → 300`), cảnh báo không chặn (ví dụ đổi giảm số lượng của dòng đang được lệnh giữ chỗ).
6. Còn lỗi ⇒ dừng **trước khi chạm DB**, nút Ghi khoá. Hết lỗi ⇒ Ghi (`mode=commit`): **cả file một giao dịch**,
   gãy một dòng là không ghi gì.

### 3.2a Kiểm ĐVT khi import (và khi Thêm bằng form — cùng một hàm)

Nhận cả mã lẫn tên đơn vị, không phân biệt hoa thường, bỏ dấu cách thừa ("Ram", " ram " đều là ram).
Luật tra gốc là `GocMatHang.goc(dvt, don_vi_khai(món))` đang dùng cho kho/mua hàng — không viết luật thứ hai.

Lỗi dòng (cột ĐVT), câu báo nói rõ cách sửa:

| Trường hợp | Câu báo |
|---|---|
| ĐVT trống | "Chưa ghi ĐVT." |
| Không có trong module Đơn vị (gõ sai chữ) | "Không có đơn vị “ream”. Đơn vị nhận được của món này: tờ, ram, kg." |
| Có nhưng không thuộc nhóm của đơn vị nào món đã khai | "COUCHE150 chưa khai đơn vị nhóm “m”. Nhận được: tờ, ram, kg — hoặc khai thêm ĐVT ở danh mục." |
| Giấy khổ chỉ-rộng (cuộn, lưu kg) mà gõ tờ/ram | "Giấy cuộn khổ 650 không đếm theo tờ — ghi kg hoặc tấn." |
| Giấy hai cạnh gõ kg/tấn nhưng món chưa có định lượng | "COUCHE150 chưa có định lượng nên không quy kg ra tờ — ghi theo tờ/ram hoặc khai định lượng ở danh mục." |
| Giấy hai cạnh gõ kg/tấn mà để trống khổ | "Quy kg ra tờ cần đủ hai cạnh khổ." |
| Quy về gốc ra 0 (vd 0,01 kg ⇒ 0 tờ) mà Số lượng > 0 | "0,01 kg quy ra 0 tờ — số quá nhỏ." |

Không phải lỗi, chỉ hiện ở xem trước:
- Đơn vị khác gốc ⇒ bảng thay đổi ghi cả hai: `Số lượng 2 ram (= 1.000 tờ)`, `Đơn giá 1.576.000 đ/ram (= 3.152 đ/tờ)`.
- Kg quy ra tờ làm tròn xuống như nhập kho hiện nay ⇒ hiện số tờ quy được để người nhập thấy phần lẻ bị bỏ.
- Vật tư khác gõ ĐVT thuộc một nhóm khác nhóm của dòng đang có (keo: thùng và kg) ⇒ là dòng MỚI theo gốc đó, không phải cập nhật.

### 3.3 Export

- Nút "Export" ⇒ file của kho đang xem, mỗi dòng = mã + khổ + ĐVT (giống màn Tồn kho), đúng các cột mục 2:
  - Số lượng = đang có; Đơn giá = giá trị ÷ số lượng (bình quân các lô còn tồn); Thành tiền = giá trị;
  - Vị trí, Nhà cung cấp, Ngày nhập = của lô nhập gần nhất; Hạn dùng = hạn sớm nhất của lô còn tồn.
- Export rồi import lại nguyên file ⇒ mọi dòng là "Không đổi", không cộng đôi.

### 3.4 Xoá

- Tick một hay nhiều dòng trên màn Tồn kho ⇒ "Xoá" ⇒ hộp xác nhận liệt kê dòng sẽ xoá ⇒ đồng ý.
- Máy xoá hẳn: **mọi lô** của dòng đó trong kho này, **dòng phiếu** trỏ tới các lô đó, mức tồn tối thiểu/tối đa của dòng.
  Phiếu nhập tay chỉ còn rỗng thì xoá luôn phiếu và yêu cầu tự sinh.
- Không ghi tăng/giảm. Tồn kho và Báo cáo kho cùng mất món đó, không lệch nhau.
- Hệ quả tự chạy, không chặn: dòng phiếu xuất nháp trỏ lô bị xoá thì gỡ theo; giữ chỗ là theo số lượng nên lệnh
  đang giữ thiếu hàng ⇒ kế hoạch vật tư tính lại và báo ngay (badge + toast) cho người kế hoạch.
- Danh mục giấy/vật tư không bị đụng.

## 4. Luật "trùng là cập nhật"

Trùng = cùng kho + **mã + khổ + đơn vị gốc** (ĐVT gõ được quy về gốc trước khi so: "2 ram" và "1000 tờ" cùng khổ là
cùng một dòng; hai dòng như vậy trong một file ⇒ lỗi trùng). Cùng mã khác khổ là dòng khác (màng 320 và màng 350 là hai dòng).

Cập nhật đặt dòng về đúng số trong form/file:

- **Số lượng lớn hơn hiện có** ⇒ phần chênh thành một lô nhập tay mới, giá = Đơn giá trong form/file, ngày = Ngày nhập.
- **Số lượng nhỏ hơn** ⇒ phần chênh trừ vào các lô cũ trước (nhập trước xuất trước), theo giá của từng lô — ghi bằng
  phiếu xuất nhập tay để báo cáo kho khớp.
- **Số lượng bằng** ⇒ không động tới tiền.
- **Đơn giá** chỉ áp cho phần tăng. Không sửa ngược giá các lô cũ — sửa ngược là đổi giá vốn đã xuất cho lệnh.
- **Vị trí** áp cho mọi lô còn tồn của dòng. **Hạn dùng, Nhà cung cấp, Ngày nhập, Ghi chú** đi theo phần tăng.

Lý do không "xoá dòng cũ rồi thêm lại" khi cập nhật: export → import lại sẽ xoá sạch lịch sử xuất cho lệnh của mọi món.

## 5. Đầu kỳ

- Phiếu nhập tay mang **Ngày nhập**. Ngày trước kỳ đang xem ⇒ vào cột Đầu kỳ; trong kỳ ⇒ vào cột Nhập.
- Lúc mới chạy: nhập toàn bộ tồn thực tế với Ngày nhập = ngày trước kỳ đầu tiên ⇒ báo cáo kỳ đầu có đầu kỳ đúng.
- Kỳ đã **khoá sổ** thì không thêm, cập nhật hay xoá gì có ngày rơi vào kỳ đó — số kỳ đó đã chốt làm đầu kỳ cho kỳ sau.
  Đây là luật khoá sổ chung của kho đang có, không phải luật riêng của tính năng này.

## 6. Quyền (dòng `ton_kho_<id>` của từng kho trong ma trận)

MỘT ô chi tiết **"Thêm, xoá, import, export hàng"** trong panel quyền chi tiết của dòng kho, nằm cạnh ô
"Xem giá thành" đã có. Cấp riêng từng kho, mặc định tắt. Bật ô này ⇒ mở cả bốn nút; tắt ⇒ không nút nào hiện.

- Cột DB: dùng lại `can_adjust` (đang có, chỉ Chấm công dùng — cột quyền đi theo từng module nên không đụng nhau).
  Không cần migration cột quyền.
- Ô này không đổi cột Xem và Thao tác (khai ngưỡng tồn) của dòng kho.
- Bật ô này ⇒ ô Xem giá thành (`can_view_cost`) của kho đó tự bật kèm, khoá không cho tắt (khuôn `FINE_THEO_WRITE`
  đang có) — nhập tồn là nhập tiền, không có trường hợp được nhập mà không thấy giá.
- Máy chủ kiểm ở từng route; thiếu ô ⇒ nút không hiện và API trả 403.

## 7. Dữ liệu cần đổi

- `stock_requests.nhap_tay` Boolean, server_default `false` — đánh dấu yêu cầu/phiếu tự sinh từ Thêm/Import/Cập nhật
  để hiện nhãn "Nhập tay" ở danh sách phiếu và báo cáo. Migration + `docs/DB_SCHEMA.md`.
- Không bảng mới.

## 7b. Xem tồn theo ĐVT khác (user thêm 28/10)

Nhu cầu: đang tồn 1000 tờ, bấm đổi sang ram thì thấy số theo ram. Giấy có nhiều ĐVT nên cần đổi qua lại.

- **Chỉ đổi cách HIỂN THỊ.** Lô vẫn lưu theo đơn vị gốc như nay (khổ hai cạnh = tờ, khổ chỉ-rộng = kg). Nhập, xuất,
  giữ chỗ, ngưỡng, báo cáo kho không đổi. File export luôn theo đơn vị gốc dù đang xem ram — để nhập lại không lệch.
- **Chỗ bấm:** ô ĐVT của từng dòng trên màn Tồn kho thành ô chọn. Chỉ liệt kê đơn vị **quy được** từ đơn vị gốc của dòng:
  - cùng họ trong bảng quy đổi của module Đơn vị: tờ ↔ ram (1 ram = 500 tờ), kg ↔ tấn (1 tấn = 1000 kg);
  - giấy khổ hai cạnh: tờ ↔ kg qua định lượng và khổ (`kho_giay.kg_tu_to` / `to_tu_kg`, đang dùng cho cột Quy kg);
  - đơn vị không quy được thì không hiện, không đoán.
- **Số đổi theo:** Đang có, Sắp xuất, Sắp về, Dự kiến còn, Mức tồn của dòng đó. **Giá trị không đổi** (cùng một lượng hàng).
  Số lẻ để thập phân: 1200 tờ = 2,4 ram.
- **Ví dụ của user:** 1000 tờ = **2 ram** theo bảng quy đổi đang có (1 ram = 500 tờ), không phải 500. Xưởng tính ram khác
  thì sửa ở module Đơn vị, màn kho tự theo.
- **Nhớ lựa chọn** theo từng mặt hàng ở máy người xem (localStorage, như độ rộng cột) — mở lại vẫn thấy ram.
- **Cột Quy kg bỏ đi:** chọn kg ở ô ĐVT là thấy, giữ thêm cột là nói một thông tin hai lần.
- Máy chủ trả sẵn hệ số quy đổi của từng dòng (đơn vị → hệ số so với gốc) cùng dữ liệu tồn — giao diện chỉ nhân/chia,
  không tự tính quy đổi.

## 8. Việc phải làm (để viết plan)

1. Backend — service `services/kho_nhap_tay.py`: tra mã (giấy + vật tư), chuẩn hoá khổ/ĐVT, tính dòng mới/cập nhật/không đổi,
   ghi phiếu nhập tay và phiếu xuất nhập tay qua đường ghi sổ hiện có (`stock_voucher_service`), xoá dòng (mục 3.4).
2. Backend — Excel: mẫu, đọc file, xem trước, ghi; export theo dòng tồn; cắt cột tiền theo quyền.
3. Backend — route dưới `/api/kho/{kho_id}/hang…` (thêm/cập nhật, xoá, mẫu, xem trước, ghi, export), kiểm quyền từng ô,
   bắn SSE kế hoạch vật tư sau khi ghi/xoá.
4. Quyền: ô chi tiết `can_adjust` cho dòng `ton_kho_<id>` (`quyen_kho.py`, `PermissionMatrix.tsx` cạnh ô Xem giá thành), nhật ký (`audit_registry`) cho thêm/cập nhật/xoá/import.
5. Frontend `KhoTonKhoPage`: thanh công cụ Thêm hàng / Import / Export / Xoá (theo quyền), ngăn Thêm–Cập nhật,
   hộp Import có bảng xem trước, hộp xác nhận Xoá.
6. Xem theo ĐVT khác (mục 7b): API tồn trả hệ số quy đổi từng dòng; ô ĐVT thành ô chọn; bỏ cột Quy kg.
7. Test: pytest cho từng luật mục 3–6; vitest cho form và xem trước; bấm thử đủ luồng trên DB sao chép.

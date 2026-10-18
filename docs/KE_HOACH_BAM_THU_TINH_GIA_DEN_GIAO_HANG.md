# Kế hoạch bấm thử end-to-end theo use case — Sao Việt Nhật ERP

Ngày lập: 18/10/2026. Nguồn use case: soát code hiện tại của 9 khu vực (danh mục, kinh doanh, đơn bán
và cọc, sản xuất và KCS, thu mua và vật tư, kỹ thuật máy, kho, giao hàng, kế toán và báo cáo, nhân sự
và lương, quản trị hệ thống). Nhãn nút trong bảng chép đúng chữ trên giao diện.

## 0. Cách chạy

- **Môi trường:** bản sao DB `svn_erp_ui_luong` (chép từ `svn_erp_trong`), Redis riêng cổng 6392,
  backend 8010, frontend 5174. DB dev và server dev 8000/5173 không bị đụng. Xong việc thì tắt server
  thử, xoá Redis riêng, xoá bản sao DB.
- **Thao tác thật:** mọi bước bấm bằng chuột và gõ bằng bàn phím trên giao diện. Không gọi API thay
  bước nào. Bước nào buộc phải đi tắt thì ghi ngay ở bước đó, kèm lý do.
- **Ảnh và tệp:** khung trình duyệt của ứng dụng không có hộp chọn tệp. Các bước bắt buộc ảnh (đóng
  phiếu sửa, xong bảo trì, lỗi KCS cuối) làm bằng trình duyệt Playwright, tải tệp ảnh mẫu, và ghi rõ.
- **GPS:** chấm công cần vị trí. Ghi đè `navigator.geolocation` bằng toạ độ điểm chấm công và ghi rõ là
  vị trí giả lập.
- **Nhiều vai:** cấp tài khoản thử cho từng vai ở bước A3, rồi chạy song song hai trình duyệt (tab
  ứng dụng + Playwright) đăng nhập hai vai khác nhau, để kiểm thông báo tức thời (badge nhảy, toast)
  tới đúng người nhận mà không phải tải lại trang.
- **Ghi chép:** mỗi use case ghi bấm gì, gõ gì, thấy gì; ca chặn chép nguyên câu báo lỗi. Kết quả
  ghi theo mã UC: Đạt / Lỗi (mô tả) / Không làm được trên giao diện (lý do).
- **Lỗi chặn luồng:** dừng, tìm nguyên nhân, báo lại trước khi sửa code.
- **Dữ liệu thử:** tên có tiền tố `E2E` để tách khỏi dữ liệu có sẵn trong bản sao.

Ký hiệu cột "Loại": **C** = luồng chính, **R** = nhánh rẽ, **X** = hệ thống phải chặn.

## A. Hệ thống, nhân sự, phân quyền

| Mã | Loại | Use case | Thao tác | Phải thấy |
|---|---|---|---|---|
| A1 | C | Tạo phòng và tổ | Phòng ban → "Thêm phòng con" → tạo tổ E2E In, E2E Cán, E2E Bế, E2E KCS, E2E Giao hàng | Cây phòng có các tổ mới |
| A2 | X | Trùng tên phòng | Tạo lại "E2E In" cùng cấp | "Tên phòng ban đã tồn tại" |
| A3 | C | Vai trò, phân quyền, tài khoản | "+ Vai trò" cho Sale, Kế toán, Thu mua, Kho, Tổ trưởng, KCS, Giao hàng → "Sửa ma trận phân quyền" → "Lưu thay đổi"; Hồ sơ nhân sự → "Thêm nhân viên" → tab "Tài khoản & Quyền" → "Cấp tài khoản" | Đăng nhập được từng vai, menu chỉ hiện đúng module của vai |
| A4 | X | Quyền đổi tức thời | Đang đăng nhập vai Sale, admin gỡ một ô quyền | Menu của Sale tự đổi, không cần tải lại |
| A5 | X | Tự khoá mình | "Khóa tài khoản" trên chính tài khoản đang dùng | Bị chặn |
| A6 | C | Ca, điểm chấm công, lịch | Chấm công → "Khai ca" → "Đặt ca nền"; "+ Thêm điểm chấm công"; "Lịch & Ngày lễ" | Nhân viên có ca và điểm chấm |
| A7 | C | Mức khoán km | Lương → Cấu hình lương → "Khoán km giao hàng" → thêm mức | Có mức để gán cho xe |
| A8 | C | Nhật ký | Nhật ký → lọc theo người làm và hành động | Các thao tác ở trên đều có dòng, nhãn tiếng Việt |

## B. Danh mục nền (theo đúng thứ tự phụ thuộc)

| Mã | Loại | Use case | Thao tác | Phải thấy |
|---|---|---|---|---|
| B1 | C | Đơn vị và quy đổi | Đơn vị & quy đổi → "Thêm" E2E-tờ, E2E-ram → "Thêm quy đổi" 1 ram = 500 tờ | Quy đổi hiện cả hai chiều |
| B2 | X | Quy đổi sai | Quy đổi đơn vị về chính nó; hệ số 0; thêm trùng cặp | "Hai đơn vị phải khác nhau." / "Số quy đổi phải lớn hơn 0." / "Đã có quy đổi X → Y." |
| B3 | C | Kho và vị trí | Khai báo kho → "Thêm kho hàng" E2E Kho giấy → tab "Vị trí kho" → thêm "Kệ A1" | Kho mới có mục riêng trong menu Kho hàng |
| B4 | X | Kho thành phẩm cố định | Mở KHO-TP, thử đổi tên hoặc xoá | Bị khoá |
| B5 | C | Giấy | Giấy → "Thêm giấy": định lượng, ĐVT, đơn giá, công thức | Có trong ô chọn giấy của phiếu tính giá |
| B6 | X | Giấy sai | Định lượng 0; mã trùng | "GSM phải > 0." / "Mã đã tồn tại!" và nút Lưu khoá |
| B7 | C | Vật tư khác | Kẽm, mực, màng cán: ĐVT + Công thức định mức | Có trong ô thêm vật tư của công đoạn |
| B8 | C | Máy và gói bảo trì | Thiết bị & Máy móc → máy in, máy cán, máy bế: Nhóm máy, tốc độ, đơn vị tốc độ, thời gian chuẩn bị; tab "Lịch bảo trì" → "＋ Thêm gói bảo trì" | Máy có lịch bảo trì dự kiến |
| B9 | X | Máy sai | Tốc độ 0 | "Tốc độ phải > 0. [E-MAY-SPEED]" |
| B10 | C | Công đoạn | In offset, Cán màng, Bế (tick "Bước này cần khuôn"), Cắt thành phẩm: Giai đoạn, Tổ, máy + "Cách đo giờ chạy", công thức giá, đơn vị vào/ra, bù hao, vật tư; tab Khoán | Dùng được trong chuỗi công đoạn của phiếu tính giá |
| B11 | X | Công đoạn sai | Khai một máy hai lần; khoán thiếu đơn giá | "Một máy chỉ khai được một lần trong công đoạn." / "Cấu hình khoán cần đủ đơn vị tính và đơn giá." |
| B12 | C | Tiêu chí KCS | Tiêu chí KCS → chọn công đoạn → "Tiêu chí mới" (Enter) → kéo đổi thứ tự → "Chép sang công đoạn khác" | Tiêu chí hiện ở form kiểm KCS (kiểm lại ở I2) |
| B13 | C | Khách hàng | "Tạo khách hàng" E2E Khách: MST, liên hệ, "Thêm điểm giao", hạn mức, số ngày công nợ, chiết khấu và markup cho phép | Khách có điểm giao mặc định |
| B14 | X | Khách sai | MST 9 số; chiết khấu tối thiểu lớn hơn tối đa | "MST phải gồm 10 hoặc 13 chữ số." / "Chiết khấu tối thiểu không được lớn hơn tối đa." |
| B15 | C | Khuôn | Khuôn → "Thêm": khách E2E, Loại "Khuôn bế", tình trạng "Đang dùng" | Mã KB tự sinh |
| B16 | C | Nhà cung cấp và bảng giá | "+ Thêm nhà cung cấp" E2E NCC giấy, E2E NCC vật tư (đủ 7 trường), "Số ngày cho nợ", "Tính hạn từ", "Bảng giá vật tư" → "Thêm một dòng"; một NCC tick "Nhận gia công ngoài" | NCC dùng được khi lập đơn mua |
| B17 | X | NCC sai | SĐT 9 số; MST trùng NCC khác | "Số điện thoại phải đủ 10 chữ số…" / "Mã số thuế … đã dùng cho nhà cung cấp …" |
| B18 | C | Xe giao hàng | Xe → Biển số + Mức khoán km (từ A7) | Xe hiện ở ô chọn xe khi lên đơn giao |
| B19 | C | Mục thu chi, tài khoản ngân hàng | Mục thu chi → thêm mục Chi "E2E Văn phòng phẩm"; Tài khoản ngân hàng → "Thêm tài khoản" (Nhận tiền + Trả tiền) | Hiện trong ô chọn khi lập phiếu |
| B20 | R | Xoá danh mục đang dùng | Xoá một giấy đã có trong phiếu tính giá cũ | Hộp "Ngừng dùng", liệt kê nơi đang dùng; danh mục chưa ai dùng thì "Xóa hẳn" |
| B21 | R | Excel danh mục | Giấy → "Xuất Excel" → sửa 1 dòng → "Nhập Excel", file có thêm 1 dòng lỗi | Xem trước báo lỗi, không ghi dòng nào |

## C. Kinh doanh: tính giá, báo giá, đơn, cọc

Đơn chính **E2E-1**: tờ rơi in offset 4/4, cán màng, bế, 2 mức số lượng, cọc 30%. Đơn phụ **E2E-2**
(cùng khách, không cọc) dùng để thử thu gộp và giao từ tồn. Đơn **E2E-3** để thử huỷ.

| Mã | Loại | Use case | Thao tác | Phải thấy |
|---|---|---|---|---|
| C1 | C | Lập phiếu tính giá | Tính giá → "+ Lập phiếu tính giá" → chọn khách E2E, "Giao tới", "Người nhận" → "+ Thêm sản phẩm": tên, SL, khổ, giấy, máy in, quy cách "Tự trở", chuỗi In → Cán → Bế (phí khuôn "Có sẵn") → Cắt → "Xong" → "Tính giá & lưu" | Mã PTG-2026-…, giá vốn khớp số bên phải modal |
| C2 | X | Phiếu trống, in hai lần | "Tính giá & lưu" khi chưa có sản phẩm; thêm bước in thứ hai | Nút khoá kèm câu nhắc; "Chuỗi đã có bước in…" |
| C3 | R | Nhiều mức số lượng, gộp dòng | "Nhân bản sản phẩm" → đổi SL; tick 2 dòng → "Gộp khi báo giá" → "Bỏ gộp" | Hai mức SL, gộp và bỏ gộp đều tự tính lại |
| C4 | R | Chi phí khác, giao hàng | Khối ⑤ "Chi phí giao hàng", khối ⑥ "Khoản chi thêm" | Giá vốn tăng đúng số |
| C5 | R | Nhân bản phiếu | "Nhân bản" | Phiếu mới, không mang báo giá |
| C6 | R | Thoát khi chưa lưu | Phiếu mới có sản phẩm → "Danh sách" | Hỏi "Phiếu này chưa được lưu…" |
| C7 | R | Danh mục đổi sau khi tính | Đổi đơn giá giấy B5 → mở lại phiếu | Băng "Danh mục đã đổi…", "Tính giá lại" ra giá mới |
| C8 | C | Lập báo giá | "Báo giá →" → sửa markup, "Chiết khấu", VAT, diễn giải → "Lưu nháp điều khoản" | BG26-…, Nháp; số khớp phiếu |
| C9 | X | Một phiếu một báo giá, hạn quá khứ | Bấm lại "Báo giá →" (phải thành "Mở BG… →"); đặt hạn hôm qua | Không sinh báo giá thứ hai; "Hạn hiệu lực không được ở quá khứ." |
| C10 | R | Báo giá đặc thù | Chiết khấu vượt mức cho phép của khách → "Gửi khách" bị chặn → "Trình duyệt" | Chặn gửi khách; sang "Chờ duyệt"; người duyệt nhận toast và badge |
| C11 | R | Từ chối, phiên bản mới | Người duyệt "Từ chối (trả lại)" kèm lý do → Sale nhận toast → "Tạo phiên bản mới" (lý do) → "So sánh" | v2 Nháp, v1 "Đã thay thế" |
| C12 | X | Duyệt không lý do | "Duyệt" khi ô lý do trống | "Nhập lý do/ý kiến — bắt buộc…" |
| C13 | C | Duyệt, gửi khách, khách chốt | "Duyệt" → "Gửi khách" → "Khách chốt" → chọn sản phẩm → "Xác nhận khách chốt" | "Khách đồng ý"; dòng không chọn ghi "Khách không lấy" |
| C14 | R | Khách từ chối | Báo giá của E2E-3 → "Gửi khách" → "Khách từ chối" | "Bị từ chối" |
| C15 | R | Báo giá đổi theo phiếu | Sửa SL ở phiếu đã có báo giá đã gửi → "Tạo phiên bản mới theo phiếu" | v+1 giữ markup, chiết khấu, diễn giải |
| C16 | R | Xem bản in | "Xem bản in" (chặn hộp in của trình duyệt trước khi bấm) | Bản in gộp mức SL, đơn giá chưa VAT |
| C17 | C | Tạo đơn từ báo giá | "Tạo đơn hàng" | Sang Đơn hàng bán, đơn Nháp, chỉ có dòng khách chốt |
| C18 | X | Chốt khi thiếu điều kiện | Chặng Chốt khi chưa có PO và ngày giao | Danh sách điều còn thiếu, nút "Chốt đơn" khoá |
| C19 | C | Sửa đơn nháp và chốt | "Sửa" → PO, "% cọc" 30, "Ngày giao cam kết" → "Lưu" → "Chốt đơn" | Đã chốt; báo giá "Đã lên đơn"; thành phẩm TP-… tự sinh; Kế toán nhận badge cọc chờ thu |
| C20 | R | Lưu ý sản xuất sau chốt | Thẻ "Lưu ý sản xuất" → "Hàng gấp…" → "Lưu và báo xưởng" | Bàn Kế hoạch nhận ngay |
| C21 | C | Thu cọc thiếu rồi đủ | Phiếu thu → "Đơn hàng chờ thu" → popup cọc → "Lập phiếu thu cọc" 10% → rồi phần còn lại | Lần 1: đơn còn "Chờ cọc". Lần 2: đơn tự xuống Kế hoạch SX, Sale nhận toast "đủ cọc", Kế hoạch nhận toast |
| C22 | X | Thu cọc sai | Chuyển khoản thiếu mã giao dịch; số 0 | "Thu qua ngân hàng phải có mã giao dịch…" / "Số tiền thu phải lớn hơn 0." |
| C23 | R | Không cọc | Đơn E2E-2 % cọc trống → "Chốt đơn" | Xuống sản xuất ngay lúc chốt |
| C24 | R | Huỷ đơn | E2E-3 nháp → "Hủy đơn" (lý do); một đơn đã chốt có cọc → "Hủy đơn" + "Lỗi tại ai" | Báo giá dùng lại được; tiền cọc vào "Chờ trả lại khách" |
| C25 | X | Huỷ đơn khi đang giao | Huỷ E2E-1 lúc có yêu cầu giao đang chạy (làm ở K) | "Đơn còn yêu cầu giao hàng đang chạy…" |

## D. Kế hoạch sản xuất và lệnh

| Mã | Loại | Use case | Thao tác | Phải thấy |
|---|---|---|---|---|
| D1 | C | Tạo lệnh từ đơn | Kế hoạch sản xuất → "Hàng chờ tiếp nhận" → bấm E2E-1 → "Xác nhận tạo N lệnh sản xuất" | Lệnh Nháp; flash "Đã tạo N lệnh" |
| D2 | X | Lệnh trùng | Mở lại đơn đã đủ lệnh | "Tất cả dòng của đơn này đã lên lệnh." |
| D3 | C | Routing và DAG | Tab Công đoạn → đổi thứ tự (▲▼), mở bước → gán tổ, máy, khuôn (B15) → tab "Phụ thuộc" tick tiền nhiệm → "Lưu công đoạn" (ghi lý do vì khác bài tính giá) | Cột "Tiền nhiệm" đúng |
| D4 | X | Vòng lặp DAG | Cho bước đầu phụ thuộc bước cuối | "Phụ thuộc công đoạn tạo thành vòng lặp" |
| D5 | X | Sẵn sàng khi thiếu dữ liệu | Bỏ máy một bước → "Sẵn sàng lập kế hoạch" | Khối "Còn thiếu N mục" và link "Sửa →" mở đúng bước |
| D6 | C | Sẵn sàng | Bổ sung đủ → "Sẵn sàng lập kế hoạch" | Lệnh vào khay Xếp lịch; toast "Lệnh X vừa vào hàng chờ xếp lịch" |
| D7 | R | Mở lại, xoá lệnh | "Mở lại để sửa"; lệnh phụ → "Xoá lệnh" | Dòng đơn quay lại hàng chờ |
| D8 | R | Gia công trọn gói | Lệnh của E2E-2 → "Gia công trọn gói" (NCC nhận gia công) → "Đã mang đi" → "Nhận hàng về" → "Chốt số nhận về" | Phiếu chi có "Gia công chờ chi" (làm tiếp ở L8) |

## E. Vật tư và mua hàng

| Mã | Loại | Use case | Thao tác | Phải thấy |
|---|---|---|---|---|
| E1 | C | Kế hoạch vật tư | Kế hoạch vật tư → "Theo lệnh" → dòng E2E-1 "Cần mua" → "Đề nghị mua" → gõ "Ngày cần hàng" → "Gửi yêu cầu" | Yêu cầu mua loại "Cho lệnh SX"; Thu mua nhận toast |
| E2 | R | Yêu cầu mua của phòng ban | Yêu cầu mua hàng → "+ Tạo yêu cầu mua" loại "Mua tồn kho" (giấy + vật tư) → "Gửi yêu cầu" | "Chờ lập đơn" |
| E3 | X | Yêu cầu mua sai | Ngày quá khứ; giấy thiếu khổ; tạo tay loại cho lệnh SX | "Ngày cần hàng không được nhỏ hơn hôm nay." / "… chưa có khổ" / "Mua cho lệnh sản xuất thì lập từ Kế hoạch vật tư." |
| E4 | R | Bỏ một món, huỷ yêu cầu | "Bỏ món này" (lý do) → "Huỷ một phần"; một yêu cầu khác → "Huỷ yêu cầu" | Trạng thái đúng |
| E5 | C | Lập đơn gộp | Mua hàng → "Xem theo Từng món" → tick món của 2 yêu cầu → "Lập đơn mua cho N món" → kiểm NCC rẻ nhất → "Lưu N đơn" | Mỗi NCC một đơn Nháp; yêu cầu sang "Đang lập đơn" |
| E6 | X | Đơn mua sai | Chọn NCC không bán món đó; NCC đã ngừng hợp tác | "Nhà cung cấp này không bán …" / "Nhà cung cấp đang ngừng hợp tác." |
| E7 | C | Cọc và gửi duyệt | Ô "Cọc" → "Gửi duyệt" | Kế toán nhận toast "Có đơn mua hàng … chờ xử lý" |
| E8 | X | Cọc vượt tổng | Cọc lớn hơn tổng đơn | "Cọc lớn hơn tổng đơn…" |
| E9 | R | Từ chối, gửi lại | Kế toán → Đơn mua hàng → "Từ chối" (lý do) → Thu mua sửa → "Gửi duyệt lại" → "Duyệt" | Người lập nhận toast từ chối rồi duyệt |
| E10 | C | Đặt hàng, chi cọc | "Đã đặt hàng"; Phiếu chi → "Mua hàng chờ chi" → cọc → "Lập phiếu chi" | "Chờ hàng về"; người lập đơn nhận toast "Kế toán đã lập chứng từ…" |
| E11 | C | Đợt giao một phần | "Ghi đợt giao" → nhận một phần, "Ngày nhận hàng", hoá đơn NCC (Ký hiệu, Số, Ngày) → "Lưu đợt giao" | "Về một phần"; khối tiền: tiền đợt − trừ cọc = còn phải trả, hạn trả theo NCC |
| E12 | X | Đợt giao sai | Ngày nhận ngày mai; có ký hiệu mà thiếu số hoá đơn | "Ngày giao không được ở tương lai…" / "Có ký hiệu thì phải có số hoá đơn." |
| E13 | C | Nhập kho từ đợt | Dòng đợt → "Gửi kho" → "Gửi kho"; Kho → "Phiếu từ yêu cầu" → "Lập phiếu" → "Tạo và ghi sổ" | Đợt "Đã nhập kho"; tồn E2E Kho giấy tăng |
| E14 | C | Chi gộp nhiều khoản cùng NCC | Đợt 2 → Phiếu chi tick đợt 1 + đợt 2 → "Lập một phiếu chi" → sửa "Chi lần này" → "Lập phiếu chi" | Một số PC, bảng phân bổ; công nợ phải trả giảm đúng |
| E15 | X | Sửa đợt đã chi, huỷ đơn đã chi | "Sửa" đợt đã có phiếu chi; "Huỷ phiếu" đơn đã có phiếu chi | "Đã chi, khoá sửa"; "Phiếu đã có chứng từ thanh toán nên không thể hủy." |
| E16 | R | Đóng đơn thiếu | Đơn còn "Về một phần" → "Đóng đơn" (lý do) | "Đã về đủ", nợ chốt theo số đã giao |
| E17 | R | Giữ hàng, nhả hàng | Kế hoạch vật tư → "Giữ hàng" cho lệnh → "Nhả hàng" | Tình trạng đổi "Chưa giữ" ↔ "Có trong kho" |
| E18 | R | Tạo yêu cầu mua từ tồn | Kho → mặt hàng dưới ngưỡng → "Tạo yêu cầu mua" | Form điền sẵn loại "Mua tồn kho" |

## F. Xếp lịch và phát hành

| Mã | Loại | Use case | Thao tác | Phải thấy |
|---|---|---|---|---|
| F1 | C | Đặt giờ bắt đầu | Xếp lịch → kéo lệnh từ khay "Chờ xếp lịch" lên lưới; chỉnh bằng "Lùi 15 phút" / "Tới 15 phút" | Lệnh có ngày kết thúc; bước sau chờ bước trước theo DAG |
| F2 | R | Ngoài giờ | Thả vào giờ nghỉ | "Ngoài giờ chạy — đã dời sang …" |
| F3 | X | Phát hành khi chưa có giờ | Lệnh chưa xếp → "Phát hành" | "Lệnh chưa có giờ bắt đầu…" |
| F4 | C | Phát hành | "Phát hành" (hoặc "Phát hành cả cụm") | Từng tổ nhận toast "Tổ có việc mới"; tổ Cắt nhận "chờ chốt giấy" |
| F5 | R | Thu hồi và phát lại | "Thu hồi phát hành" (lý do) → phát hành lại; tab "Lịch sử phát hành" so hai phiên bản | Việc của tổ biến mất rồi có lại |
| F6 | X | Thu hồi khi đã chạy | Sau khi tổ đã bắt đầu (G4) → "Thu hồi phát hành" | Nút mờ; chỉ còn "Phát hành cập nhật" |
| F7 | R | Vùng khoá máy | Tạo vùng khoá "bảo trì" cho máy bế | Máy hiện "Đang bảo trì", lệnh không xếp vào vùng đó |

## G. Bàn tổ (thực hiện sản xuất)

| Mã | Loại | Use case | Thao tác | Phải thấy |
|---|---|---|---|---|
| G1 | C | Cấp vật tư công đoạn | Bàn tổ In → việc → tab "Vật tư" → "Yêu cầu cấp vật tư" → "Gửi kho"; Kho → "Lập phiếu xuất" → "Tạo và ghi sổ" | Tồn giấy giảm; cột "Kho đã xuất" trên bàn tổ tăng |
| G2 | X | Kho xuất âm, đề nghị trùng | Xin quá tồn; tạo đề nghị mới khi đề nghị cũ chưa lập phiếu | "… không đủ để xuất. Kho không cho xuất âm." / "Đang có đề nghị chưa được kho lập phiếu…" |
| G3 | C | Chốt giấy | Bàn tổ Cắt → "Chờ chốt giấy" → "Không cần cắt" hoặc "Thêm công đoạn" | Tổ In nhận toast "Tổ Cắt đã chốt giấy" |
| G4 | X | Bắt đầu khi chưa đủ | "Bắt đầu" khi chưa giao thợ / chưa nhận khuôn / bước trước chưa bàn giao | Khung "Chưa bắt đầu được vì…" đúng từng lý do |
| G5 | C | Giao thợ, nhận khuôn, bắt đầu | "Giao người" → "Đã nhận khuôn" → "Bắt đầu" | Đang chạy; thợ được giao nhận toast |
| G6 | C | Ghi sản lượng nhiều lần | Tab "Sản lượng" → "Ghi sản lượng" Lần 1, Lần 2 | Mỗi lần một dòng "Lần N" |
| G7 | X | Vượt trần | Ghi vượt số nhận từ bước trước | "Vượt … — lần này ghi tối đa X" |
| G8 | R | Sửa số, tạm dừng | "Sửa số" (lý do "Gõ nhầm"); "Tạm dừng" (lý do) → "Tiếp tục" | Số và trạng thái đúng |
| G9 | C | Bàn giao | "Giao và nhận" → "Đề xuất giao" → tổ nhận "Xác nhận" | Tổ nhận nhận toast; bước sau mở |
| G10 | X | Kết thúc khi chưa giao hết | "Kết thúc" khi còn hàng chưa đề xuất giao | "Còn X chưa đề xuất giao sang Y…" |
| G11 | R | Đổi máy | "⋯" → "Đổi máy" (lý do) | Phiên máy mới |
| G12 | R | Báo sự cố | "⋯" → "Báo sự cố" → tick "Máy đang dừng…" → "Gửi yêu cầu" | Việc tự tạm dừng; tổ sửa chữa nhận toast (làm tiếp ở H1) |
| G13 | R | Nhập lại vật tư thừa | Tab Vật tư → "Nhập lại" → kho nhập | Cột "Nhập lại" và "Thực dùng" đúng |

## H. Kỹ thuật máy

| Mã | Loại | Use case | Thao tác | Phải thấy |
|---|---|---|---|---|
| H1 | C | Nhận sửa | Sửa chữa máy → "Yêu cầu báo hỏng" (chấm đỏ) → "Nhận sửa" | Sinh phiếu SC; người báo nhận toast "đã được tiếp nhận" |
| H2 | R | Từ chối yêu cầu | Yêu cầu khác → "Từ chối" (lý do) | Người báo nhận toast kèm lý do |
| H3 | X | Đóng phiếu không ảnh | "Xác nhận đã sửa xong" khi chưa có ảnh sau | Nút khoá "Chụp ít nhất 1 ảnh…" |
| H4 | C | Đóng phiếu | "Đã sửa gì" → "Lưu"; tải ảnh sau (Playwright) → "Xác nhận đã sửa xong" | "Đã sửa xong"; dòng máy ở bàn tổ tự mất |
| H5 | R | Báo hỏng trực tiếp | "Báo máy hỏng" (vai tổ) | Tổ sửa chữa nhận toast |
| H6 | C | Bảo trì định kỳ | Phiếu bảo trì → "Lịch" → ô "Dự kiến" → "Tạo phiếu ngay" → tick việc, một việc "Không áp dụng" (lý do) → ảnh sau → chọn "Ngày làm xong" → "Xác nhận đã bảo trì xong" | "Đã xong", kỳ kế tiếp tính lại |
| H7 | X | Bảo trì sai | Xong khi còn việc chưa tick; ngày làm xong là ngày mai; tạo phiếu trùng kỳ | Đúng từng câu chặn |
| H8 | R | Việc ngoài lịch, huỷ, mở lại | "Thêm việc ngoài lịch" → "Hủy phiếu" (lý do) → "Mở lại phiếu (hủy nhầm)" | Trạng thái đúng |

## I. KCS

| Mã | Loại | Use case | Thao tác | Phải thấy |
|---|---|---|---|---|
| I1 | C | Ghi lỗi công đoạn giữa | KCS → lệnh → sơ đồ nhóm → bước In → "Ghi lỗi" → tick tiêu chí, "Số lỗi" → "Lưu lỗi" | Tổ In nhận chấm đỏ; trần ghi của bước giảm |
| I2 | C | Kiểm công đoạn cuối, quy lỗi | Bước cuối → "Kiểm hàng N" → tiêu chí (khai ở B12) → "Lỗi do công đoạn nào" = Cán → ảnh (Playwright) → "Lưu kết quả kiểm" | Tổ Cán nhận toast bắt lỗi; tab KCS của tổ Cán có lỗi "bắt ở …" |
| I3 | X | Kiểm sai | Đạt + lỗi vượt số tổ đã làm; quy lỗi về bước sau | Đúng câu chặn |
| I4 | C | Gửi nhập kho | "Gửi nhập kho N" → "Gửi yêu cầu" | Kho nhận chuông; số gửi = phần đạt chưa gửi |
| I5 | X | Gửi lại khi hết số | Bấm lại khi không còn số đạt | "Không còn số đạt chưa gửi kho ở công đoạn này." |
| I6 | R | Đóng và mở lại nhóm | "Đóng lệnh nhóm" → "Mở lại nhóm" | Lệnh "Đã đóng" rồi mở lại |

## J. Kho thành phẩm

| Mã | Loại | Use case | Thao tác | Phải thấy |
|---|---|---|---|---|
| J1 | C | Nhập một phần | Kho → "Phiếu từ yêu cầu" → yêu cầu nhập TP → "Lập phiếu" → nhập ít hơn, ghi lý do → "Tạo và ghi sổ" | "Đã cấp một phần"; KCS nhận tin; tồn KHO-TP tăng |
| J2 | X | Nhập thiếu không lý do | Nhập ít hơn, để trống lý do | "… nhập ít hơn số còn phải nhập. Ghi lý do…" |
| J3 | C | Nhập nốt | "Lập phiếu tiếp" → nhập đủ | "Hoàn tất" |
| J4 | C | Gõ giá gốc lô | Báo cáo kho → "Giá gốc thành phẩm" → gõ giá → "Lưu giá gốc" | Báo cáo NXT đổi theo |

## K. Giao hàng

| Mã | Loại | Use case | Thao tác | Phải thấy |
|---|---|---|---|---|
| K1 | C | Yêu cầu giao một phần | Đơn E2E-1 → chặng Giao → "Tạo yêu cầu giao hàng" → giảm số, "Ngày cần giao" → "Gửi yêu cầu" | YCGH "Chờ lên đơn"; màn Giao hàng nhảy ngay |
| K2 | X | Giao vượt, giao hàng chưa nhập kho | Số lớn hơn tồn KHO-TP; ngày hôm qua | "… mới giao được n (tồn Kho thành phẩm …)…" / "Ngày cần giao đã qua" |
| K3 | C | Lên đơn giao | Giao hàng → "Lên đơn giao" → Xe, "Tài xế", "Phụ xe", "Lượt mới…" → "Lên đơn giao hàng" → bước "Đề nghị xuất kho" "Ngày cần", "Giờ cần" → "Lưu cho kho" | "Chờ kho xuất"; kho và tài xế nhận tin |
| K4 | X | Tài xế trùng phụ xe | Chọn cùng một người | "Tài xế và phụ xe không được là cùng một người" |
| K5 | C | Kho xuất | Kho → yêu cầu XUẤT "Giao hàng" → "Lập phiếu xuất" (lô của đúng đơn) → "Tạo và ghi sổ" | Chuyến "Đã lấy hàng"; tài xế nhận tin "Kho đã xuất hàng…" |
| K6 | X | Bắt đầu khi chưa lấy hàng | Một chuyến khác chưa xuất → "Bắt đầu giao" | "Chưa lấy hàng thì chưa bắt đầu giao được" |
| K7 | C | Giao đủ | "Bắt đầu giao" (số đồng hồ) → "Nhập kết quả" → "Nhận đủ" → "Lưu kết quả" → "Về kho" | Chuyến "Giao thành công"; đơn cộng "đã giao" |
| K8 | R | Giao thiếu | YC thứ hai → … → "Nhận thiếu" số nhỏ hơn → kho nhập trả | Đơn cộng đúng số thực nhận; phần còn lại trở về "Còn phải giao" |
| K9 | R | Giao thất bại | YC thứ ba → "Không giao được" + lý do → kho ghi sổ phiếu nhập trả | "Đang trả hàng" → "Đã trả hàng" |
| K10 | X | Đồng hồ chạy lùi | Số đồng hồ nhỏ hơn số trước | "… đồng hồ không chạy lùi." |
| K11 | R | Lượt xe nhiều yêu cầu | Tick 2 YC → "Lên lượt xe (2)" | Một lượt, hai chuyến, hai đề nghị xuất |
| K12 | R | Đổi người, huỷ chuyến | Trước khi kho lập phiếu → "Đổi / huỷ chuyến" → "Huỷ chuyến" (lý do) | YC "Chuyến đã huỷ"; đề nghị xuất huỷ theo |
| K13 | X | Huỷ chuyến sau khi kho đã lập phiếu | "Huỷ chuyến" | "Kho đã lập phiếu xuất cho chuyến này…" |
| K14 | R | Giao từ tồn theo mã | Đơn tái bản cùng mã (E2E-2) → "Tạo yêu cầu giao hàng" | "Giao được ngay" tính cả tồn của mã |
| K15 | R | Chứng từ giao, in phiếu | Ngăn lượt → "Chứng từ" → "Thêm file" (Playwright); đơn → "In phiếu giao" | Tệp nằm ở chuyến; bản in đúng số |
| K16 | X | Kho huỷ DNX của chuyến | Kho "Hủy yêu cầu" xuất của một chuyến | Xác nhận lỗ đã biết: chuyến có kẹt "Chờ kho xuất" không |

## L. Hoá đơn, thu tiền, chi khác

| Mã | Loại | Use case | Thao tác | Phải thấy |
|---|---|---|---|---|
| L1 | C | Ghi hoá đơn theo lượt | Đơn → chặng Hóa đơn → lượt đã nhận → "Ghi hóa đơn" (Ký hiệu, Số, Ngày, Giá trị) → "Ghi nhận" | Hạn thu = ngày HĐ + số ngày công nợ; cọc trừ vào HĐ; Phiếu thu có badge |
| L2 | X | Hoá đơn sai | Trùng số và ký hiệu; ngày trước ngày chốt; vượt phần chưa ghi | Đúng từng câu chặn |
| L3 | C | Thu gộp nhiều khoản cùng khách | "Đơn hàng chờ thu" → tick HĐ E2E-1 + HĐ E2E-2 → "Lập một phiếu thu" → "Thu lần này" → "Lập phiếu thu" | Một PT nhiều dòng; công nợ phải thu giảm đúng |
| L4 | X | Thu gộp khác khách | Tick khoản của khách khác | Ô bị khoá "Khác khách hàng" |
| L5 | R | Huỷ hoá đơn đã thu | "Hủy" HĐ (lý do) | Tiền về quỹ của đơn; nếu dư sinh "Chờ trả lại khách" |
| L6 | C | Trả lại tiền khách | Phiếu chi → "Chờ trả lại khách" (đơn huỷ ở C24) → "Lập phiếu chi" | Phiếu chi "Trả lại tiền khách"; đơn hết tiền giữ |
| L7 | C | Chi khác theo mục | "Lập phiếu chi" đầu trang → mục "E2E Văn phòng phẩm" | Vào Báo cáo thu chi đúng mục |
| L8 | C | Chi gia công ngoài | "Gia công chờ chi" (từ D8) → "Lập phiếu chi" | Rời hàng chờ; không vào công nợ phải trả |
| L9 | R | NCC hoàn tiền | Công nợ phải trả → ngăn NCC → "Nhà cung cấp hoàn tiền" | Phiếu thu nguồn hoàn tiền, công nợ NCC đổi |
| L10 | X | Huỷ phiếu chi có phiếu thu gắn | Huỷ phiếu chi đã có phiếu thu lại | Nút mờ "… hủy phiếu thu trước" |
| L11 | C | In phiếu | "In phiếu" PC và PT (chặn hộp in trước) | Mẫu 02-TT / 01-TT, phiếu gộp in từng khoản |

## M. Nhân sự và lương

| Mã | Loại | Use case | Thao tác | Phải thấy |
|---|---|---|---|---|
| M1 | C | Chấm công | Vai tổ trưởng → "CHẤM VÀO" / "CHẤM RA" (GPS giả lập) | Bảng công tháng có công |
| M2 | X | Ngoài vùng | Toạ độ cách xa điểm chấm | "Ngoài phạm vi '…' — còn cách N m" |
| M3 | C | Xin nghỉ, duyệt | "Xin nghỉ phép" → người duyệt "Duyệt" | Người xin nhận toast; ngày nghỉ hiện ở Lịch nghỉ |
| M4 | X | Bắt đầu việc khi thợ nghỉ | Thợ nghỉ hôm nay → bàn tổ "Bắt đầu" | "Người được giao đều nghỉ hôm nay…" |
| M5 | C | Tăng ca | "Gửi phiếu tăng ca" → "Duyệt" | Người gửi nhận toast |
| M6 | C | Tạm ứng sang phiếu chi | "+ Đề nghị tạm ứng" → "Duyệt" → "Lập phiếu chi cho N phiếu" → "Lập 1 phiếu chi" | Phiếu tạm ứng "Đã chi"; phiếu chi có "In bảng kê" |
| M7 | C | Bảng lương | "Chốt công tháng" → "Khởi tạo bảng lương" → "Chốt" → "Công bố phiếu" | Khoán km của tài xế ra tiền từ chuyến ở K; tạm ứng trừ đúng |
| M8 | X | Chốt lương khi chưa đủ | "Chốt" khi kỳ công chưa chốt; huỷ phiếu chi tạm ứng sau khi chốt lương | Nút xám kèm lý do; "… mở lại kỳ lương trước…" |
| M9 | R | Phiếu lương của tôi | Vai thợ → "Phiếu lương của tôi" | Chỉ thấy khi đã công bố |

## N. Tài sản, khoá sổ

| Mã | Loại | Use case | Thao tác | Phải thấy |
|---|---|---|---|---|
| N1 | C | Ghi tăng tài sản | "Thêm tài sản" → "Mua mới" → "Lưu tài sản" | Có khấu hao tháng này |
| N2 | R | Biến động | "Chuyển bộ phận" → "Sửa chữa lớn" → "Thôi dùng" | Khấu hao các tháng sau đổi theo |
| N3 | C | Khoá kỳ kho, tính giá | Báo cáo kho → "Kỳ kế toán" → "Khóa / mở kỳ" → "Khóa sổ" → "Tính giá kỳ" | Giá vốn bình quân |
| N4 | X | Ghi sổ vào kỳ kho đã khoá | Ghi sổ phiếu có ngày trong kỳ đã khoá | "Kỳ kế toán chứa ngày … đã khóa sổ…" |
| N5 | C | Khoá kỳ công nợ | Báo cáo công nợ → "Khoá kỳ" → "Khoá sổ" | Snapshot số dư |
| N6 | X | Lập chứng từ vào kỳ công nợ đã khoá | Lập phiếu thu có ngày trong kỳ đã khoá | Xác nhận lỗ đã biết: hiện KHÔNG bị chặn |

## O. Đối chiếu số cuối luồng

Lấy đúng các chứng từ đã tạo ở trên, so từng con số:

| Mã | Báo cáo | Phải khớp với |
|---|---|---|
| O1 | Báo cáo kinh doanh (kỳ theo ngày chốt) | Ngăn đơn E2E-1, E2E-2: tổng có VAT, đã xuất HĐ, đã thu (cọc + HĐ), còn phải thu |
| O2 | Báo cáo công nợ phải thu (131) và aging | HĐ đã ghi − phiếu thu + trả lại khách; bằng cột "Còn nợ tới…" ở Công nợ phải thu; Sao kê của khách E2E |
| O3 | Báo cáo công nợ phải trả (331) | Đợt giao − phiếu chi NCC + NCC hoàn tiền; bằng màn Công nợ phải trả; phiếu chi gộp chia đúng từng đợt |
| O4 | Báo cáo thu chi | Tổng phiếu chi "Đã chi" và phiếu thu "Đã thu" trong kỳ; phiếu thu gộp tách "Thu cọc" và "Thu tiền hoá đơn"; mục E2E Văn phòng phẩm |
| O5 | Tài khoản ngân hàng | Thu, chi theo kỳ = phiếu đã qua tài khoản đó |
| O6 | Báo cáo kho NXT | Nhập giấy (E13), xuất cho lệnh (G1), nhập lại (G13), nhập TP (J1, J3), xuất giao (K5), nhập trả (K8, K9) |
| O7 | Hồ sơ lệnh, Theo dõi sản xuất | Lệnh E2E-1 qua "Đang sản xuất" → "Sau sản xuất" → "Đã giao đủ"; đơn ở Theo dõi sản xuất khớp |
| O8 | Nhật ký | Mọi thao tác của các phần trên có dòng, đúng người, nhãn tiếng Việt |

## P. Lỗ đã thấy khi soát code — xác nhận bằng thao tác thật

| Mã | Điều cần xác nhận | Kiểm ở |
|---|---|---|
| P1 | Khoá sổ công nợ không chặn lập/huỷ chứng từ trong kỳ đã khoá | N6 |
| P2 | Kho huỷ đề nghị xuất của chuyến, Giao hàng không được báo, chuyến kẹt "Chờ kho xuất" | K16 |
| P3 | Nút "Hủy đơn" của đơn đã chốt hiện cho vai không có quyền sửa đơn (403 khi bấm) | C24, vai Sale hẹp |
| P4 | Nút "Báo giá →" hiện cho vai thiếu quyền tạo báo giá (403) | C8, vai hẹp |
| P5 | Báo cáo kho hiện "Khóa / mở kỳ", "Tính giá kỳ" cho người chỉ có quyền Xem (403) | N3, vai Kế toán xem |
| P6 | Popup Sửa đơn không xoá trống được PO, ngày giao, % cọc | C19 |
| P7 | Thu cọc lẻ cho thu dư, thu gộp chặn thu dư | C21, L3 |
| P8 | Câu nhắc ở Công nợ phải trả bảo lập phiếu chi ở màn Đơn mua hàng (màn đó đã bỏ nút) | E14 |
| P9 | Lương khoán theo sản lượng bàn tổ chưa chảy vào bảng lương (cột Khoán = 0) | M7 |
| P10 | Phiếu sửa chữa đã đóng không mở lại được trên giao diện | H4 |

## Không có trên giao diện (chỉ ghi nhận, không kiểm)

Xoá phiếu tính giá; huỷ báo giá; đính kèm tài liệu báo giá; báo giá tự hết hạn theo ngày; lệnh làm
lại; kiểm kê kho; vật tư/phụ tùng cho sửa chữa; màn "Khoán theo kỳ"; mở lại đơn mua đã nhận đủ; xoá
đơn mua nháp; cảnh báo tồn thấp tức thời.

## Thứ tự chạy

A → B → C1–C19 → C21–C23 → D → E1–E10 → F1–F4 → G1–G9 → E11–E18 → H → I → G10–G13 → J → K →
L → M → N → O → các ca còn lại (C24–C25, F5–F7, P). Báo kết quả sau mỗi phần.

# Tắt phân hệ theo bản cài: lương, khoán, hoa hồng, giao hàng (In Hà Phương)

Trạng thái: đã code ngày 01/11/2026 (plan `docs/superpowers/plans/2026-11-01-tat-phan-he-theo-ban-cai.md`).
Chốt với chủ dự án ngày 01/11/2026.

## Bối cảnh

In Hà Phương (`D:\jobs\HAPHUONG`, remote `svn`) là bản tách từ SVN, định kỳ merge `svn/dev`. Hà Phương
không dùng lương, lương khoán, hoa hồng, giao hàng. Xoá code bên Hà Phương thì lần merge nào cũng xung
đột, nên làm ở SVN một cơ chế TẮT theo bản cài, mặc định bật hết. SVN chạy y như cũ; Hà Phương chỉ khai
biến môi trường.

## Quyết định đã chốt

1. Ghi sản lượng GIỮ (số lượng, lần ghi, người làm, bàn giao giữa tổ). Không ra tiền khoán ở bất kỳ đâu.
2. Tắt hoa hồng.
3. Ẩn thông số lương của chấm công (giờ công chuẩn, hệ số lễ, hệ số nghỉ tuần). Chấm công đếm công theo
   giá trị mặc định trong code.
4. Bỏ giao hàng, xe, khoán km, cờ Bộ phận Giao hàng. Đơn bán có thao tác "Xuất hàng"; THỦ KHO VẪN LẬP
   PHIẾU XUẤT và ghi sổ như luồng kho hiện tại.
5. Phí giao hàng trong phiếu tính giá GIỮ (chỉ là một khoản chi phí trong giá).
6. Chấm công, ca, nghỉ phép, tăng ca GIỮ.

## Cơ chế tắt

- Backend: `Settings.phan_he_tat` đọc từ env `PHAN_HE_TAT`, danh sách cách nhau dấu phẩy:
  `luong`, `khoan`, `hoa_hong`, `giao_hang`, `tai_san`, `cham_cong`. Hà Phương đặt cả sáu. Rỗng = bật hết (SVN).
- Cổng chặn đặt ở RBAC: module thuộc phân hệ tắt coi như MỌI vai không có quyền, kể cả admin. Nhờ vậy
  thanh bên tự ẩn mục, router trả 403, ma trận quyền không hiện dòng đó. Module bị chặn:
  - `luong` ⇒ `luong`; hai ô `view_salary`/`edit_salary` của `nhan_su`.
  - `giao_hang` ⇒ `giao_hang`, `dm_xe`.
- Frontend nhận danh sách tắt qua phản hồi đăng nhập / `me` (một trường `phan_he_tat`), dùng để ẩn
  phần NẰM TRONG màn khác (tab, cột, ô, chip) mà quyền module không che được.
- KHÔNG xoá bảng, KHÔNG gỡ migration, KHÔNG gỡ import chéo. Sản xuất, kế toán, hồ sơ còn gọi
  `ky_luong_guard`, `khoan_ky`, `cong_viec_khoan_repo`; tắt lương thì không kỳ lương nào bị khoá nên các
  chốt chặn đó tự không bao giờ chặn.

## Danh sách ẩn theo màn

### Lương (`luong`)
- Thanh bên mục Lương; thanh tab điện thoại ô Phiếu lương. Toàn bộ màn Lương.
- Hồ sơ nhân sự: tab "Lương & BHXH", nút "Lương", nút "Sửa lương & BHXH"; bước "Lương & BHXH" của hộp
  thêm nhân viên; cột lương khi xuất/nhập Excel hồ sơ.
- Hồ sơ của tôi: thẻ "Phiếu lương gần nhất".
- Phòng ban: ô "Tỷ lệ lương thử việc".
- Kế toán: nguồn phiếu chi "Tạm ứng lương", bảng kê tạm ứng.
- Chấm công: các câu nhắc Bảng lương; thông số lương nằm ở Cấu hình lương nên ẩn theo màn Lương.
- Thông báo: phiếu lương công bố/thu hồi, tạm ứng mới; vòng nền `phieu_luong_mo` không chạy.

### Khoán (`khoan`)
- Danh mục Công đoạn: tab Khoán, cột "CT khoán". Lưu công đoạn bỏ kiểm công thức khoán.
- Công thức: chip Đơn giá khoán và các chip loại khoán không hiện trong bảng chip.
- Phòng ban: cờ "Tổ máy in".
- Việc của tổ / Ghi sản lượng: khối Khoán trong hộp ghi lần, giá khoán của tổ, giá việc phát sinh,
  "Đơn giá khoán" ở chi tiết lần ghi. Chỉ ẩn ở giao diện: tab Khoán ẩn nên không công đoạn nào khai
  được khoán, tiền khoán luôn rỗng; máy chủ vốn cho lưu công đoạn không có khoán.
- Báo dừng máy: ô "Tính ngày dừng cho lương".

### Hoa hồng (`hoa_hong`)
- Hồ sơ nhân sự: thẻ % hoa hồng.
- Đơn bán: không chụp `bac_hoa_hong` lúc chốt.
- Phiếu thu: bỏ chặn "ảnh hưởng hoa hồng" theo kỳ lương.

### Giao hàng (`giao_hang`)
- Thanh bên: Giao hàng; Cấu hình danh mục > Xe giao hàng.
- Đơn bán: thẻ chặng Giao hàng đổi thành khối "Xuất hàng" (xem dưới). Cột danh sách "Giao khách", chặng
  "Giao" và bộ lọc theo giao GIỮ, vì nguồn số đã giao vẫn chạy.
- Xe giao hàng (module `dm_xe`) tắt hẳn: mục thanh bên, màn danh mục, xuất/nhập Excel xe, dòng Xe
  giao hàng trong ma trận quyền, router `/api/xe`. Mức khoán km (Cấu hình lương > Khoán km giao hàng)
  ẩn theo màn Lương, các endpoint mức khoán km trong router giao hàng chặn theo `giao_hang`.
- Phòng ban: công tắc "Bộ phận Giao hàng", đơn giá km, % tài xế, % phụ xe.
- Kho: ô Nguồn hiện "Đơn bán <mã>" thay vì "Yêu cầu giao · Lượt xe"; khối bên đổi thành "Xuất hàng"
  (khách, đơn bán), bỏ xe, tài xế. Bỏ báo tài xế khi lập/ghi phiếu. Ô "Người nhận hàng" trên phiếu là
  người bấm Xuất hàng, khoá theo tài khoản như mọi đề nghị xuất.
- Đơn bán: cột Kho của lần xuất ghi "Chờ kho xuất" / "Đã xuất"; chặng Giao ghi "N lần xuất mở".
- Phiếu xuất bán hàng / biên bản giao: bỏ dòng kíp xe.
- Theo dõi sản xuất, Lệnh SX: chữ "Chưa lên yêu cầu giao" đổi thành "Chưa xuất hàng".

### Tài sản & CCDC (`tai_san`, thêm 01/11/2026)
- Module `tai_san` tắt như Lương: thanh bên, màn, router `/api/tai-san`, dòng ma trận quyền. Không màn
  nào khác nhúng phần của nó.

### Chấm công, nghỉ phép, tăng ca (`cham_cong`, thêm 03/11/2026)
- Năm module mất quyền: `cham_cong`, `yeu_cau_chinh_cong`, `nghi_phep`, `tang_ca`, `di_muon` ⇒ ba mục
  thanh bên Chấm công, Nghỉ phép, Tăng ca ẩn, dòng ma trận không hiện.
- Router `/api/attendance`, `/api/leaves`, `/api/overtime`, `/api/late-early`, `/api/calendar` trả 404
  cho mọi đường, kể cả đường "của tôi" (đơn nghỉ của tôi, bảng công của tôi).
- Hồ sơ của tôi: ẩn thẻ "Phép năm còn lại", "Công tháng N", ô Ca làm việc, dòng Ca hiện tại, nút
  Chấm công. Hồ sơ nhân sự: ẩn ô Ca làm việc và nút Đặt/Đổi ca nền.
- Sản xuất vẫn đọc đơn nghỉ đã duyệt để chặn giao người; tắt thì không có đơn nào, không chặn ai.

### Ma trận quyền và tên nhóm
- Tắt `khoan` ⇒ ẩn ô chi tiết "Xem giá" của Công đoạn (ô này chỉ gác tiền khoán).
- Tắt `luong` ⇒ nhóm "Nhân sự & Lương" đổi thành "Nhân sự" ở thanh bên, ma trận quyền, chữ đầu màn.

## Xuất hàng ở đơn bán

Người bấm: ai đang có quyền lập yêu cầu giao ở đơn bán thì có quyền Xuất hàng (giữ nguyên ô quyền,
chỉ đổi nhãn).

1. Đơn bán > khối Xuất hàng > "Xuất hàng": chọn dòng, số lượng (không vượt còn phải giao, như kiểm của
   yêu cầu giao hiện tại), ngày cần, ghi chú cho kho. Bấm Lưu.
2. Phần mềm tạo trong một giao dịch: yêu cầu giao + một chuyến ẨN (không xe, không tài xế, không lượt
   xe) + đề nghị xuất kho thành phẩm gắn `delivery_trip_id` của chuyến đó.
3. Thủ kho thấy đề nghị ở Kho > yêu cầu, lập phiếu xuất, ghi sổ. Tồn KHO-TP bị trừ.
4. Ghi sổ xong, chuyến ẩn tự chốt `thanh_cong` với số THỰC XUẤT từng dòng. Huỷ phiếu trước khi ghi sổ
   thì chuyến và yêu cầu huỷ theo.
5. In phiếu xuất bán hàng như hiện nay.
6. Kế toán lập hoá đơn chọn "lần xuất" (chính là chuyến ẩn, đổi nhãn "Lượt giao" thành "Lần xuất").
   Công nợ không đổi.

Vì vẫn có chuyến, các chỗ đang đọc số đã giao (đơn bán, tiến độ, lệnh SX, theo dõi đơn, báo cáo kinh
doanh), hoá đơn theo lượt, sợi nối kho ↔ đơn (chặn lô khách khác, FEFO), gia công ngoài giao thẳng,
chặn huỷ đơn, tồn khả dụng đều chạy nguyên, không đổi nguồn.

## Ngoài phạm vi đợt này

- Khách trả hàng sau khi đã xuất: chưa có. Làm sau bằng "Nhập trả" trên một lần xuất.
- Khách nhận thiếu so với số xuất: không theo dõi; đã giao = số kho xuất.

## Kiểm

- Test BE: bật `PHAN_HE_TAT` đủ bốn giá trị ⇒ router lương, giao hàng, xe trả 403 cả với admin; ghi
  sản lượng chạy, không có trường tiền; Xuất hàng → lập phiếu → ghi sổ ⇒ đơn có đã giao, lập được hoá
  đơn theo lần xuất. Rỗng ⇒ toàn bộ test hiện có không đổi.
- Bấm thử trên Hà Phương: Đơn bán > Xuất hàng; Kho lập phiếu, ghi sổ; Đơn hiện đã giao; Kế toán lập
  hoá đơn. Thanh bên không còn Lương, Giao hàng, Xe giao hàng.
- Tài liệu PDF: tài liệu của SVN không đổi. Hà Phương nếu có tài liệu riêng thì bỏ các phần trên.

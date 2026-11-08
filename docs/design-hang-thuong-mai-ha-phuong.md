# Hàng thương mại cho In Hà Phương

Thiết kế ngày 08/11/2026. Trạng thái: đang bàn, chưa code.

## 1. Mục tiêu

In Hà Phương bán thêm hàng thương mại: mua về rồi bán lại, không qua sản xuất. Sao Việt Nhật không có
tính năng này.

Những gì đã chốt với khách (biên bản họp):

- Hàng thương mại bán luôn tại tiệm, có thể thu cọc.
- Hàng hiện để ở cửa hàng, không để trong kho.
- Khách mua cả sản phẩm in lẫn hàng thương mại thì tách làm hai đơn: đơn sản xuất chỉ có sản phẩm in,
  đơn thương mại chỉ có hàng thương mại. Cách này giúp thống kê dễ, khách đã đồng ý.

Không làm trong đợt này:

- Báo giá cho hàng thương mại. Đơn thương mại tạo thẳng tại quầy.
- Giao hàng nội bộ hoặc qua dịch vụ, và khâu thiết kế. Đây là hai chủ đề khác trong cùng buổi họp,
  bàn riêng (mục 9).

Coi là hỏng dù chạy được:

- Đơn thương mại lọt vào hàng chờ kế hoạch, Lệnh sản xuất hay Theo dõi đơn.
- Sửa hay ghi đè module Giao hàng (`delivery_service.py`, `routers/delivery.py`, model và màn Giao
  hàng). Giao hàng ở Hà Phương khác hẳn và sẽ thiết kế riêng (mục 9). Hàng thương mại không mượn chuyến
  giao, kể cả chuyến ẩn.
- Nhìn một đơn, một hoá đơn hay một phiếu thu mà không biết đó là đơn sản xuất hay đơn thương mại.
- Bản Sao Việt Nhật thấy bất kỳ chữ, mục hay cột nào của hàng thương mại.

## 2. Chỉ Hà Phương bật: phân hệ `thuong_mai`

MỌI thứ trong tài liệu này chỉ In Hà Phương có (chủ dự án nhắc 08/11/2026). Bản Sao Việt Nhật không
khai `PHAN_HE_BAT` thì không thấy gì và chạy y như hiện nay. Phải có test chứng minh: tắt cờ thì không
có mục, cột, chip, bộ lọc, nút nào mới; API trả 403 cho đường mới và chặn tạo đơn `thuong_mai`; đơn,
hoá đơn, phiếu xuất của Sao Việt Nhật đi đúng luật cũ. Phần code dùng chung chỉ được rẽ nhánh theo
`source_type = 'thuong_mai'` hoặc theo cờ phân hệ, không đổi hành vi mặc định.

Hai bản dùng chung một code. Hà Phương merge `svn/dev` định kỳ, nên tính năng phải nằm trong code
chung. Viết riêng bên repo Hà Phương thì lần merge nào cũng xung đột.

Hiện chỉ có chiều tắt: `PHAN_HE_TAT`, mặc định bật hết (`backend/app/phan_he.py`). Thêm chiều ngược
lại cho phân hệ mặc định tắt:

- `phan_he.py` có thêm tập `CHI_BAT_KHI_KHAI = {"thuong_mai"}`.
- Env mới `PHAN_HE_BAT`, đọc vào `Settings.phan_he_bat`.
- Hàm `phan_he_tat()` trả `PHAN_HE_TAT` cộng các phân hệ trong `CHI_BAT_KHI_KHAI` mà `PHAN_HE_BAT`
  không nhắc tới.

Kết quả: mọi cổng hiện có tự áp dụng mà không phải sửa gì. RBAC coi module của phân hệ tắt là không
ai có quyền, thanh bên ẩn, router trả 403, ma trận quyền không hiện dòng. Giao diện ẩn phần nằm trong
màn khác bằng `useTat("thuong_mai")`, vì danh sách tắt gửi xuống frontend đã gồm sẵn `thuong_mai`.

`MODULE_CUA_PHAN_HE["thuong_mai"]` gồm một module mới: `hang_thuong_mai`. Phần đơn thương mại nằm
trong màn Đơn hàng bán nên ẩn theo cờ (mục 6).

Env theo bản cài:

- Sao Việt Nhật không khai gì.
- Hà Phương khai `PHAN_HE_BAT=thuong_mai`.

Migration thêm cột chạy ở cả hai bản. Đây là cột trống, vô hại.

## 3. Mặt hàng thương mại

Danh mục mới "Hàng thương mại", là module `hang_thuong_mai` trên thanh bên, cạnh "Vật tư khác".

Mặt hàng lưu chung bảng `VatTuInAn` với một cờ mới `la_hang_thuong_mai`, giống cách cờ `la_thanh_pham`
tách màn Thành phẩm. Vì `hang_loai` vẫn là `vat_tu`, nên mua hàng, yêu cầu nhập, phiếu nhập, phiếu
xuất, tồn kho, nhiều ĐVT và nhà cung cấp của mặt hàng đều dùng lại được, không phải viết mới.

Mỗi mặt hàng khai: mã, tên, ĐVT (nhiều ĐVT như vật tư hiện nay), nhà cung cấp thường mua, và "Giá
bán" gắn trên TỪNG ĐVT bán được (ví dụ cái 5.000đ, hộp 45.000đ). Giá bán là giá khai sẵn để điền vào
dòng đơn, người bán sửa được trên từng dòng. ĐVT nào chưa khai giá thì dòng đơn trống giá: không quy
đổi giá từ ĐVT khác, không tự lấy giá nhập cộng lãi.

Ba cờ `la_thanh_pham`, `la_hang_thuong_mai` và "vật tư thường" loại trừ nhau. Một mặt hàng chỉ thuộc
một màn. Hệ quả: nếu tiệm bán lại đúng thứ xưởng đang dùng (giấy A4, keo), Hà Phương khai một mã hàng
thương mại riêng và nhập riêng, tồn không chung với vật tư sản xuất. Giấy (bảng `giay`) không bán theo
đường này.

Số lượng bán là số nguyên như dòng đơn hiện nay (`OrderLine.qty` Integer). Không đổi kiểu cột dùng
chung với đơn sản xuất trong đợt này.

## 4. Hàng ở cửa hàng: khai cửa hàng thành một kho

Khách nói hàng để ở cửa hàng chứ không để kho. Chủ dự án chốt 08/11/2026: có theo dõi tồn ở cửa hàng.
Muốn biết tồn thì hàng phải có một chỗ ghi sổ.

Cách làm: Hà Phương tự khai một kho tên "Cửa hàng" ở màn Kho. Bảng `kho_hang` đã cho khai bao nhiêu kho
cũng được, và mỗi kho đã có dòng quyền riêng `ton_kho_<id>`. Nhân viên cửa hàng được cấp quyền kho
này, không cần thủ kho. Không đặt tên cứng, không dò theo tên: hệ chỉ biết đây là một kho như mọi kho.

Hàng thương mại không bị ép vào KHO-TP như thành phẩm. Nhập và xuất ở kho nào cũng được, theo quyền
kho của người làm.


## 5. Mua hàng: giá mua và công nợ phải trả

Chủ dự án nhấn (08/11/2026): đơn thương mại gắn với mua hàng, giá mua, giá bán, thu chi và công nợ.

Hàng về cửa hàng bằng mua để tồn: mua trước, bán dần. Loại `mua_ton`, qua yêu cầu mua, đơn mua, đợt
giao như mua vật tư. Không có nút "Đề nghị mua" trên đơn (chủ dự án bỏ 08/11/2026).

Hàng nhập về kho "Cửa hàng". Người nhập chọn kho lúc lập phiếu, vì yêu cầu nhập từ đơn mua vốn để trống
kho.

Giá mua đi đúng đường mua hàng hiện có:

- Đơn mua ghi đơn giá nhà cung cấp.
- Nhập kho tạo lô, mỗi lô mang đơn giá nhập (`stock_lot.don_gia_nhap`).
- Hoá đơn mua ghi công nợ phải trả nhà cung cấp.
- Kế toán lập phiếu chi trả nhà cung cấp, gom được nhiều chứng từ.

Không có gì mới ở phần tiền mua; chỉ cần ô chọn mặt hàng ở yêu cầu mua và đơn mua liệt kê được hàng
thương mại.

## 6. Đơn thương mại

Dữ liệu nằm chung bảng `orders` và `order_lines`.

### Phân biệt đơn sản xuất và đơn thương mại

Chủ dự án chốt 08/11/2026: loại đơn là bản chất của đơn, không phải ô hay cột người dùng chọn.

- Đơn đi qua sản xuất (tạo từ báo giá) là đơn sản xuất.
- Đơn tạo ở màn Đơn hàng bán là đơn thương mại.

Không thêm cột `loai_don`, không có cột "Loại đơn" trên màn. Máy chủ biết loại qua nguồn tạo đơn đang có
`orders.source_type`:

- `bao_gia`: đơn sản xuất, như hiện nay.
- `thuong_mai`: giá trị mới, gán khi tạo ở Đơn hàng bán.

Giá trị `nhap_tay` cũ (đã gỡ, còn đơn cũ) không tính là thương mại.

Khi bật `thuong_mai`:

- Màn Đơn hàng bán có nút tạo đơn thương mại. Đơn sản xuất vẫn tạo từ báo giá như cũ.
- Mã đơn thương mại có tiền tố riêng `TM` (TM001, TM002…), đánh số riêng, khác `DH` của đơn sản xuất
  (`order_repo.py`). Nhìn mã là biết loại, kể cả ở chỗ chỉ in mã.
- Đầu ngăn chi tiết đơn ghi rõ loại. Đơn thương mại mở ra form của nó (dòng mặt hàng), không có các ô
  của đơn sản xuất (báo giá, PO, ngày giao, phiếu tính giá).
- Chỗ nào hiện đơn thì hiện loại: hoá đơn bán, phiếu thu, hàng chờ "Đơn hàng chờ thu", công nợ theo
  đơn, báo cáo doanh số.

Tắt `thuong_mai` (bản Sao Việt Nhật) thì nút tạo đơn thương mại ẩn, màn Đơn hàng bán y như hiện nay.

Quyền: dùng chung quyền của màn Đơn hàng bán, không thêm mục thanh bên. Phần đơn ẩn theo
`useTat("thuong_mai")`
và máy chủ chặn tạo đơn `thuong_mai` khi phân hệ tắt.

Không có module `don_thuong_mai`.

Đơn thương mại cần ở chung bảng vì hoá đơn bán (`SalesInvoice.order_id` NOT NULL), phiếu thu cọc và
công nợ theo đơn đều trỏ vào `orders`. Ở chung thì kế toán dùng lại hết.

Dòng đơn thương mại thêm cột trỏ tới mặt hàng (`hang_id` của `VatTuInAn` mang cờ thương mại). Mỗi dòng
có SL, ĐVT, đơn giá, thành tiền. Không có `phieu_thanh_phan_id`, cụm bán, ruột hay bìa.

Luật tách đơn: đơn thương mại chỉ nhận mặt hàng thương mại, đơn sản xuất chỉ nhận sản phẩm in. Máy chủ
chặn, không chỉ giao diện chặn.

### Vòng đời

Vẫn là `draft → ordered → cancelled` như đơn hiện nay.

Tạo đơn: người bán chọn khách, thêm dòng mặt hàng, sửa giá nếu cần, ghi cọc nếu có. Người lập lấy từ
tài khoản. Khách bắt buộc chọn. Khách mua lẻ không lấy tên thì Hà Phương tự khai một khách "Khách lẻ"
dùng chung, hệ không tự tạo.

Chốt đơn bỏ những bước chỉ dành cho đơn sản xuất:

- Không đòi báo giá, số PO hay ngày giao.
- Không gọi `khai_cho_don`, tức không khai thành phẩm.
- Không gọi `_tu_chuyen_sx`, tức không đặt `san_xuat_released_at`, không vào hàng chờ kế hoạch.

Mọi màn Kế hoạch, Lệnh sản xuất và Theo dõi đơn bỏ đơn `source_type = 'thuong_mai'`. Phải rà hết
các chỗ đọc `san_xuat_released_at` và danh sách đơn. Kèm theo phải có test bảo đảm đơn thương mại không
hiện ở các màn đó.

### Xuất hàng

Đơn thương mại đã chốt có nút "Xuất hàng". Người bán chọn kho xuất (mặc định kho duy nhất người đó có
quyền) và SL từng dòng, rồi bấm. Người có quyền kho đó ghi sổ phiếu xuất.

Đường này KHÔNG đi qua module Giao hàng. Không gọi `DeliveryService`, không tạo `DeliveryTrip`, kể cả
chuyến ẩn, không sửa file nào của Giao hàng. Thay vào đó có bản ghi riêng "Lượt xuất thương mại":

- Bảng mới `luot_xuat_thuong_mai` (đơn, kho, người lập lấy từ tài khoản, lúc lập, trạng thái
  chờ xuất / đã xuất / huỷ) và `luot_xuat_thuong_mai_dong` (`order_line_id`, SL).
- Bấm "Xuất hàng" thì tạo một lượt và một yêu cầu xuất kho ở kho đã chọn. Yêu cầu kho mang tham chiếu
  mềm `luot_xuat_tm_id`, cùng khuôn `delivery_trip_id` đang có trên `stock_requests`: kho không cần
  biết cột này nghĩa là gì.
- Ghi sổ phiếu xuất của yêu cầu đó thì lượt chuyển "đã xuất" và ghi SL thực xuất. Móc này đặt trong
  service hàng thương mại, gọi từ chỗ ghi sổ phiếu kho, giống cách phiếu kho đang đọc
  `delivery_trip_id` (`stock_voucher_service.py`).
- Huỷ yêu cầu kho thì lượt chuyển "huỷ".

Hai luật "thành phẩm chỉ vào/ra KHO-TP" và "lô khác khách" vốn chỉ áp theo `la_thanh_pham`, nên không
chạm hàng thương mại.

Bán tại quầy thường xuất ngay. Nếu người bán cũng có quyền ghi sổ kho đó thì cho làm hai việc trong
một lần bấm, không bắt đi qua màn Kho. Builder quyết cách nối.

Lúc bấm "Xuất hàng", người xuất chọn một trong ba phương thức giao: Không cần giao, Giao hàng nội bộ,
Giao hàng dịch vụ. Chọn theo từng lần xuất, giống hệt đơn sản xuất (mục 9). Đợt này làm trước "Không
cần giao"; hai phương thức còn lại làm cùng chủ đề giao hàng của Hà Phương.

### Hoá đơn theo lượt xuất

Hoá đơn bán hiện bắt buộc gắn một lượt giao (`accounting_service.py`, đoạn "Chọn lượt giao cần ghi
hóa đơn"), giá trị gợi ý tính từ dòng của chuyến (`hoa_don_theo_giao.py`). Với đơn thương mại:

- `sales_invoices` thêm cột `luot_xuat_tm_id` (nullable). Đơn `thuong_mai` bắt buộc chọn một lượt xuất
  "đã xuất" thay cho `delivery_trip_id`; đơn `san_xuat` giữ nguyên luật cũ.
- Giá trị gợi ý của lượt xuất dùng lại cách tính cộng dồn của `hoa_don_theo_giao.py`, cho nó nhận dòng
  lượt xuất (`order_line_id`, SL) như nhận dòng chuyến. Trần vẫn là tổng đơn gồm VAT.
- "Đã giao" của đơn thương mại trên báo cáo kinh doanh đọc từ lượt xuất, không đọc chuyến.

Các sửa này nằm ở kế toán và báo cáo, không ở Giao hàng. Đơn sản xuất đi đường cũ không đổi một dòng.

Hàng chưa đủ tồn vẫn chốt được đơn và thu cọc được, ví dụ khách đặt trước rồi hàng về sau. Phiếu xuất
thì bị chặn như mọi phiếu xuất vượt tồn. Phần này dùng luật kho hiện có.

### Cọc và thu tiền

Dùng nguyên `deposit_pct`, `deposit_amount`, `add_deposit_receipt` và hàng chờ "Đơn hàng chờ thu".
Khác biệt duy nhất: đủ cọc không kích hoạt gì, vì không có sản xuất để chuyển.

Thu đủ tiền đi đúng đường đơn sản xuất: lập hoá đơn theo lượt xuất, rồi lập phiếu thu cho hoá đơn đó
từ hàng chờ "Đơn hàng chờ thu". Không thêm nguồn thu mới. Ai thu tiền ở quầy là chuyện cấp quyền: nhân
viên cửa hàng được cấp quyền hoá đơn bán và phiếu thu thì tự làm được, không thì kế toán làm.

Khách trả cả đơn sản xuất lẫn đơn thương mại một lần thì lập một phiếu thu gom hai đơn. Việc này đã
làm được, vì phiếu thu nhiều dòng.

Tiền (đơn giá, thành tiền, giá bán khai ở mặt hàng) gác ở router theo cùng luật xem tiền của đơn bán
hiện nay.

### Thông báo

Yêu cầu xuất kho sinh từ đơn thương mại đẩy tới người có quyền kho đó qua SSE, dùng đường thông báo yêu
cầu kho đang có.

### Giá vốn của dòng đơn

Giá vốn lấy từ lô thực xuất, không tính ngầm:

- Kho ghi sổ phiếu xuất của lượt xuất thương mại thì hệ chụp giá vốn vào dòng đơn (`cost_snapshot` đang
  có trên `order_lines`).
- Giá vốn = tổng (SL xuất từ lô × đơn giá nhập của lô) cộng dồn qua các lượt xuất.
- Chưa xuất thì giá vốn để trống.

Giá vốn là tiền, chỉ người có quyền xem giá vốn mới thấy, gác ở router.

## 6b. Tiền đi hai chiều

Một vòng hàng thương mại có hai đầu tiền, dùng nguyên các màn kế toán đang có:

- Đầu mua: đơn mua, hoá đơn mua, công nợ phải trả nhà cung cấp, phiếu chi.
- Đầu bán: đơn thương mại, cọc (tuỳ chọn), hoá đơn bán theo lượt xuất, công nợ phải thu khách, phiếu thu.

Hai đầu nối với nhau qua kho: lô mang giá mua, giá vốn dòng đơn lấy từ lô thực xuất.

## 7. Báo cáo

Chủ dự án chốt 08/11/2026: báo cáo kinh doanh phân được đơn sản xuất và đơn thương mại. Chỉ vậy,
không thêm báo cáo nào khác.

Báo cáo kinh doanh có bộ lọc ở máy chủ để xem riêng đơn sản xuất hoặc đơn thương mại, xác định theo nguồn
tạo đơn (mục 6). Bộ lọc chỉ hiện khi bật `thuong_mai`.

## 8. Dữ liệu và tài liệu

- Migration `db_migrations.py`:
  - `orders.source_type` thêm giá trị `thuong_mai` (cột đã có, String(16), không đổi kiểu).
  - `order_lines` thêm cột mặt hàng thương mại.
  - `vat_tu_in_an.la_hang_thuong_mai` và giá bán theo ĐVT.
  - Bảng `luot_xuat_thuong_mai`, `luot_xuat_thuong_mai_dong`.
  - `stock_requests.luot_xuat_tm_id`, `sales_invoices.luot_xuat_tm_id` (nullable).
- Ghi hết các cột này vào `docs/DB_SCHEMA.md`.
- Không seed gì. `SEED_DEMO=false` giữ nguyên nghĩa.
- Tài liệu PDF: bộ tài liệu Hà Phương không chung nguồn `.tex` với Sao Việt Nhật. Thêm chương "Hàng
  thương mại" vào bộ Hà Phương. Bốn cuốn của Sao Việt Nhật không ảnh hưởng.

## 9. Chủ đề khác trong buổi họp, bàn riêng

- Giao hàng: xem `design-giao-hang-ha-phuong.md`. Lúc Xuất hàng chọn phương thức giao, không có module
  Giao hàng riêng. Áp cho cả đơn sản xuất lẫn đơn thương mại.
- Khâu thiết kế: biên bản chưa có chi tiết.
- Lệnh vật tư chỉ giấy, đẩy lệnh cuối chiều hoặc sáng sớm, sơ đồ tổ chức: khách tự cấu hình hoặc đã
  đáp ứng.

## 10. Đã chốt

- 08/11/2026: có theo dõi tồn hàng thương mại ở cửa hàng, qua kho "Cửa hàng" do Hà Phương tự khai.
- 08/11/2026: không ghi đè hay sửa module Giao hàng; đơn phải phân biệt được sản xuất hay thương mại.
- 08/11/2026: loại đơn là bản chất: đi qua sản xuất là đơn sản xuất, tạo ở Đơn hàng bán là đơn thương
  mại. Bỏ cột Loại đơn.
- 08/11/2026: bỏ nút Đề nghị mua trên đơn. Hàng thương mại mua để tồn.
- 08/11/2026: báo cáo kinh doanh phân được đơn sản xuất và đơn thương mại, không thêm báo cáo khác.

## Những lựa chọn tôi tự quyết

- Phân hệ mặc định tắt bằng `PHAN_HE_BAT`, gộp vào `phan_he_tat()` để không phải sửa cổng nào.
- Mặt hàng thương mại nằm chung bảng vật tư, dùng cờ riêng.
- Đơn thương mại nằm chung bảng `orders`, loại đơn xác định bằng `source_type`, không thêm cột.
- Cửa hàng là một kho do Hà Phương tự khai.
- Giá bán khai trên từng ĐVT của mặt hàng, sửa được ở dòng đơn, không quy đổi giá giữa các ĐVT.
- Hàng thương mại là mã riêng, không bán chung mã với vật tư hay giấy của xưởng. Số lượng nguyên.
- Xuất hàng dùng bản ghi riêng "Lượt xuất thương mại" nối với yêu cầu kho, không đụng module Giao hàng;
  hoá đơn của đơn thương mại gắn lượt xuất này.
- Đơn thương mại hiện chung danh sách Đơn hàng bán, mã tiền tố `TM`; dùng chung quyền Đơn hàng bán,
  không thêm mục thanh bên.
- Thu tiền như đơn sản xuất. Ai thu ở quầy do cấp quyền quyết.
- "Khách lẻ" do Hà Phương tự khai.
- Không có báo giá thương mại trong đợt này.

# Giao hàng cho In Hà Phương

Thiết kế ngày 08/11/2026. Trạng thái: đang bàn, chưa code.

## 1. Mục tiêu

Hà Phương giao hàng theo cách khác hẳn Sao Việt Nhật. Phần này làm mới, chỉ Hà Phương bật. Mục tiêu là
ghi nhận mỗi lần xuất hàng có giao hay không, và ai giao.

Không làm:

- Sửa hay ghi đè module Giao hàng cũ: `delivery_service.py`, `routers/delivery.py`, `models/delivery.py`,
  danh mục xe `dm_xe`, khoán km. Module cũ vẫn tắt ở Hà Phương (`PHAN_HE_TAT=giao_hang`).
- Module hay màn Giao hàng riêng. Chủ dự án bỏ ngày 08/11/2026.
- Trạng thái giao (chờ giao, đang giao, đã giao) và nút "Đã giao". Chủ dự án bỏ ngày 08/11/2026.
- Theo dõi chi phí xe. Chủ dự án bỏ ngày 08/11/2026.
- Tính cước vào đơn hay hoá đơn của khách.

## 2. Bật theo bản cài

MỌI thứ trong tài liệu này chỉ In Hà Phương có (chủ dự án nhắc 08/11/2026). Tắt `giao_hang_hp` thì
Sao Việt Nhật không thấy hộp chọn phương thức, cột Cách giao và Người giao, mục lọc giao hàng, danh mục xe, danh sách đơn vị vận chuyển hay chip
bộ phận giao hàng, và Xuất hàng chạy y như hiện nay. Phải có test chứng minh điều này.

Phân hệ mới `giao_hang_hp`, mặc định tắt. Hà Phương bật bằng `PHAN_HE_BAT`, cùng cơ chế ở
`design-hang-thuong-mai-ha-phuong.md` mục 2. Hà Phương khai `PHAN_HE_BAT=thuong_mai,giao_hang_hp`.

Phân hệ có một module mới là `xe_giao_hang` (danh mục xe, mục 6).

## 3. Thao tác: chọn phương thức lúc Xuất hàng

Bấm "Xuất hàng" ở đơn sản xuất hay đơn thương mại đều như nhau. Người xuất chọn một trong ba:

1. **Không cần giao.** Khách tự lấy.
2. **Giao hàng nội bộ.** Chọn Người giao và Xe.
   - Người giao chỉ liệt kê nhân viên thuộc bộ phận có cờ giao hàng.
   - Chọn người thì ô Xe tự điền xe người đó phụ trách. Đổi được.
   - Hai ô là danh sách gọn tự dựng (`components/OChonGon.tsx`), không ghép thông tin thành một chuỗi
     (09/11/2026). Ô Người giao: mỗi dòng tên người, bên phải chữ xám là biển số xe người đó phụ trách;
     ô đã chọn chỉ ghi tên vì ô Xe ngay cạnh đã hiện biển số. Không ghi bộ phận vì ai trong danh sách cũng
     thuộc bộ phận giao hàng. Ô Xe: tên xe bên trái, biển số chữ xám bên phải; dòng đầu "Không dùng xe
     của công ty".
3. **Giao hàng dịch vụ.** Chọn Đơn vị vận chuyển, gõ Tiền cước và Mã vận đơn (không bắt buộc).
   - Đơn vị vận chuyển là danh sách riêng (`don_vi_van_chuyen`), KHÔNG liên quan nhà cung cấp (đổi 13/11/2026,
     trước đó là NCC có cờ; mg 0478 chuyển dữ liệu cũ sang). Thêm, bỏ ngay trong ô chọn: ô có ô tìm, trên
     cùng là "Đơn vị đã dùng" (mỗi dòng một ký hiệu chữ đầu có màu riêng, nút × hiện khi rê chuột), dưới là
     "Thêm nhanh": các hãng phổ biến ở Việt Nam dạng nút tròn, ghi viết tắt (GHN, GHTK,
     Viettel Post, VNPost, J&T, Ninja Van, SPX, Best, Ahamove, Grab Express, Lalamove, Nhất Tín). Gợi ý nằm
     trong code, chưa ai chọn thì không có dòng nào trong DB. Gõ tên chưa có thì hiện dòng "Thêm <tên>" ghim ở chân, Enter cũng thêm.
   - Trùng tên (không phân biệt hoa thường, dấu cách thừa) thì dùng lại đơn vị cũ. Bỏ đơn vị đã từng giao thì
     chỉ ẩn khỏi danh sách: lần giao cũ, cước chờ chi và bộ lọc Đơn hàng bán vẫn giữ tên. Chưa giao lần nào thì
     xoá hẳn. Thêm lại tên đã bỏ thì bật lại dòng cũ.
   - Ai được xuất hàng (ô Sửa của Đơn hàng bán) thì được thêm, bỏ. Nhật ký ghi "Thêm đơn vị vận chuyển",
     "Bỏ đơn vị vận chuyển khỏi danh sách".

Phương thức chọn theo từng lần xuất. Một đơn xuất hai lần thì mỗi lần một phương thức được. Bắt buộc
chọn, không có giá trị mặc định ngầm. Sau đó xuất kho và lập hoá đơn đi đúng đường hiện nay.

Người giao nhận thông báo ngay qua SSE, hiện ở chuông thông báo đang có. Thông báo ghi lần xuất nào,
của đơn nào, xe nào.

## 4. Tiền cước

Công ty chịu (chủ dự án chốt 08/11/2026). Cước không cộng vào đơn hay hoá đơn của khách.

Cước của mỗi lần giao dịch vụ vào hàng chờ chi ở màn Phiếu chi, xếp theo đơn vị vận chuyển. Kế toán
lập phiếu chi, gom được nhiều lần giao của cùng đơn vị vào một phiếu (phiếu gộp nhiều chứng từ đã có).
Tiền cước gác ở router theo luật xem tiền.

## 5. Khai báo

- Cây phòng ban: đánh dấu bộ phận giao hàng. Cờ `departments.la_giao_hang` đã có sẵn nhưng đang bị ẩn
  khi tắt `giao_hang` (commit b899fd35). Bật `giao_hang_hp` thì hiện lại chip và ô này. Phần khoán km
  đi kèm cờ vẫn ẩn.
- Đơn vị vận chuyển: danh sách riêng, thêm và bỏ ngay ở hộp Xuất hàng (mục 3). Màn Nhà cung cấp không có gì về vận chuyển.
- Xe: khai ở danh mục Xe giao hàng (mục 6).

## 6. Danh mục Xe giao hàng

Mục `xe_giao_hang` trên thanh bên, có dòng quyền riêng. Danh mục xe gồm biển số, tên xe, người phụ
trách (một nhân viên bộ phận giao hàng) và cờ ngưng dùng.

Dùng bảng mới, không dùng bảng `xe` của module cũ, vì bảng đó gắn khoán km và nằm trong module không
được sửa.

## 7. Đơn hàng bán

Thông tin giao hàng được ghi nhận và xem tại đơn hàng (chủ dự án chốt 08/11/2026):

- Danh sách Đơn hàng bán thêm hai cột theo lần xuất gần nhất (tách ngày 09/11/2026): "Cách giao" (Không
  cần giao / Giao nội bộ / Thuê vận chuyển) và "Người giao" (nhân viên giao, hoặc đơn vị vận chuyển nếu
  thuê ngoài). Để bảng vừa màn 1600px, bản này ẩn sẵn cột PO khách cho người chưa tự chỉnh cột; bật lại
  ở nút Cột.
- Nút Lọc của Đơn hàng bán thêm hai mục: "Cách giao" và "Người giao" (một ô gồm cả nhân viên giao lẫn
  đơn vị vận chuyển). Đơn được tính nếu có ít nhất một lần xuất khớp. Lọc và đếm ở máy chủ
  (`GET /api/orders?cach_giao=&nguoi_giao=&don_vi_vc=`), ghi lên URL (`cg=`, `ng=nv:id` hoặc `ng=vc:id`).
- Ngăn chi tiết đơn, khối Xuất hàng: mỗi lần xuất ghi phương thức, người giao, xe, đơn vị vận chuyển,
  tiền cước, mã vận đơn. Tiền cước chỉ hiện với người có quyền xem tiền.

Các cột, mục lọc và khối này chỉ hiện khi bật `giao_hang_hp`.

## 8. Dữ liệu

- Bảng mới:
  - `xe_giao_hang`.
  - `don_vi_van_chuyen`: tên, còn dùng hay đã bỏ.
  - `phuong_thuc_giao_hp`: mỗi lần xuất một dòng. Gồm phương thức, người giao, xe, đơn vị vận chuyển,
    cước, mã vận đơn, người chọn (lấy từ tài khoản).
- Lần xuất nối với `phuong_thuc_giao_hp` bằng tham chiếu mềm:
  - Đơn sản xuất: tới yêu cầu hoặc phiếu xuất kho.
  - Đơn thương mại: tới `luot_xuat_thuong_mai`.
- Migration ở `db_migrations.py`, ghi `docs/DB_SCHEMA.md`, không seed.

## 9. Builder cần xem kỹ

Nút Xuất hàng của đơn sản xuất hiện đi qua `DeliveryService.xuat_hang`, tức là module Giao hàng. Hộp
chọn phương thức phải gắn vào màn Xuất hàng mà không sửa file nào của Giao hàng. Cách nối:

- Phương thức gửi kèm, được ghi vào `phuong_thuc_giao_hp` sau khi đường xuất cũ trả về yêu cầu kho.
- Một service mới làm việc ghi này, gọi từ router của phân hệ mới.

Nếu không nối được mà không đụng `delivery_service.py`, dừng lại và báo chủ dự án trước khi sửa.

# Kế hoạch viết tài liệu hướng dẫn Sao Việt Nhật (04/11/2026)

Đã có hai cuốn: Cấu hình hệ thống và Kinh doanh. Tài liệu này lên kế hoạch cho các cuốn còn lại của
Sao Việt Nhật. Bộ tài liệu riêng của In Hà Phương làm sau, khi SVN đã xong. Bộ đó là bộ riêng,
không dùng chung nguồn `.tex` với SVN.

## 1. Luật cho luồng chạy qua nhiều phòng

Một luồng như gia công ngoài, mua vật tư cho lệnh hay xuất hàng đi qua nhiều phòng. Nếu mỗi cuốn tự
kể lại cả luồng thì sẽ lệch nhau ngay lần sửa code đầu tiên. Chốt như sau:

- Mỗi luồng có MỘT cuốn chủ. Cuốn chủ là cuốn của người khởi động và theo luồng tới cuối. Cuốn này
  viết trọn luồng: sơ đồ đủ các khâu, ai làm khâu nào, ở màn nào.
- Các cuốn khác chỉ viết khâu của phòng mình (màn gì, bấm gì), rồi tham chiếu chéo về mục của cuốn
  chủ. Không kể lại phần của phòng khác.
- Khai báo nền (danh mục, cờ trên nhà cung cấp, quyền) viết ở cuốn Cấu hình, các cuốn khác chỉ dẫn
  sang. Chỗ nào cuốn Cấu hình còn thiếu thì bổ sung vào đó.

| Luồng | Cuốn chủ | Khâu nằm ở cuốn khác |
|---|---|---|
| Gia công ngoài | Kế hoạch sản xuất | Thu mua (nhà gia công), Kho (xuất giấy cấp, nhận thành phẩm về kho), Kế toán (phiếu chi), Kinh doanh (đơn có lần giao thẳng) |
| Vật tư cho lệnh | Kế hoạch sản xuất | Thu mua (yêu cầu mua, đơn mua cho lệnh), Kho (nhập, xuất cho lệnh) |
| Lệnh chạy ở xưởng | Việc của tổ | Kế hoạch sản xuất (phát hành, xếp lịch), KCS |
| Thành phẩm vào kho, xuất cho khách | Kinh doanh (đã viết) | Kho (ghi sổ phiếu xuất) |
| Mua hàng tới trả tiền | Thu mua và Kho | Kế toán (công nợ phải trả, phiếu chi) |
| Tiền khách trả | Kinh doanh (đã viết) | Kế toán (phiếu thu, công nợ phải thu) |

## 2. Các cuốn và thứ tự

1. Kế hoạch sản xuất. Người đọc: vai Kế hoạch SX, Quản lý sản xuất. Màn: Kế hoạch sản xuất, Hồ sơ
   lệnh sản xuất, Xếp lịch, Kế hoạch vật tư, Theo dõi sản xuất, gia công ngoài. Bài ghép đang ẩn
   (`BAI_GHEP_ENABLED`) nên không viết.
2. Việc của tổ và KCS. Người đọc: tổ trưởng, thợ, KCS. Màn xưởng: nhận việc, ghi sản lượng, giao
   chặng sau, báo dừng máy; màn KCS.
3. Thu mua và Kho. Người đọc: thu mua, thủ kho, kế toán kho. Màn: Yêu cầu mua hàng, Mua hàng, Nhà
   cung cấp, Yêu cầu nhập xuất, Báo cáo kho, chuyển kho.
4. Kế toán. Người đọc: kế toán bán hàng, tổng hợp, kế toán trưởng. Màn: phiếu thu, phiếu chi, hai
   loại công nợ, hoá đơn, tài khoản ngân hàng, các báo cáo.
5. Nhân sự và lương (phần dùng hằng ngày: chấm công, nghỉ phép, tăng ca, lương).
6. Sửa chữa và bảo dưỡng.

## 3. Gia công ngoài: những gì cuốn Kế hoạch sản xuất phải viết

Đọc từ code ngày 04/11 (`services/gia_cong_ngoai/`, `pages/gia-cong/`), CHƯA bấm thử. Lúc viết sẽ
bấm lại từng bước trên dev, chỗ nào khác thì sửa theo cái thấy trên màn.

Hai hình thái:

- Một phần: một hoặc vài bước của lệnh đưa ra ngoài, ví dụ in xong đem đi cán màng, về xưởng làm
  tiếp. Lệnh vẫn phát hành xuống xưởng. Phát hành xong, mỗi dải bước thuê ngoài liền nhau thành một
  "lần gia công".
- Trọn gói: lệnh không xuống xưởng, đem đi làm hết ở ngoài. Đặt bằng hộp Đặt trọn gói trên lệnh.
  Có thể kèm xưởng cấp giấy.

Các khâu, ai làm, ở đâu:

| Khâu | Ai | Màn | Cuốn |
|---|---|---|---|
| Đánh dấu nhà cung cấp nhận gia công | Thu mua | Nhà cung cấp | Cấu hình (khai), Thu mua và Kho |
| Đặt bước thuê ngoài, hoặc Đặt trọn gói, chọn nhà gia công | Kế hoạch SX | Kế hoạch sản xuất, lệnh | Kế hoạch SX |
| Trọn gói xưởng cấp giấy: Chọn giấy (tờ theo khổ, cuộn theo kg), gửi đề nghị xuất | Kế hoạch SX | Khối Gia công ngoài trên lệnh | Kế hoạch SX |
| Xuất giấy cho nhà gia công (phiếu có nhãn Gia công) | Thủ kho | Yêu cầu nhập xuất | Thu mua và Kho |
| Mang đi: ghi người và giờ lấy từ tài khoản | Kế hoạch SX (người mang hàng đi) | Khối Gia công ngoài | Kế hoạch SX |
| Nhận về, chốt số cuối. Nơi về: xưởng nếu còn chặng sau, kho thành phẩm, hoặc giao thẳng khách nếu dòng đơn đứng riêng một cụm bán (ô Khách nhận ngày) | Kế hoạch SX | Khối Gia công ngoài | Kế hoạch SX |
| Mở lại lần đã chốt khi ghi nhầm | Kế hoạch SX | Khối Gia công ngoài | Kế hoạch SX |
| KCS không kiểm bước thuê ngoài, chỉ ghi số cuối | (không ai) | KCS | Việc của tổ và KCS: một câu |
| Theo dõi hàng đang ở nhà gia công (chip Ở nhà gia công) | Kế hoạch SX, Kinh doanh | Theo dõi sản xuất, theo dõi đơn | Kế hoạch SX |
| Lập phiếu chi từ hàng Gia công chờ chi. Ô tiền để trống, gõ theo hoá đơn nhà gia công, đính hoá đơn | Kế toán | Phiếu chi | Kế toán |

Không có đơn giá gia công ở bất cứ đâu. Không có ngày hẹn về, không có công nợ nhà gia công. Tài
liệu không được nhắc tới mấy thứ đó.

Chỗ phải kiểm khi bấm thử, vì có thể là lỗi chứ không phải chuyện của tài liệu:

- Giao thẳng ở bản tắt giao hàng: lần giao thẳng tạo một chuyến đã giao nhưng không có phiếu xuất.
  Khối Xuất hàng của đơn bán có thể hiện "chờ kho lập phiếu" cho lần này. Nếu đúng vậy thì báo, sửa
  code trước rồi mới viết.
- Quyền Mang đi, Chốt, Mở lại, trọn gói: đã đọc, là ô Thao tác của Kế hoạch sản xuất.
- Lệnh trọn gói: tab Công đoạn còn sửa được ở giao diện hay không (ghi nhớ 06/10 nói còn hở).

## 4. Cuốn 1: Kế hoạch sản xuất

Dàn ý (đọc code 04/11, chờ duyệt). Người đọc: `docs/personas/ke-hoach-san-xuat.md`.

1. Đường đi của một lệnh. Sơ đồ archify theo vai: đơn chốt và đủ cọc tự rơi xuống, tạo lệnh, rà lệnh,
   Sẵn sàng lập kế hoạch, giữ vật tư, xếp lịch, Phát hành, tổ chạy, KCS kiểm và gửi kho, KCS đóng lệnh.
   Trạng thái lệnh: Nháp, Sẵn sàng, Đã lập kế hoạch, Đã phát hành, Đã đóng. Kế hoạch làm gì, phòng
   khác làm gì.
2. Nhận đơn và tạo lệnh: tab Hàng chờ tiếp nhận (chấm báo, thông báo tức thì), ngăn Lệnh dự kiến
   (Vào máy, Bù hao, Giấy nguyên, Con/tờ, Kẽm, Lượt in), tick dòng, Xác nhận tạo N lệnh. Dòng chưa có
   bài tính giá.
3. Rà một lệnh trước khi lập kế hoạch: màn chi tiết lệnh, các ô số đầu trang, tab Thông tin chung (Hàng
   GẤP, hạn hoàn thành), Quy cách, Công đoạn (Nguồn giấy, bảng bước, Loại bước Máy/Tổ/Thuê ngoài, Tổ
   và máy, ngăn bước: vật tư, khuôn, số giờ), Vật tư, Tệp đính kèm. Thanh "Còn thiếu N mục" và nút Sẵn
   sàng lập kế hoạch, Mở lại để sửa. Băng Danh mục đã đổi, băng Tiêu chí KCS đã đổi. Xoá lệnh.
4. Vật tư của lệnh: Kế hoạch vật tư xem theo Lệnh/Mặt hàng, các chip tình trạng (Cần mua, Nên nhả hàng,
   Chưa giữ...), Giữ hàng, Nhả hàng, Đề nghị mua (sang Yêu cầu mua hàng loại Cho lệnh SX). Phần Thu mua
   làm tiếp chỉ dẫn sang cuốn Thu mua và Kho. Giữ chỗ chỉ là cảnh báo, không chặn phát hành.
5. Xếp lịch và phát hành: khay Chờ xếp lịch, kéo thả, gõ giờ Bắt đầu, dời (kéo, mũi tên 15 phút, Shift
   một ca), Hoàn tác, Khoá máy. Phát hành (cả cụm), tự gửi kho yêu cầu xuất vật tư cho từng bước. Thu hồi
   phát hành, Phát hành cập nhật, Lịch sử phát hành. Quyền Phát hành lịch.
6. Gia công ngoài (mục 3 ở trên): bước Thuê ngoài một phần, Gia công trọn gói (Xưởng cấp giấy, Chọn
   giấy, Gửi đề nghị xuất giấy), Đã mang đi, Mang thêm, Nhận hàng về, Hàng về đâu (Về xưởng làm tiếp,
   Nhập kho thành phẩm, Giao thẳng cho khách), Mở lại, Huỷ gia công. Dòng Chi tiền chờ kế toán.
7. Theo dõi: Theo dõi sản xuất theo đơn (Cần để ý, Đang vướng, chặng Lệnh/SX/Kho/Giao), Hồ sơ lệnh
   sản xuất (In phiếu công nghệ, tab Sản lượng, Kho và giao, Lịch sử), Xếp lịch xem trễ hạn.
8. Khi lệnh xong: KCS gửi nhập kho thành phẩm, KCS đóng lệnh hoặc đóng thiếu (kế hoạch không có nút
   đóng). Lệnh đóng thiếu thì làm bù thế nào. Lệnh vẫn chạy dù đã đủ hàng.
9. Câu hỏi hay gặp.

Phát hiện lúc đọc code, phải kiểm khi bấm thử, có thể là lỗi:
- Nút In phiếu công nghệ ở Hồ sơ lệnh hiện theo quyền Kế hoạch sản xuất, máy chủ lại hỏi quyền Hồ sơ
  lệnh. Người có một trong hai quyền có thể thấy nút mà bấm bị từ chối.
- Giao thẳng cho khách vẫn hiện ở bản tắt giao hàng, ghi thẳng chuyến giao (đúng chỗ đã ngờ ở mục 3).

Bộ dữ liệu mẫu, dựng bằng thao tác thật trên dev, mỗi lệnh đi trọn một nhánh:

- Lệnh A: hộp in offset, bước cán màng thuê ngoài một phần, về xưởng bế, dán, nhập kho.
- Lệnh B: trọn gói, xưởng cấp giấy tờ, nhận về kho thành phẩm.
- Lệnh C: trọn gói, giao thẳng khách (đơn có dòng đứng riêng một cụm bán).
- Lệnh D: thiếu vật tư, đi qua Kế hoạch vật tư sinh yêu cầu mua.

## 5. Quy trình cho mỗi cuốn

1. Dump DB dev `svn_erp_trong` ra bản sao lưu ở gốc repo, tên `svn_erp_trong-truoc-tai-lieu-<cuon>-<ngay>.dump`.
2. Viết hồ sơ vai ở `docs/personas/` (như `sale.md`). Anh duyệt.
3. Dàn ý chương. Anh duyệt.
4. Đọc code từng màn để kiểm. Dựng dữ liệu mẫu bằng thao tác thật, mỗi luồng lưu thành một kịch bản
   chụp chạy lại được (dùng sau cho video). Chỗ nào thấy lỗi thì báo, không tự vá khi chưa được bảo.
5. Viết `.tex`, chụp ảnh, vẽ sơ đồ. Biên dịch XeLaTeX hai lần, 0 tham chiếu treo, dọn file phụ.
   Tham chiếu chéo sang cuốn Cấu hình và Kinh doanh.
6. Thêm cuốn mới vào luật tài liệu đi kèm code trong `CLAUDE.md`.
7. Commit `.tex`, `.pdf`, ảnh cùng một commit.

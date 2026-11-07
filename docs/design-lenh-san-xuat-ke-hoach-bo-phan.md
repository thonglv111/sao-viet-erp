# Lệnh sản xuất và kế hoạch từng bộ phận

Thiết kế chốt với chủ dự án ngày 07/11/2026. Đã code phần lớn trong worktree `lenh-sx-bo-phan`, chưa commit. Phần đã làm, phần làm khác thiết kế và phần hoãn ghi ở mục 10.

Trang thử bấm được: [docs/mockups/ke-hoach-tung-bo-phan.html](mockups/ke-hoach-tung-bo-phan.html). Dữ liệu trong trang là dữ liệu mẫu. Phần chọn bộ phận nhận trong trang còn viết cứng, chưa theo luật ở mục 4.

## 1. Vì sao đổi

Hiện nay người lập lệnh phải chọn tổ và máy cho từng bước ngay trên lệnh. Xếp lịch xếp giờ theo máy đó, rồi phát hành chép thẳng tổ và máy xuống Việc của tổ. Như vậy một người ở phòng kế hoạch phải quyết định máy và tổ cho mọi xưởng.

Chủ dự án muốn chia lại. Người lập lệnh chỉ lập lệnh và phát lệnh. Mỗi bộ phận sản xuất có kế hoạch riêng: nhận lệnh, rồi tự phân việc cho máy và nhóm thợ của mình.

Ba thứ chủ dự án đã bác, không đưa lại:
- Kế hoạch chung đứng trên các bộ phận.
- Hạn xong cho từng công đoạn.
- Nút "báo không kịp" từ bộ phận gửi ngược lên.

## 2. Luồng mới

1. **Lệnh sản xuất** (đổi tên từ module Kế hoạch sản xuất): lập lệnh từ đơn và bài tính giá, sửa chuỗi công đoạn, số lượng, vật tư.
2. **Xếp lịch**, làm lại thành nơi phát lệnh: chọn lệnh đã sẵn sàng rồi phát.
3. Phát lệnh thì mỗi bước Nội bộ tới khay "Lệnh mới tới" của bộ phận nhận bước đó. Cả lệnh phát một lần, mọi bộ phận thấy cùng lúc.
4. **Kế hoạch bộ phận** (module mới): người kế hoạch của bộ phận chọn máy và nhóm thợ, xếp thứ tự chạy, rồi bấm Giao.
5. **Việc của tổ**: nhóm thợ chỉ thấy việc từ lúc bộ phận giao. Từ đây trở đi, ghi sản lượng, giao nhận và KCS giữ như hiện nay.

## 3. Thay đổi trên Lệnh sản xuất

- Module và mục thanh bên "Kế hoạch sản xuất" đổi tên thành "Lệnh sản xuất". Các chữ đi theo cũng đổi, ví dụ nút "Mở ở Kế hoạch sản xuất" trong Xếp lịch.
- Loại bước chỉ còn hai giá trị: **Nội bộ** (gộp Máy và Tổ cũ) và **Gia công** (đổi tên từ Thuê ngoài).
- Bảng Chuỗi công đoạn bỏ cột "Tổ và máy". Thêm cột "Bộ phận nhận" cho bước Nội bộ (xem mục 4).
- Ngăn chi tiết của bước bỏ hai tab: "Phân công & Thiết bị" và "Tiến độ & Thời gian". Giữ ba tab: Cấu hình & Số lượng, Vật tư, Phụ thuộc.
- Lệnh không còn tính giờ chạy, vì giờ chạy phụ thuộc máy mà lệnh không chọn máy nữa.
- Bước Gia công vẫn chọn nhà gia công ngay trên lệnh (giả định, xem mục 9).

## 4. Bộ phận nhận

**Bộ phận là gì.** Là các phòng trực thuộc ngay dưới phòng bật cờ "Bộ phận thuộc Khối Sản xuất" (cột `departments.la_san_xuat`). Không viết cứng mã phòng. Hiện có 7 bộ phận dưới phòng Sản xuất: Tổ Cán màng, Tổ in, Tổ bế, Dán, Cắt, Thành phẩm / KCS, Tổ bồi. Nhóm thợ là các phòng con của bộ phận, ví dụ "Nhóm thợ in máy 2 màu" thuộc Tổ in. Bộ phận không có phòng con, như Tổ Cán màng và Tổ bồi, thì tự nhận việc và giao cho chính mình.

**Bước đi về bộ phận nào.** Danh mục công đoạn đã có ô "Phòng ban / Tổ phụ trách" (bảng `cong_doan_to`). Lấy các nhóm được tick ở ô này, đi ngược lên bộ phận chứa từng nhóm, ta được danh sách bộ phận làm được công đoạn.
- Danh sách chỉ có một bộ phận: ô Bộ phận nhận tự điền, không cho chọn.
- Danh sách có nhiều bộ phận: hệ thống chọn sẵn bộ phận có **nhiều nhóm được tick nhất**. Người lập lệnh bấm vào thì đổi được, nhưng chỉ trong danh sách này. Ví dụ công đoạn In tick nhóm in 2 màu, nhóm in 4 màu và Bế T, thì chọn sẵn Tổ in và chỉ cho đổi sang Tổ bế.
- Hai bộ phận có số nhóm bằng nhau: chọn bộ phận chứa tổ mặc định, tức tổ tick đầu tiên. Đây là giả định, hiện chưa có công đoạn nào bằng nhau.
- Công đoạn chưa tick nhóm nào: bước để trống Bộ phận nhận, lệnh không phát được, phải khai thêm ở danh mục.

**Số liệu DB dev ngày 07/11/2026** (99 công đoạn):
- 67 công đoạn chỉ thuộc một bộ phận.
- 30 công đoạn thuộc hai hoặc ba bộ phận, phần lớn là việc tay giữa Cắt, Dán và Thành phẩm (gỡ hàng, đục lỗ, kiểm phẩm, dán tem). Theo luật đa số: "Gỡ hàng hộp giấy ivory" (Dán 8 nhóm, Thành phẩm 5, Cắt 4) chọn sẵn Dán. "Dán tem" (Thành phẩm 5, Dán 1) chọn sẵn Thành phẩm.
- 2 công đoạn chưa tick nhóm nào: TGI "Tề giấy in" và TS "Tề sóng". Phải khai thêm trước khi chạy.

## 5. Máy in từ bài tính giá

Lúc tính giá, sale đã chọn máy in. Hiện code mang máy này xuống đúng bước In của lệnh (`lsx.may_id`, `_default_buoc` trong `lsx_service.py`). Các bước khác không có máy từ bài tính giá.

Theo thiết kế mới:
- Lệnh vẫn giữ máy in của bài tính giá, nhưng không hiện thành ô chọn máy trên bảng công đoạn.
- Khi bước In tới bộ phận In, việc đã nằm sẵn ở cột máy đó trong Kế hoạch bộ phận. Người kế hoạch chỉ còn chọn nhóm thợ rồi giao.
- Bộ phận **được đổi máy**, nhưng **bắt buộc nhập lý do**. Chưa nhập lý do thì không lưu được.
- Mỗi lần đổi ghi vào lịch sử của lệnh: máy cũ, máy mới, lý do, người đổi, lúc đổi. Người đổi do máy chủ lấy từ tài khoản đang đăng nhập.
- Máy mới khác khổ hoặc khác số màu so với máy đã tính giá thì hiện một dòng nhắc "giá đã báo tính theo máy …". Không chặn, không tự tính lại giá. Đây là giả định, xem mục 9.

## 6. Màn Kế hoạch bộ phận

Bố cục theo trang thử:
- Chọn bộ phận ở đầu màn. Người dùng chỉ thấy bộ phận mình có quyền.
- Cột "Lệnh mới tới" là các việc chưa xếp.
- Mỗi máy của bộ phận một cột, thêm cột "Làm tay" cho việc không dùng máy.

Thao tác:
- **Xếp:** kéo việc vào cột máy, chỉ thả được vào máy làm được công đoạn đó. Thứ tự trong cột là thứ tự chạy. Giờ dự kiến tự tính nối nhau theo năng suất của máy.
- **Chọn nhóm thợ:** chỉ chọn trong các nhóm con của bộ phận mà công đoạn có tick.
- **Giao:** nút "Giao xuống tổ" giao mọi việc đã có cả máy và nhóm. Nhóm thấy việc ngay, có toast và badge qua SSE.
- **Rút lại:** việc đã giao mà nhóm chưa bắt đầu thì rút lại được, để đổi máy hay đổi nhóm. Nhóm bắt đầu rồi thì việc khoá ở máy đó.
- **Khâu trước:** thẻ việc ghi khâu trước của lệnh đang ở đâu, để bộ phận biết hàng sắp tới. Không chặn xếp.
- **Chia việc:** một bước có thể chia thành nhiều việc cho nhiều máy hoặc nhiều nhóm, mỗi việc một số lượng. Ví dụ 20.000 hộp chia 15.000 cho máy dán, 5.000 cho dán tay. Ghi sản lượng và giao nhận cộng dồn từ các việc của cùng một bước.

## 7. Màn Xếp lịch (nơi phát lệnh)

- Bỏ dải giờ chạy từng bước theo máy, chữ "Chưa tính được giờ", dòng tổng máy chạy và nghỉ ca, và nút Bỏ lịch.
- Giữ lại danh sách lệnh chờ phát, thông tin lệnh (khách, đơn, quy cách, vật tư), và nút Phát hành, nay đổi nghĩa thành phát tới các bộ phận.
- Trong ngăn lệnh hiện chuỗi bước kèm bộ phận nhận. Sau khi phát thì hiện trạng thái từng bước: chờ bộ phận xếp, đã giao, đang làm, xong.
- Đây là "ui/ux lại" một màn, nên theo `.agents/rules/ui.md`: tham khảo trang thật và dựng 3 phương án HTML ở `docs/mockups/` trước khi code.

## 8. Chỗ trong code bị kéo theo

| Chỗ | Hiện nay | Đổi thành |
| --- | --- | --- |
| Kiểm thiếu trước Sẵn sàng, `lsx_service.py` (`thieu_to_may`) | Bước Máy/Tổ chưa có tổ hoặc máy thì chặn | Bỏ. Thay bằng chặn bước Nội bộ chưa có bộ phận nhận. Giữ chặn thiếu nhà gia công, thiếu dao hoặc khuôn |
| Loại bước `loai_buoc` (may / to / thue_ngoai) | Ba giá trị | Hai giá trị nội bộ / gia công, có migration đổi dữ liệu cũ |
| Thời lượng bước `thoi_luong_buoc` | Tính theo máy của bước | Bỏ trên lệnh, chuyển sang Kế hoạch bộ phận theo máy của việc |
| Phát hành, `san_xuat/snapshot.py` | Chép tổ và máy của bước xuống Việc của tổ | Chỉ tạo việc chờ ở bộ phận. Việc của tổ sinh ra lúc bộ phận Giao |
| Xếp lịch, `xep_lich/service.py`, `xep_lich_service.py`, `xep_lich_van_de_service.py` | Xếp giờ theo máy, cảnh báo trùng máy và quá tải | Thành màn phát lệnh. Cảnh báo trùng máy, nếu còn cần, chuyển sang Kế hoạch bộ phận |
| Bài ghép, `bai_ghep_service.py` | In chung nhiều lệnh dựa vào máy của bước | Bộ phận In chọn máy cho cả bài ghép |
| Hồ sơ lệnh, Theo dõi sản xuất, phiếu công nghệ | Hiện máy và tổ của bước | Lấy từ các việc đã giao. Một bước có thể có nhiều máy |
| Quyền | Module kế hoạch sản xuất | Đổi tên module. Thêm module Kế hoạch bộ phận, giới hạn theo bộ phận |
| Dữ liệu mới | — | Bảng việc đã phân: bước lệnh, bộ phận, máy, nhóm, số lượng, thứ tự, trạng thái, lý do đổi máy. Cột bộ phận nhận trên bước lệnh. Có trong `docs/DB_SCHEMA.md` và migration ở `db_migrations.py` |

Không đổi:
- Hao hụt: đã lấy từ danh mục công đoạn, không phụ thuộc máy.
- Giữ chỗ vật tư.
- Khoán lương: tính theo việc thực tế mà nhóm làm.
- Ghi sản lượng, giao nhận, KCS: chỉ đổi nguồn của việc.

Tài liệu: cuốn "Hướng dẫn sử dụng Kế hoạch sản xuất" phải viết lại theo tên và luồng mới. Cuốn "Việc của tổ và KCS" phải sửa đoạn nói việc tới tổ ngay khi phát hành.

## 9. Giả định chưa được chủ dự án xác nhận

- Bước Gia công vẫn chọn nhà gia công trên lệnh, không đi qua bộ phận nào.
- Hai bộ phận bằng số nhóm thì chọn bộ phận chứa tổ mặc định.
- Đổi sang máy khác khổ hoặc khác số màu chỉ nhắc, không chặn, không tính lại giá.
- Nhóm đã bắt đầu thì bộ phận không rút việc lại được.
- Lệnh cũ đã gán tổ và máy: lúc chuyển đổi, đưa thẳng thành việc đã giao ở bộ phận chứa tổ đó, để xưởng không mất việc đang chạy. Dự án chưa có người dùng thật, nên cũng có thể xoá lệnh thử.

## 10. Đã làm ngày 07/11/2026

Thêm yêu cầu của chủ dự án lúc giao việc: màn Kế hoạch bộ phận phải thấy quy cách in ấn và tệp của lệnh, và mọi ô chọn kiểu danh sách thả xuống phải có chỗ tìm kiếm, dùng lại ô chọn có sẵn của SVN.

**Dữ liệu.** Migration `0455_ke_hoach_bo_phan`. Bước lệnh không thêm cột: `lsx_cong_doan.department_id` của bước Nội bộ nay giữ bộ phận nhận thay cho tổ (migration đổi dữ liệu cũ từ nhóm lên bộ phận chứa nó, bài ghép cũng vậy). Việc của tổ `san_xuat_cong_viec` thêm năm cột:
- `bo_phan_id`: bộ phận nhận việc.
- `nhom_xep_id`: nhóm bộ phận đã chọn khi việc chưa giao.
- `thu_tu_xep`: thứ tự chạy trong cột máy hoặc cột Làm tay.
- `da_giao_at`, `da_giao_by_id`: lúc bộ phận giao và người giao.

Việc chưa giao có `department_id` để trống. Mọi bàn tổ, badge và thông báo cũ đều lọc theo `department_id`, nên tổ tự không thấy việc chưa giao mà không phải sửa từng chỗ. Việc cũ có sẵn được điền `bo_phan_id` theo tổ của nó và coi như đã giao.

**Làm khác thiết kế.**
- Loại bước vẫn lưu ba giá trị `may`, `to`, `thue_ngoai`, không có migration đổi dữ liệu. Giao diện chỉ hiện hai nút Nội bộ và Gia công. Chọn Nội bộ thì lưu `may`, bước cũ mang `to` vẫn hiện là Nội bộ. Lúc bộ phận giao, việc có máy thành `may`, Làm tay thành `to`.
- Đường lùi: công đoạn mà các tổ được tick không nằm dưới bộ phận nào (tổ đứng thẳng ở gốc có cờ Khối Sản xuất) thì bước giữ cách cũ, mang tổ và máy, phát xong tới thẳng tổ. Dữ liệu thật hiện không có trường hợp này. Nó giữ cho lệnh cũ và bộ test cũ chạy được.
- Xếp lịch mới chỉ bỏ điều kiện phải có giờ bắt đầu mới phát, câu báo sau khi phát đổi thành "Đã phát lệnh tới các bộ phận". Giao diện Xếp lịch chưa làm lại, vì luật `ui.md` đòi 3 phương án HTML trước.
- Lệnh phát mà chưa có giờ thì không có thanh trên lưới. Để còn mở được ngăn thu hồi hay phát hành cập nhật, khay "Chờ xếp lịch" giữ lệnh đó kèm chip "Đã phát" cho tới khi tổ bắt đầu việc đầu tiên. Thẻ này bấm mở ngăn được, không kéo lên lưới được. Lệnh gia công trọn gói còn sống không vào khay này.
- Bảng Chuỗi công đoạn của lệnh bỏ dòng tổng thời gian và hạn, chân bảng chỉ đếm số công đoạn và số bước gia công.
- Nhãn Nội bộ / Gia công chỉ dùng cho bước của lệnh (`LSX_LOAI_BUOC_LENH`). Bài ghép vẫn hiện Máy / Tổ / Thuê ngoài (`LSX_LOAI_BUOC_META`), vì bài ghép còn chọn máy và tổ.
- Câu hỏi khi thu hồi lệnh chưa có giờ nói lệnh về khay Chờ xếp lịch và rời khay các bộ phận.
- Nút ở màn Kinh doanh trỏ sang màn này đổi chữ theo tên mới: "Mở Lệnh sản xuất" ở tiến độ đơn và ở ngăn đơn hàng bán.
- Tài liệu: cuốn Kế hoạch sản xuất có chương mới Kế hoạch bộ phận và sửa chương Xếp lịch; cuốn Việc của tổ nói tổ chỉ thấy việc sau khi bộ phận giao; cuốn Kinh doanh đổi tên nút.

**Màn Kế hoạch bộ phận** (`KeHoachBoPhanPage.tsx`, API `/api/ke-hoach-bo-phan`, quyền `ke_hoach_bo_phan` chép từ `xep_lich`):
- Ô chọn bộ phận, ô chọn máy, ô chọn nhóm đều có ô gõ tìm.
- Khay "Lệnh mới tới", mỗi máy của bộ phận một cột, cột "Làm tay". Việc mang máy in của bài tính giá đứng sẵn ở cột máy đó.
- Kéo thả giữa các cột và đổi thứ tự trong cột. Thẻ ở khay có thêm ô "Xếp vào máy…" cho người không kéo chuột.
- Đặt việc vào máy khác máy tính giá, kể cả Làm tay, phải nhập lý do. Trả về khay thì không hỏi, vì việc chưa nằm ở máy nào. Máy chủ ghi một dòng vào nhật ký của lệnh, ví dụ "In: chạy IN-04 thay máy tính giá IN-02. Lý do: …", hiện ở tab Lịch sử của hồ sơ lệnh cùng các dòng Giao và Rút lại.
- Thẻ việc ghi "Khâu trước": tên bước đi trước, trạng thái và bộ phận đang giữ nó. Bước đi trước đọc từ phụ thuộc giữa các bước của lệnh (`lsx_cong_doan_phu_thuoc`), và phụ thuộc chéo lệnh (`san_xuat_phu_thuoc`). Có nhiều bước trước thì ưu tiên bước chưa xong.
- Sang Làm tay mà bộ phận có nhiều nhóm làm được thì hộp hỏi chọn nhóm luôn.
- Nút "Giao xuống tổ (N việc)" giao các việc đã xếp và đã có nhóm. Nhóm nhận thông báo và thấy việc ngay qua SSE.
- Rút lại việc đã giao khi nhóm chưa ghi sản lượng lần nào.
- Bấm mã lệnh trên thẻ mở ngăn ba tab: Thông tin, Quy cách in (cùng thẻ quy cách của Việc của tổ), Tệp của lệnh (cùng khối tệp của Việc của tổ, nạp qua quyền của Kế hoạch bộ phận).

**Hoãn.**
- Chia một bước thành nhiều việc cho nhiều máy hoặc nhiều nhóm (mục 6).
- Giờ dự kiến nối nhau trong cột máy. Thẻ mới hiện thời gian chạy của bước và tổng phút của cột.
- Dòng nhắc khi đổi sang máy khác khổ hoặc khác số màu (mục 5).
- Làm lại giao diện Xếp lịch (mục 7) và trạng thái từng bước trong ngăn lệnh sau khi phát.
- Hồ sơ lệnh, Theo dõi sản xuất, phiếu công nghệ vẫn đọc máy và tổ của bước, chưa đọc từ việc đã giao (mục 8).

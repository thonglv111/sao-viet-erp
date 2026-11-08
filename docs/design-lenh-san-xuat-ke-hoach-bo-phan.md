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
- Máy mới khác khổ hoặc khác số màu so với máy theo báo giá thì hiện một dòng nhắc "giá đã báo tính theo máy …". Không chặn, không tự tính lại giá. Đây là giả định, xem mục 9.

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
- Đặt việc vào máy khác máy theo báo giá, kể cả Làm tay, phải nhập lý do. Trả về khay thì không hỏi, vì việc chưa nằm ở máy nào. Máy chủ ghi một dòng vào nhật ký của lệnh, ví dụ "In: chạy IN-04 thay máy theo báo giá IN-02. Lý do: …", hiện ở tab Lịch sử của hồ sơ lệnh cùng các dòng Giao và Rút lại.
- Thẻ việc ghi "Khâu trước": tên bước đi trước, trạng thái và bộ phận đang giữ nó. Bước đi trước đọc từ phụ thuộc giữa các bước của lệnh (`lsx_cong_doan_phu_thuoc`), và phụ thuộc chéo lệnh (`san_xuat_phu_thuoc`). Có nhiều bước trước thì ưu tiên bước chưa xong.
- Sang Làm tay mà bộ phận có nhiều nhóm làm được thì hộp hỏi chọn nhóm luôn.
- Nút "Giao xuống tổ (N việc)" giao các việc đã xếp và đã có nhóm. Nhóm nhận thông báo và thấy việc ngay qua SSE.
- Rút lại việc đã giao khi nhóm chưa bấm Bắt đầu.
- Bấm mã lệnh trên thẻ mở ngăn ba tab: Thông tin, Quy cách in (cùng thẻ quy cách của Việc của tổ), Tệp của lệnh (cùng khối tệp của Việc của tổ, nạp qua quyền của Kế hoạch bộ phận).

**Hoãn.**
- Chia một bước thành nhiều việc cho nhiều máy hoặc nhiều nhóm (mục 6).
- Dòng nhắc khi đổi sang máy khác khổ hoặc khác số màu (mục 5). Phần số màu đã vẽ trong mockup kanban và khay Giao (mục 11.1); phần khổ còn hoãn.
- Làm lại giao diện Xếp lịch (mục 7) và trạng thái từng bước trong ngăn lệnh sau khi phát.
- Hồ sơ lệnh, Theo dõi sản xuất, phiếu công nghệ vẫn đọc máy và tổ của bước, chưa đọc từ việc đã giao (mục 8).
- ~~Giờ dự kiến nối nhau trong cột máy~~: bỏ hẳn ngày 08/11, chủ dự án cấm mọi số ước lượng trên kế hoạch bộ phận.

## 11. Đổi ngày 08/11/2026: bảng việc, bỏ bước Xếp

Chủ dự án chốt, thay phần kanban và thao tác ở mục 6 và mục 10:

- **Cách xem chính là bảng việc như Việc của tổ**; kanban theo máy chỉ là cách xem thứ hai, kéo thả ở đó là Giao luôn (mục 11.1). Người dùng chủ yếu dùng điện thoại nên bảng tự thành thẻ như các danh sách khác. Việc mới tới bộ phận đứng đầu.
- **Bỏ bước Xếp.** Chỉ còn một thao tác **Giao**: bấm Giao, chọn máy (máy theo báo giá chọn sẵn, đổi máy phải ghi lý do) và nhóm (máy chỉ thuộc một nhóm thì điền sẵn), bấm xác nhận là nhóm thấy việc ngay. Không có bản nháp máy và nhóm đứng chờ.
- **Trạng thái việc đi theo thao tác thật, năm trạng thái, mỗi trạng thái một chip lọc:** Chưa giao; bộ phận bấm Giao thì thành Đã giao; tổ bấm Bắt đầu ở Việc của tổ thì thành Đang chạy; tổ bấm Tạm dừng thì thành Tạm dừng; tổ bấm Kết thúc thì thành Hoàn thành. Chữ Đang chạy, Tạm dừng, Hoàn thành dùng đúng chữ của Việc của tổ. Máy chủ không lưu trạng thái riêng cho kế hoạch mà ghép từ trạng thái giao của bộ phận và trạng thái chạy của tổ, nên tổ bấm là kế hoạch đổi theo (đẩy bằng SSE như mục realtime). (Chủ dự án sửa ngày 08/11, thay cho câu "chỉ hai trạng thái" trước đó.)
- Dưới chip có một dòng chữ phụ lấy từ thông tin tổ vừa ghi: Đang chạy thì số đã làm trên số kế hoạch, Tạm dừng thì lý do tạm dừng tổ nhập, Hoàn thành thì giờ xong.
- **Rút lại** chỉ khi việc còn Đã giao, tức tổ chưa bấm Bắt đầu. Việc về Chưa giao, máy và nhóm cũ điền sẵn cho lần giao sau.
- **Bỏ thứ tự chạy do kế hoạch sắp.** Nhóm thấy việc theo thứ tự tới, tự quyết chạy việc nào trước.
- Bỏ luôn tick chọn nhiều và "Giao N việc", vì mỗi việc phải chọn máy và nhóm riêng. Đây là giả định, chưa được chủ dự án xác nhận.
- Bảng không có cột khâu trước (chủ dự án bỏ). Hàng khâu trước tới đâu chỉ xem trong ngăn: cột Hàng đang tới đâu và tab Giao và nhận.
- Bấm một dòng mở ngăn dùng lại ngăn của Việc của tổ (Quy cách, Sản lượng, Giao và nhận, Vật tư, KCS, Lịch sử, cột Hàng đang tới đâu). Nút đầu ngăn là Giao hoặc Rút lại.
- Vật tư: phát hành lệnh đã tự lập yêu cầu xuất kho đứng tên bộ phận (`vat_tu_tu_lap.py`), nên việc Chưa giao vẫn thấy yêu cầu xuất và tình trạng kho. Màn phải nghe cả sự kiện kho (`tickCua("san_xuat", "kho")`) như Việc của tổ.
- Bảng việc lọc, đếm chip, cắt trang ở máy chủ (`GET /api/ke-hoach-bo-phan/bo-phan/{id}/viec`): chip **Tất cả** đứng đầu rồi năm chip trạng thái (cùng khuôn hàng chip của Việc của tổ); tìm, kỳ theo ngày việc tới bộ phận, Lọc Máy và Nhóm, Cột (lưới chuẩn kéo rộng, ghim). Chip Hoàn thành ở bảng không còn giới hạn 7 ngày, kỳ lo phần đó; Kanban vẫn giữ 7 ngày.
- Việc Chưa giao: ô Máy ghi chữ nhạt tên máy theo báo giá, dòng dưới "theo báo giá"; ô Nhóm ghi chữ nhạt nhóm sẽ chọn sẵn. Chỉ là gợi ý, chưa ghi gì.
- **Hộp Giao** (08/11, chủ dự án bác kiểu chọn máy, nhóm ngay trong ô): hộp giữa màn trên máy tính, tấm trượt từ dưới trên điện thoại. Mỗi mục một nhãn trên: Máy chạy (danh sách một dòng một máy, chip tình trạng, số việc chờ), ô Lý do hiện ngay dưới danh sách khi chọn máy khác báo giá, Nhóm làm (một nhóm thì ghi chữ, nhiều nhóm thì hàng nút). Thiếu gì thì chữ nhắc nằm cạnh nút Giao.

### 11.1. Cách xem thứ hai: Kanban theo máy (chủ dự án yêu cầu 08/11)

Đầu màn có công tắc **Bảng việc | Kanban**. Bảng việc vẫn là cách xem chính; Kanban giúp người kế hoạch nhìn máy nào đang gánh việc gì rồi mới giao.

- **Bảng kanban chỉ có cột máy** (mỗi máy của bộ phận một cột, cuối là Làm tay). Việc chưa giao KHÔNG là một cột đứng chung hàng với máy (chủ dự án bác), mà nằm ở **khay Chờ giao** riêng.
- Đầu cột máy là dải màu nhạt có chấm màu và số đếm, màu theo tình trạng máy (`may_trang_thai.py`: xếp được xanh lá, đang chạy xanh ngọc, bảo trì cam, Làm tay xám); dưới dải là tình trạng máy và nhóm của máy.
- **Việc Hoàn thành không hiện trên kanban** (chủ dự án chốt). Muốn xem việc đã xong thì sang Bảng việc, chip Hoàn thành.
- Thẻ việc: trên cùng là nhãn số màu, số lượng và chip trạng thái; giữa là sản phẩm và khách; chân thẻ là mã lệnh và hạn có biểu tượng đồng hồ. Đang chạy có thanh tiến độ và số đã làm; Tạm dừng có lý do tổ nhập; việc chạy khác máy theo báo giá có dòng "Báo giá chạy …". Hạn tô đỏ khi trễ, vàng khi còn tới một ngày. Thứ tự thẻ trong cột: Đang chạy, Tạm dừng, Đã giao, cùng nhóm thì hạn gần trước; đây không phải thứ tự chạy.
- **Không có số ước lượng nào** (chủ dự án cấm): không giờ rảnh dự kiến, không "kịp hạn / trễ N giờ", không giờ chạy còn lại.
- **Giao kiểu chọn việc rồi chọn máy**, vẫn là một thao tác Giao, không quay lại bước Xếp:
  - Bấm một việc trong khay Chờ giao thì việc đó được chọn; đầu mỗi cột máy nhận được hiện nút "Giao vào đây", cột máy theo báo giá có viền xanh, nút đậm và dòng "Máy theo báo giá"; máy ít màu hơn việc có dòng nhắc "Máy 2 màu, việc cần 4 màu" (chỉ nhắc, không chặn).
  - Bấm "Giao vào đây": máy đúng máy theo báo giá (hoặc việc không có máy báo giá) và máy chỉ một nhóm thì giao luôn, hiện thông báo kèm Hoàn tác; cần lý do đổi máy hoặc phải chọn nhóm thì mở khay Giao đã chọn sẵn máy đó.
  - Thẻ Đã giao: Rút lại ở ngăn chi tiết (máy tính) hoặc nút trên thẻ (điện thoại); thẻ Đang chạy và Tạm dừng khoá.
- **Máy tính:** khay Chờ giao là ngăn trái rộng khoảng 270px, thu gọn được thành dải đứng "Chờ giao N". Việc trong khay xếp hạn gần trước, mỗi dòng có mã, hạn, sản phẩm, số màu, số lượng, máy theo báo giá. Ngoài bấm chọn còn kéo được: kéo việc trong khay thả vào cột máy là Giao; kéo thẻ Đã giao về khay là Rút lại, sang cột máy khác là đổi máy. Lúc chọn, trên bảng hiện dải "Đang chọn LSX-… . Bấm Giao ở cột máy, hoặc kéo thả." kèm Bỏ chọn.
- **Điện thoại:** không vuốt ngang, không kéo thả, không dùng thẻ to. Mỗi máy là một khối trắng xếp dọc: đầu khối có chấm màu tình trạng máy, tên máy, dưới tên là tình trạng máy (chữ cùng màu chấm) và nhóm của máy trên một hàng; tiếp theo là các chip đếm theo trạng thái ("1 đang chạy", "2 đã giao"…) hoặc "Chưa có việc". Việc trong khối là dòng hai tầng: tầng trên tên sản phẩm và hạn, tầng dưới mã lệnh, chip trạng thái, số màu, số lượng; Đang chạy thêm thanh tiến độ, Tạm dừng thêm lý do. Bấm đầu khối để gập hoặc mở danh sách việc của máy. Thanh "N việc chờ giao" dính đáy màn; bấm Xem mở tấm danh sách việc chờ giao từ dưới lên; chọn một việc thì tấm đóng, màn tự cuộn tới máy theo báo giá, thanh đáy đổi thành "Chọn máy cho LSX-…" kèm Hủy. Lúc đang chọn, đầu mỗi khối máy nhận được có nút "Giao vào đây" (cao 40px); khối máy theo báo giá có viền xanh, nút đậm và dòng "Máy theo báo giá"; máy ít màu hơn việc có dòng nhắc màu cam. Đầu màn một hàng: tiêu đề và công tắc hai biểu tượng.
- Tham khảo: ảnh `ref-dribbble-kanban-*.png` trong `docs/mockups/tham-khao-ke-hoach-bo-phan/` (cột nền xám bo tròn và thẻ trắng đổ bóng nhẹ, hạn tô màu theo độ gấp, đầu cột dải màu có số đếm).

**Làm lại giao diện Kanban (08/11, chủ dự án chê bản trên "rất xấu").** Mockup duyệt: [docs/mockups/ke-hoach-bo-phan-kanban.html](mockups/ke-hoach-bo-phan-kanban.html), tham khảo Linear (giấu nhóm trống), GitHub Projects (số đếm và tổng ở đầu cột), Atlassian (cột hàng chờ), Trello (thẻ gọn). Những dòng trên về khay, đầu cột và thẻ máy tính được thay như sau:

- Chờ giao là cột trắng cố định bên trái, không thu gọn, không đoạn hướng dẫn; bỏ dải "Đang chọn …", bỏ chọn bằng bấm lại thẻ hoặc Esc.
- Cột máy chia đều bề ngang (rộng 250 đến 340px), nhiều máy thì cuộn ngang có mờ mép; bảng cao tới đáy cửa sổ, mỗi cột tự cuộn dọc.
- Máy chưa có việc gom thành dải chip "Máy chưa có việc" trên bảng (vẫn nhận Giao vào đây và kéo thả); công tắc "Máy trống thành cột" (nhớ trong trình duyệt) bung lại thành cột. Điện thoại: dải chip ở cuối, không có công tắc.
- Đầu cột không tô nền: chấm, tên máy, số việc; dòng tình trạng máy (chữ màu chỉ khi không phải Xếp được hoặc Đang chạy) và nhóm; dòng "Chờ chạy N, Đang chạy N, tổng số lượng chờ" (cộng khi cùng đơn vị). Đang chọn việc thì dòng cuối thành nút "Giao vào đây", máy theo báo giá ghi thêm "theo báo giá"; cột không nhận được mờ đi.
- Thẻ: mã và hạn (không biểu tượng đồng hồ), sản phẩm một dòng (khách hàng ở chú thích khi rê chuột), số màu, số lượng, trạng thái. Mỗi cột hiện 6 thẻ, nhiều hơn thì "Còn N việc, xem ở Bảng việc" (sang Bảng việc, chip Tất cả, lọc theo máy).
- Giao hoặc rút xong, thẻ đổi cột ngay theo trả lời của máy chủ, không chờ nạp lại cả bảng (trước đó mất khoảng 4,6 giây).

Kéo theo trong code đã làm: cột `thu_tu_xep` và API `sap_xep` không còn dùng; `xep()` và `giao()` gộp thành một lệnh giao nhận máy, nhóm, lý do. Mockup: [docs/mockups/ke-hoach-bo-phan-bang-3-phuong-an.html](mockups/ke-hoach-bo-phan-bang-3-phuong-an.html).

### 11.2. Mỗi bộ phận một mục Kế hoạch, một dòng quyền (chủ dự án yêu cầu 08/11)

- **Gỡ mục chung "Kế hoạch bộ phận"** ở khối Sản xuất. Mỗi bộ phận dưới khối Tổ sản xuất có con **"Kế hoạch"** đứng đầu nhánh, trên các nhóm. Bộ phận tự làm (không có nhóm, ví dụ Tổ Cán màng, Tổ bồi) thành tiêu đề nhóm, bên trong là "Kế hoạch" và "Việc của tổ". Màn mở thẳng đúng bộ phận, không còn ô chọn bộ phận.
- **Mỗi mục sinh ra có dòng quyền riêng** `ke_hoach_bp_<id bộ phận>`, nhãn "Kế hoạch <tên bộ phận>". Máy chủ tự sinh và gỡ theo cây phòng ban lúc khởi động, như dòng theo tổ và theo kho. Ma trận phân quyền đặt dòng này ngay dưới dòng của bộ phận, chữ hiện là "Kế hoạch". Xem là mở được mục; một ô chi tiết **Giao việc** (giao, đổi máy, rút lại). Phạm vi khoá Tất cả vì dòng đã gắn một bộ phận. Gợi ý dòng: "Cho phép mở mục Kế hoạch của <bộ phận>: xem việc bộ phận nhận, đang ở máy nào, nhóm nào." Gợi ý ô Giao việc: "Cho phép: giao việc cho nhóm và chọn máy; rút lại việc nhóm chưa làm."
- Trong ma trận, bộ phận tự làm vẫn là một dòng lá (quyền Việc của tổ) và dòng "Kế hoạch" thụt dưới nó, hơi khác thanh bên (ở đó bộ phận thành tiêu đề nhóm).
- Migration `0456`: sinh dòng cho mọi bộ phận; vai đang có Xem ở dòng cũ `ke_hoach_bo_phan` được chép Xem (và Giao việc nếu có Thao tác) sang mọi dòng mới; gỡ dòng cũ; gỡ cột `thu_tu_xep`. Chép rộng ra mọi bộ phận chấp nhận được vì dự án chưa có người dùng thật.
- **Chấm đỏ và sự kiện theo từng bộ phận:** kênh thông báo `ke_hoach_bp_<id>`. Phát lệnh thì chấm mục Kế hoạch của mọi bộ phận còn việc chờ giao; người bấm phát lệnh không tự thấy chấm của mình (luật chung của chấm đỏ). Màn đang mở tự nạp lại khi có sự kiện của bộ phận hoặc của kho.
- Ngăn chi tiết dùng lại ngăn Việc của tổ ở chế độ chỉ xem: **không có tab KCS** và không có menu Đổi máy (thay câu ở mục 11 có liệt kê KCS); tệp của lệnh và lịch sử nạp qua đường gác theo bộ phận.
- Rút lại giữ máy và nhóm cũ, nên lần Giao sau khay chọn sẵn máy cũ; máy cũ khác máy theo báo giá thì phải ghi lại lý do.
- Thông báo "Đã giao … vào … cho …" có Hoàn tác, tự tắt sau 6 giây.
- **Hoãn:** dòng nhắc "Máy 2 màu, việc cần 4 màu" ở mục 11.1 chưa làm vì danh mục máy chưa có ô số màu.
- Chip Hoàn thành giữ việc xong trong 7 ngày gần nhất. Danh sách luôn gọn (việc còn sống cộng 7 ngày) nên không phân trang.

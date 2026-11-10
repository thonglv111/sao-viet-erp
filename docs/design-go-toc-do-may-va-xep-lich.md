# Bỏ tốc độ máy, làm lại Xếp lịch thành bàn hẹn đẩy lệnh

Bàn với chủ dự án ngày 08/11/2026. Chưa code. Bản đầu của file này ghi "gỡ bàn Xếp lịch"; chủ dự án đã sửa: giữ module, làm lại.

## 1. Bỏ tốc độ máy

- Thẻ máy bỏ tab Thông số kỹ thuật (tốc độ trung bình, tối thiểu, tối đa, đơn vị tốc độ, thời gian chuẩn bị). Ô Ghi chú chuyển sang tab Thông tin chung. Lưới máy bỏ cột "Tốc độ & Chuẩn bị".
- Bảng "Máy chạy được công đoạn này" ở thẻ công đoạn bỏ các cột Tốc độ chạy, Canh máy, Cách đo giờ chạy.
- Excel nhập xuất máy bỏ các cột tốc độ, đơn vị tốc độ, thời gian canh máy, và sheet "Khoản chuẩn bị".
- Lệnh sản xuất thôi tính giờ chạy bước máy theo tốc độ. Gỡ cảnh báo "máy chưa khai tốc độ" và dải nhanh–chậm.
- Gỡ ô "Dự kiến xong" ở chặng Sản xuất của đơn hàng bán (`DonHangBanPage.tsx`, kèm dòng trễ/kịp hạn giao), ở ngăn lệnh (`LenhSxNgan.tsx`), và băng trễ ở tiến độ đơn (`giao-hang/tien-do-don/TienDoDon.tsx`).

Cột DB giữ nguyên: `may_thiet_bi.toc_do`, `toc_do_min`, `toc_do_max`, `don_vi_toc_do`, `makeready_time_default`, khoá `chuan_bi_khoan` trong `fields_theo_loai`.

## 2. Xếp lịch mới: bàn gom lệnh để hẹn giờ đẩy

Mỗi dòng là một lệnh chờ đẩy xuống xưởng hoặc đã đẩy. "Đẩy lệnh" là phát hành lệnh xuống các bộ phận (rồi tới Kế hoạch bộ phận). Bàn trả lời bốn câu:

1. **Vật tư**: lệnh đã giữ chỗ đủ vật tư chưa, thiếu mấy món. Dùng lại đèn vật tư đang có (`XlVatTu`: ok, vàng, đỏ). Có lọc "Đủ vật tư".
2. **Giờ đẩy**: người điều phối đặt giờ hẹn đẩy cho lệnh. Tới giờ hẹn, phần mềm **tự đẩy**, không hỏi lại. Đã đẩy thì dòng hiện lúc đẩy thật. Vẫn bấm đẩy ngay được, và đổi hoặc bỏ giờ hẹn khi lệnh chưa đẩy.
3. **Hạn giao khách**: hiện trên từng dòng và thành mốc trên dải ngày, nhìn một hàng thấy giờ đẩy cách hạn giao bao xa.
4. **Không còn thanh giờ chạy**: dải ngày chỉ có mốc (hẹn đẩy, đã đẩy, hạn giao), vì tốc độ máy đã bỏ.

Giờ hẹn dùng lại cột `xep_lich_lenh.bat_dau_at` (đang lưu mốc bắt đầu người kéo thả). Lúc đẩy thật lấy từ thời điểm phát hành.

**Tự đẩy chạy thế nào.** Một vòng lặp nền như các vòng nhắc đang có ở `main.py` (nhắc chăm sóc khách, bảo trì), mỗi phút soát lệnh tới giờ hẹn mà chưa đẩy, gọi đúng hàm phát hành đang dùng (`services/xep_lich/service.phat_hanh` → `san_xuat/release.py`), người đẩy ghi là người đã đặt giờ hẹn. Lệnh vướng luật chặn phát hành (ví dụ vật tư chưa đủ, `MUC_CHAN_PHAT_HANH`) thì không đẩy được: lệnh nằm lại, dòng hiện lý do, người đặt hẹn nhận thông báo qua SSE. Chạy nhiều worker thì vòng lặp phải khoá để một lệnh không bị đẩy hai lần.

**Bố trí đã chốt** (mockup `docs/mockups/xep-lich-hen-day-B-day-du.html`, 08/11/2026):

- Bốn tab có số đếm từ máy chủ: Kẹt chưa đẩy được, Chưa hẹn giờ, Đã hẹn chờ tự đẩy, Đã đẩy. Mở màn vào Kẹt nếu có, không thì Chưa hẹn giờ.
- Mỗi tab phân trang ở máy chủ 25 dòng (`PhanTrangDayDu`). Tìm, lọc (Gấp, Chưa đủ vật tư, Sát hạn giao) và sắp xếp (gấp trước, rồi giờ hẹn) chạy ở máy chủ.
- Khoảng ngày dùng lại `XlKhoangNgay`, dài nhất 3 tháng. Tab Đã hẹn lọc theo giờ hẹn trong khoảng, tab Đã đẩy lọc theo lúc đẩy. Kẹt và Chưa hẹn giờ luôn hiện đủ.
- Lưới trái chỉ ba cột hẹp: Lệnh (mã, chip Gấp, sản phẩm), Khách hàng, Vật tư (chip ngắn: Đủ, Về dd/mm vàng, Về dd/mm đỏ khi về sau giờ hẹn). Dải ngày chiếm phần còn lại.
- Dải ngày chỉ vẽ mốc: chấm hẹn đẩy kèm giờ, tam giác vật tư về, hình thoi hạn giao (đỏ khi còn từ 2 ngày trở xuống), "›" khi hạn giao ngoài khoảng. Dưới mỗi ngày ở đầu cột là số lệnh hẹn đẩy ngày đó, đếm trên cả kết quả lọc.
- Chọn hàng loạt: tick cả trang, hoặc "Chọn cả N lệnh theo bộ lọc", rồi Hẹn giờ hoặc Đẩy ngay.
- Ngăn chi tiết có ba tab:
  - Vật tư: cần, đã giữ chỗ, tình trạng, đơn mua.
  - Lịch sử hẹn: lúc, người, việc. Các việc gồm hẹn, đổi giờ, bỏ hẹn, đẩy ngay, tự đẩy, tới giờ chưa đẩy được kèm lý do, thu hồi.
  - Công đoạn: bước, bộ phận nhận, số lượng.
  - Chân ngăn có Bỏ hẹn, Đổi giờ, Đẩy ngay.
- Đèn vật tư chỉ tính cho lệnh chưa đẩy, một lượt cho cả lô rồi giữ đệm.

Các thứ bàn Xếp lịch đang giữ ngoài Gantt vẫn ở lại: cập nhật lệnh đã đẩy, thu hồi, khoá máy theo khoảng giờ (`XlKhoaMay`). Cụm lệnh đẩy cùng nhau (`cum_id`) soát lại khi dựng mockup.

## 3. Bỏ "Hạn hoàn thành sản xuất"

- Bỏ ô ở Thông tin kế hoạch của lệnh (`LsxDetailView.tsx:1234`) và form bài ghép (`BaiGhep2Page.tsx:818`).
- Cột `lsx.han_hoan_thanh_sx` (và của bài ghép) đang được khoảng 30 file đọc: danh sách lệnh, hồ sơ, theo dõi, phiếu công nghệ, kế hoạch vật tư, tiến độ, Xếp lịch. Chỗ nào lấy nó làm mốc thì chuyển sang hạn giao khách; riêng kế hoạch vật tư chuyển sang giờ hẹn đẩy, vì vật tư phải về trước lúc đẩy.
- Cột DB giữ, không xoá.

## 4. Thứ tự

1. Dựng 3 phương án HTML cho bàn Xếp lịch mới ở `docs/mockups/`, chủ dự án chọn.
2. Phần danh mục máy, công đoạn, Excel làm trước được.
3. Phần giờ bước, Dự kiến xong, hạn hoàn thành SX và Xếp lịch đụng `lsx_service.py`, `routers/lsx.py`: làm sau khi phiên "Giao đơn cho người làm lệnh" commit.
4. Tài liệu: chủ dự án dặn 08/11/2026 là chưa viết, chờ nghiệm thu xong mới sửa (ngoại lệ có chủ ý với luật tài liệu đi kèm code). Khi viết: cuốn Cấu hình (mục máy, công đoạn), cuốn Kế hoạch sản xuất (Xếp lịch, phát hành, hạn hoàn thành), cuốn Kinh doanh (Dự kiến xong, dòng 118), và bản Hà Phương tương ứng.

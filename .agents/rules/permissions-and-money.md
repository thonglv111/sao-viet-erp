# Quyền, tiền và luật nghiệp vụ

Đọc file này trước khi thêm màn hoặc quyền, trả số tiền ra API, viết công thức, thiết kế tính năng nghiệp vụ hoặc ghi nhật ký.

## Quyền

RBAC là `module × action` cộng `scope` (own, department, all), kèm các quyền chi tiết ngoài CRUD như `view_cost`. Tính năng mới đặt ở một màn đang sống rồi để quyền quyết định ai thấy khối nào, không tách màn theo vai; câu hỏi đúng là "khối này gác bằng quyền nào". Ưu tiên dùng lại action đã có.

Một mục sidebar là một module, một phân hệ gồm nhiều module. Thêm màn mới thì thêm khoá vào `seed.MODULES` và `MODULE_GROUPS` (`frontend/src/components/PermissionMatrix.tsx`) đúng phân hệ; nhãn phân hệ lấy nguyên chữ của `NAV` trong `Sidebar.tsx`, nhãn ô quyền trùng chữ với mục menu. Đổi nhãn trong `seed.MODULES` chỉ cần khởi động lại backend.

Người được cấp ô quản trị được tin cậy: đặt lại mật khẩu kể cả của Giám đốc, sửa ma trận quyền, gán vai, tự sửa lương cho mình không phải lỗi và không nêu là nghi lỗi khi rà. Lọt phạm vi dữ liệu thì vẫn kiểm.

## Tiền

Mọi số tiền trên yêu cầu nhập xuất, phiếu kho và phản hồi KCS gác ở router bằng cách xoá số khỏi response; frontend chỉ ẩn cột cho gọn. Không có ngoại lệ cho người tạo yêu cầu. Ghi thì vẫn nhận: người không thấy giá vẫn gửi được giá seed từ đơn mua, sửa yêu cầu thì router giữ giá cũ thay vì xoá.

Ngoại lệ do chủ dự án chốt 27/09/2026: tiền gia công ngoài cho mọi người xem được màn, không gác `view_cost`. Đừng thêm gác lại khi review.

Ô "Đơn giá" trên phiếu kho chỉ chứa giá gốc; giá bán là cột riêng. Thêm một con số tiền khác nghĩa thì mở cột có tiêu đề riêng, dùng `GiaGocKcs` và `GiaBanDong` trong `frontend/src/pages/khoShared.tsx`. Tổng tiền dòng KCS cộng từng đợt, không nhân ngược giá bình quân đã làm tròn.

## Công thức và thiết kế động

Công thức nghiệp vụ đã có ở đâu thì gọi lại chỗ đó; chỗ cũ không export được thì tách thành hàm dùng chung, đừng chép. Quy đổi đơn vị và bù hao dùng `bu_hao_engine.chuoi_nguoc_dv`, không tự cuộn vòng lặp.

Không có luật tính ngầm: kết quả công thức là tiền như người dùng viết, không tự nhân thêm đơn giá. Ẩn chip hay đổi nhãn chỉ đụng tầng hiển thị; thấy hệ quả nghiệp vụ thì nói ra, không tự đổi engine.

Công đoạn, tổ, đơn vị, quy đổi, máy, mặt hàng do người dùng khai lúc chạy. Không suy theo tên, kể cả để điền mặc định: thiếu khai báo thì để trống và bày ô cho người chọn, vì suy trượt ở đây im lặng và ra số tiền sai. Engine cần biết điều gì thì gắn cờ lên danh mục, như `cong_doan.don_vi_vao/ra`. Hằng trong code chỉ là gợi ý cho form mở, như `HO_GOI_Y`. Được cứng là ngữ pháp engine: dòng giấy `to_nguyen → to → con/tay → cai`, vòng đời trạng thái chứng từ.

Luồng vật tư thiết kế cho mọi vật tư, không riêng giấy: vật tư thực dùng = kho thực xuất − phần nhập lại.

Sản phẩm chưa có người dùng thật (xác nhận 07/08/2026): sửa bug thì ưu tiên sửa cho đúng, test hồi quy để chống lệch logic chứ không để đóng băng số cũ. Đổi schema vẫn phải có migration.

## Thiết kế tính năng

Không phải cái gì cũng lên phần mềm. Sự kiện lẻ một bên tự biết thì ghi chú, đừng đẻ cột, luồng hay checklist chặn. Con số máy phải đọc để tính và giấy tờ xưởng cần cầm thì làm thật. Tương tác giữa các bên (giao nhận, duyệt, mượn, thay thế) phải ghi nhật ký để truy trách nhiệm.

Thiết kế mỗi luồng theo nhiều vai: thợ, tổ trưởng, kế hoạch và điều độ, KCS, quản lý và chủ xưởng, kho, kế toán lương. Spec là nền để bàn mở rộng, không phải kịch bản cứng.

Yêu cầu dạng "làm kỹ từng X" với hơn khoảng 5 module, màn hay bảng thì viết plan trước, mỗi module một việc.

## Tên người và nhật ký

Cột người báo, người làm, người duyệt do server gán từ `actor_id` hoặc chép từ chứng từ nguồn; không có trong schema nhập, frontend hiện khối chỉ đọc. Ô chữ "nhập hộ" trong code cũ là lỗi.

`backend/app/audit_registry.py` là nguồn nhãn tiếng Việt duy nhất của mã action. Thêm chỗ ghi audit thì khai vào đây, kể cả qua hàm bọc; `tests/test_audit_registry.py` quét AST và sẽ đỏ nếu thiếu. Mã của module đã gỡ vẫn phải khai vì dữ liệu cũ còn trong bảng. Màn danh mục cấu hình khai ở `backend/app/catalog_registry.py`, khoá bởi `tests/test_catalog_registry.py`.

# Mọi màn dưới 1 giây trên DB đo tải — kế hoạch

**Mục tiêu:** mọi API GET của các màn danh sách/báo cáo trả về dưới 1 s trên DB đo tải `svn_erp_tai`
(nhân 30 lần bản sao E2E: 13 nghìn đơn, 24 nghìn lệnh, 103 nghìn công việc SX, 13 nghìn hoá đơn và
phiếu thu, 6.293 nhân viên, 292 nghìn lượt chấm công).

**Chuẩn đo:** `scratchpad/chup_json.py` — làm nóng 1 lượt, lấy lượt tốt nhất trong 3. Mốc "trước" chụp
ở dev `78670964` vào `scratchpad/truoc/`.

## Ràng buộc chung

- Kết quả JSON SAU khi sửa phải GIỐNG HỆT mốc trước trên DB đo tải (so file chụp). Khác một byte là sai,
  trừ khi chứng minh được bản cũ sai và ghi lý do.
- Không đổi schema response, không đổi luật nghiệp vụ, không thêm cache dùng chung giữa các request
  (dữ liệu tiền/công phải tươi). Cho phép: gộp truy vấn, đẩy tổng/lọc xuống SQL, chỉ nạp cột cần,
  thêm chỉ mục (qua `db_migrations.py` + `docs/DB_SCHEMA.md` nếu là cột/bảng mới — chỉ mục thuần
  không cần DB_SCHEMA), bỏ tính lặp trong Python.
- Mỗi chỗ sửa có test chặn (đếm SQL hoặc tương đương kết quả) trong `backend/tests/`, thấy đỏ trước khi sửa.
- Không chạy `./init.ps1`, không chạy pytest toàn bộ; chạy file test của module bị đụng.
- Commit tiếng Việt, KHÔNG dòng Co-Authored-By. Không `git stash`. Không ghi vào DB nào (đo tải chỉ GET).

## Ba lát

| Lát | Ai | API |
|---|---|---|
| A. Sản xuất, đơn, giao hàng | phiên chính | xep-lich/lich, ke-hoach-vat-tu/theo-lenh, orders/dang-cho-dem, giao-hang/nhan-vien, giao-hang/bang-giao, may-thiet-bi/trang-thai, accounting/don-hang-cho-thu, accounting/ck-ke-cho-chi |
| B. Công nợ kế toán | tác tử 1 | accounting/receivables, reports/receivables (+so-chi-tiet, khoan-con-no), receivables/{id}/so-chi-tiet, reports/payables (+so-chi-tiet, khoan-con-no) |
| C. Chấm công, lương | tác tử 2 | attendance/shift-plan, timesheet, period, luong/table, khoan-theo-to, advances/ung-vien, payslip/me |

Xong ba lát: quét lại toàn bộ API (`quet_tai.py`) trên DB đo tải, gộp dev, đẩy, chờ CI xanh.

# Chống N+1 ở các API danh sách — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps dùng checkbox.

**Goal:** Bấm trang ở mọi màn danh sách phải về nhanh như Nhật ký: số câu SQL của một request
danh sách ĐỨNG YÊN khi số dòng tăng.

**Architecture:** Mỗi API dính lỗi đang hỏi DB TỪNG DÒNG (N+1) khi dựng response. Sửa bằng cách
NẠP GỘP một lần cho cả trang (dict theo id), rồi hàm dựng dòng tra dict — khuôn đã có:
`purchase_service._nap_lo_yeu_cau` + `_to_department_request_out`. Không đổi kết quả trả về.

**Tech Stack:** FastAPI + SQLAlchemy 2, pytest (SQLite in-memory), đo thật trên Postgres bản sao.

## Global Constraints

- Response của mọi API giữ NGUYÊN từng trường, từng giá trị, thứ tự dòng. Đây là sửa hiệu năng,
  không đổi nghiệp vụ.
- Truy vấn chỉ ở `repositories/`; gộp logic ở `services/`; router chỉ điều phối.
- Không đổi schema DB (nếu buộc thêm index ⇒ migration ở `db_migrations.py` + `docs/DB_SCHEMA.md`).
- Không chạy `./init.ps1`, không chạy pytest toàn bộ local: chỉ chạy file test liên quan; CI chạy đủ.
- Commit tiếng Việt, kiểu `perf(<module>): ...`.

## Cách đo (dùng cho mọi Task)

- Đo thật: `cd <worktree>/backend && python <scratchpad>/do_mot.py "<url trang 5>" "<url trang 50>"`
  (DB bản sao `svn_erp_e2e2510`, chỉ GET). Script ở
  `C:\Users\WINDOW~1\AppData\Local\Temp\claude\D--jobs-SVN\d2579cf0-da35-4ab4-8229-f50b0618c10e\scratchpad\do_mot.py`.
- Guard: mỗi module một file `backend/tests/test_<module>_khong_n_cong_1.py` theo khuôn
  `tests/test_mua_hang_khong_n_cong_1.py`: dựng dữ liệu ÍT dòng và NHIỀU dòng, đếm câu SQL của
  CÙNG một request, `assert nhieu <= it + <hằng nhỏ>`. Test phải ĐỎ trước khi sửa.

## Số đo trước khi sửa (26/10, bản sao, admin)

| API | Trang 5 → 50 dòng | Giây (50) |
|---|---|---|
| /api/giao-hang/requests | 61 → 468 câu | 4,5 |
| /api/orders | 85 → 186 | 0,88 |
| /api/kho/phieu | 32 → 105 (27 dòng) | 0,42 |
| /api/quotations | 20 → 74 (21 dòng) | 0,38 |
| /api/attendance/logs | 7 → 35 | 0,17 |
| /api/accounting/payment-vouchers | 12 → 25 (8 dòng) | 0,16 |
| /api/accounting/payment-receipts | 15 → 24 | 0,16 |
| /api/overtime | 9 → 17 | |
| /api/leaves | 13 → 18 (8 dòng) | |
| /api/muc-thu-chi | 5 → 10 (11 dòng) | |
| /api/kho/de-nghi | 28 → 32 | |
| /api/giao-hang/bang-giao | 32 → 36 | 0,29 |
| /api/giao-hang/nhan-vien | 327 câu / 15 người | 1,94 |
| /api/giao-hang/tai-xe-chon | 194 / 15 | 1,03 |
| /api/orders/dang-cho-dem | 166 | 0,85 |
| /api/purchase-requests | 84 / 4 dòng | 0,44 |
| /api/accounting/inbox | 84 / 4 | 0,44 |
| /api/ke-hoach-vat-tu/theo-lenh | 76 / 6 | 0,73 |
| /api/accounting/mua-hang-cho-chi | 65 / 3 | 0,29 |
| /api/accounting/receivables | 47 / 50 | 0,58 |
| /api/ke-hoach-vat-tu/can-doi | 43 / 4 | 0,54 |
| Bàn tổ `/api/san-xuat/.../work-items` | 127 / 25 lệnh | 0,5–2,7 |

API có tham số đường dẫn (bàn tổ, chi tiết…) đo riêng ở Task 3.

---

### Task 1: Giao hàng + Bán hàng + Kho

Phạm vi: `/api/giao-hang/requests`, `/nhan-vien`, `/tai-xe-chon`, `/bang-giao`; `/api/orders`,
`/api/orders/dang-cho-dem`; `/api/quotations`; `/api/kho/phieu`, `/api/kho/de-nghi`.
Nghi can đã biết: `routers/delivery.py` `_request_out` gọi từng dòng; `nhan_vien_giao_hang` gọi
`chuyen_cua_kip`, `thong_ke_ngay`, `thong_ke_thang`, `trang_thai_nhan_vien`, `get_request` mỗi người;
`_ai_la_tai_xe` dùng chung cho `tai-xe-chon`.

- [ ] Viết guard test cho từng API (đỏ) → sửa nạp gộp → xanh → đo lại bằng `do_mot.py`.
- [ ] Commit theo từng API/nhóm.

### Task 2: Kế toán + Mua hàng + Nhân sự + Kế hoạch vật tư

Phạm vi: `/api/accounting/payment-vouchers`, `/payment-receipts`, `/inbox`, `/mua-hang-cho-chi`,
`/receivables`; `/api/purchase-requests`; `/api/muc-thu-chi`; `/api/ke-hoach-vat-tu/theo-lenh`,
`/can-doi`; `/api/attendance/logs`, `/api/overtime`, `/api/leaves`.

- [ ] Như Task 1.

### Task 3: Sản xuất (bàn tổ + API có tham số đường dẫn)

Phạm vi: `services/san_xuat/board.py` `_so_lieu_map` → `_nhan_loi` → `dau_vao.tran_nhan` /
`nhom_truoc` hỏi `cong_viec_chang_truoc`, `canh_phu_thuoc_toi`, `ban_giao_toi_dich` mỗi dòng.
Sửa: bản nạp gộp `cong_viec_chang_truoc_nhieu(cvs)` + `canh_phu_thuoc_toi_nhieu` +
`ban_giao_toi_nhieu_dich` (đã có), truyền vào `tran_nhan`/`nhom_truoc` qua tham số tuỳ chọn; đường
một-công-việc (drawer, ghi mẻ) giữ nguyên.
Thêm: quét các API danh sách có tham số đường dẫn, xử lý cái nào tăng theo số dòng.

- [ ] Test tương đương: với mọi công việc trong fixture, kết quả bản gộp == bản từng dòng.
- [ ] Guard đếm câu SQL bàn tổ ít/nhiều lệnh.

### Task 4: Gộp + đẩy

- [ ] Gộp nhánh các Task vào dev, chạy các file test mới, đẩy, theo dõi CI/CD tới khi xanh.

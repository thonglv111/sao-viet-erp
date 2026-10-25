# Kế hoạch vá lỗi đợt bấm thử 25/10/2026

Trạng thái: 26/10/2026 chủ duyệt "làm đi, theo đề nghị hết" — mọi câu §3 lấy phương án đề nghị (in đậm).
Đang thực hiện theo phân công §5.

Nguồn: hai phiên bấm thật trên bản sao `svn_erp_e2e2510` theo `KE_HOACH_BAM_THU_E2E_25102026.md` và
`KE_HOACH_BAM_THU_THEO_VAI_25102026.md`. Bằng chứng từng ca và đề xuất chi tiết từng lỗi (nguyên nhân file:dòng,
cách vá, test) chép sang `docs/e2e-25102026/`:
- `ket-qua-SX.md` (ca + lỗi L-SX), `ket-qua-VAI.md` + `ket-qua-VAI-loi.md` (ca + lỗi L-VAI)
- `de-xuat-va-SX.md`, `de-xuat-va-VAI.md` — file này chỉ gom và chốt thứ tự; chi tiết vá đọc ở hai file đó.

Tổng: 98 lỗi (L-SX-01…49, L-VAI-01…49). Nặng 7, đều bên SX: L-SX-04, 06, 19, 28, 35, 43, 45.

## 1. Nguyên tắc vá (chủ dặn: ít đổi logic hiện nay nhất)

- Chặn ở cửa vào (validate máy chủ, khoá ô FE), không viết lại engine tính giá / khoán / lương.
- Dùng lại thứ đã có: `org_scope.chu_cua` / `nhom_dung_chung_user_ids` / `can_access` cho phạm vi;
  `with_for_update` theo khuôn `khoa_cong_viec` cho tranh chấp; `hub.gui` / `hub.publish` / `bao_quyen_doi`
  cho real-time; `OSoLe` + `docSoLe` (đang nằm trong `KhungFormPhieu.tsx`) cho ô số.
- Lỗi cùng gốc vá một lần. Không thêm cột. Chỉ hai chỗ có thể cần migration DỮ LIỆU (L-SX-39, L-SX-42 nhánh B).
- Mỗi đợt dưới đây = một commit, verify bằng pytest nhắm file + `npx tsc` (không `init.ps1`), luồng UI nào đổi
  thì bấm lại đúng luồng đó.

## 2. Đợt vá theo thứ tự

Thứ tự: lỗi Nặng trước, rồi lộ dữ liệu ngoài phạm vi, rồi theo cụm file để hai đợt không đụng cùng file.
Mã có dấu (?) là đang chờ chủ chốt ở §3 — vá theo phương án chủ chọn, mặc định là phương án đề nghị.

### Đợt 1 — Ô gõ số (Nặng: 06, 35) — chỉ FE
| Mã | Vá | File chính |
|---|---|---|
| L-SX-06 | Ô SL Yêu cầu nhập xuất giữ chữ đang gõ, không dựng lại từ `Number()` mỗi phím | KhoDeNghiPage.tsx |
| L-SX-35 | Sáu ô số hộp Sửa dòng lương: giữ chữ, cho "-" đầu, ô trống không tự điền 0 | LineEditModal.tsx |
| L-VAI-33 | Ô % cọc nhận "12,5" | DonHangBanPage.tsx |
| L-VAI-28 | Kẹp CK ≤100 % cả lúc nháp | BaoGiaPage.tsx |

Cách làm: tách `OSoLe` + `docSoLe` ra `components/OSoLe.tsx` (thêm tuỳ chọn `am`), KhungFormPhieu import lại.
Không viết khuôn ô số lần thứ ba.

### Đợt 2 — Khâu chuẩn bị giấy (Nặng: 04, 19)
| Mã | Vá | File chính |
|---|---|---|
| L-SX-19 | `doi_nguon_giay` chặn lệnh Đã phát hành / Đã đóng / có trọn gói sống; FE khoá ô | lsx_service.py, LsxDetailView.tsx |
| (kèm) | `replace_routing` chặn lệnh Đã phát hành / Đã đóng (lỗ cùng họ, đang mở qua API) | lsx_service.py |
| L-SX-04 (?) | `replace_routing` chặn bỏ / đổi bước Cắt giấy cuộn, Tề giấy in khi lệnh có nguồn giấy; `kiem_thieu` đếm dòng giấy thật | lsx_service.py |
| L-SX-21 (?) | Cuộn khổ bằng khổ in vẫn chèn Tề; `doi_nguon_giay` gọi `_kiem_tuyen_luu` trước commit | chuan_bi_giay.py, lsx_service.py |
| L-SX-03 (?) | Tạo lệnh từ phiếu có vật tư thiếu ĐVT → 422 nêu tên món | lsx_service.py |
| L-SX-17 | Hiện câu "Tổ chưa có máy chạy công đoạn này…" ra màn (đang chỉ ở aria-live) | LsxRoutingTable.tsx |
| L-SX-20 = L-VAI-10 | Xếp lịch in `to_nguyen`: FE dùng `nhanChang(c.don_vi_vao)` (luật mã chặng) | XlNgan.tsx |

Không đổi `_ly_do_khong_cap_nhat` (dùng chung với `dong_bo_danh_muc`).

### Đợt 3 — Hồ sơ nhân sự và "tự làm với chính mình" (Nặng: 28)
| Mã | Vá | File chính |
|---|---|---|
| L-SX-28 | `apply_transition`: ngày hiệu lực < ngày vào làm → 400; FE `min=hire_date` | employee_service.py, ActionDialog.tsx |
| L-SX-44 (?) | `probation_restart` / `reinstate` / `transfer` / `promote` có ngày hiệu lực trong kỳ lương (và kỳ công) đã chốt → chặn bằng `ky_luong_guard` (Đợt 4, làm Đợt 4 trước Đợt 3 hoặc tạo guard ở Đợt 3) | employee_service.py |
| L-VAI-20 | Không tự cho mình nghỉ việc / đình chỉ (khuôn `CannotLockSelf`) | employee_service.py |
| L-VAI-22 | Tuyển lại không mở khoá tay (đọc nhật ký `lock_user` có sẵn, không thêm cột); tab Tài khoản tải lại | employee_service.py, EmployeeDetailPanel.tsx |
| L-VAI-23 | Khoá / thu hồi phiên / nghỉ việc → `bao_quyen_doi` sau commit; kênh SSE tự cắt khi tài khoản hết hiệu lực | user_admin_service.py, employee_service.py, quotations.py |
| L-VAI-48 | Hộp Điều chuyển báo trước "tài khoản sẽ mất vai «…»" | ActionDialog.tsx |
| L-VAI-12 | Ẩn nút Duyệt đơn nghỉ của chính tổ trưởng (máy chủ đã chặn, trả thêm cờ `duyet_duoc`) | leaves.py, LeaveTable.tsx |

Hồ sơ đã hỏng sẵn trên DB dev (L-SX-28) sửa tay, không migration (prod DB trắng).

### Đợt 4 — Lần ghi sản lượng, kỳ đã chốt, tranh chấp (Nặng: 43)
| Mã | Vá | File chính |
|---|---|---|
| (nền) | Tạo `services/ky_luong_guard.py` chép khuôn `ky_cong_guard.py`: `ly_do_ky_luong_da_khoa(db, *ngay, viec)` trả câu phân biệt "đã chốt" / "đã chi" | ky_luong_guard.py (mới) |
| L-SX-43 (?) | `_khoang_luc_bam`: `bat_dau` không lùi quá đầu phiên đang mở, không lùi vào kỳ lương đã chốt; `tao_batch` gọi guard | san_xuat/san_luong.py |
| L-SX-47 | `sua_so_me` và `cap_nhat_theo_danh_muc` gọi guard theo ngày `bat_dau` của lần ghi; nút "Cập nhật theo danh mục" mờ kèm câu ở lần ghi kỳ đã chốt | san_xuat/san_luong.py, viec_khoan.py |
| L-SX-48 (?) | `_chan_ky_khoa` thêm nhánh: phiếu thu phải thu có dòng gắn đơn có sale → gọi guard cho ngày mới và ngày cũ (lập, sửa, huỷ) | accounting_service.py |
| L-SX-49 (?) | `_phan_he_phieu_chi` xếp phiếu chi CK / kê vào phân hệ phải thu (hiện trả None nên `loi_ky_khoa` bỏ qua) | cong_no_khoa_ky.py |
| L-SX-22 | Hai người cùng báo hư một máy ra hai YC → khoá dòng máy trước khi đọc | dung_may_repo.py, dung_may.py |
| L-SX-23 | Hai người cùng bấm Bắt đầu ra hai phiên → khoá dòng việc (`with_for_update`) | thuc_thi.py |
| L-SX-24 | Lịch sử việc lẫn nhật ký của id bị cấp lại → lọc theo mốc tạo | lich_su_viec.py |

Bốn lỗi 44 / 47 / 48 / 49 cùng họ "ghi vào kỳ đã chốt mà không chặn". Kỳ công đã có hàm chung
(`ky_cong_guard.ly_do_ky_cong_da_chot`), kỳ công nợ đã có một cửa (`loi_ky_khoa` qua `_chan_ky_khoa`), riêng kỳ
lương thì luật "đã chốt / đã chi thì khoá" đang chép ở ba chỗ (`_chan_neu_ky_luong_da_khoa` tạm ứng,
`KhoanSuaTayService._ky_mo`, `dung_may._chan_ky`). Kỳ hoa hồng chính là kỳ lương tháng đó. Nên thêm MỘT hàm
`ky_luong_guard` và gọi ở cửa vào; ba chỗ cũ đang đúng, để nguyên (chuyển dần nếu tiện, không bắt buộc).

### Đợt 5 — Bảng lương (Nặng: 45)
| Mã | Vá | File chính |
|---|---|---|
| L-SX-45 | `generate` giữ dòng cũ của người rơi khỏi `xu_ly` (0 ngày biên chế) nên `_nguoi_thieu_trong_anh_chup` chặn Chốt mãi → xoá các dòng đó (chỉ trong phạm vi người bấm, `co_dong` đã giữ dòng có sửa tay / hoa hồng / khoán), ghi audit; repo thêm `delete_lines(ids)` | payroll_service.py, payroll_repo.py |
| L-SX-31 | Cột Khoán SP cộng cả `khoan_cong_them` để cộng ngang ra đúng thực lĩnh | BangLuongTab.tsx |
| L-SX-37 | Sửa tay sổ khoán đẩy SSE, màn kế toán khác tự nạp | payroll.py, KhoanTheoToTab.tsx |
| L-SX-46 | "Phiếu lương gần nhất" ghi đúng trạng thái, tự cập nhật lúc công bố | HoSoCuaToiPage.tsx |
| L-VAI-41 (?) | Ô Hoa hồng bấm được mà ngăn soi 403 | BangLuongTab.tsx hoặc payroll.py |
| L-VAI-24 | Sự kiện tạm ứng bỏ `code` (đang lộ tên người cho cả khối nhân sự) | payroll.py |
| L-VAI-25 | Tạm ứng: ngày dd/mm/yyyy, nhãn nhật ký tiếng Việt, tiền dấu chấm | TamUng*.tsx, audit_registry.py, payroll_service.py |

### Đợt 6 — Engine khoán (sổ Khoán theo tổ)
| Mã | Vá | File chính |
|---|---|---|
| L-SX-27 (?) | Lần ghi ở công đoạn chưa khai Khoán hiện dòng 0 đ + cảnh báo "chưa có cấu hình Khoán" | khoan_ky_repo.py, khoan_ky.py, payroll.py |
| L-SX-41 | Lần ghi rơi nhánh chặn vẫn vào sổ 0 đ, số kế toán gõ tay không mất; câu cảnh báo đúng loại | khoan_ky.py, payroll.py |
| L-SX-29 | Hiện lý do "công thức khoán lỗi …" ở sổ và ngăn soi | khoan_ky.py, khoan_theo_to.py, KhoanTheoToTab.tsx, SoiKhoanKy.tsx |
| L-SX-34 (?) | Công thức ra tiền âm | khoan_ky.py |
| L-SX-32 | Kế toán phạm vi Cả phòng: ô Tổ chỉ liệt kê tổ trong phạm vi, không 403 lúc mở | khoan_theo_to.py |
| L-SX-33 (?) | Cộng thêm của người chuyển tổ giữa kỳ hiện ở đúng một chỗ sửa được | khoan_theo_to.py, KhoanTheoToTab.tsx |
| L-SX-36 | Sửa chữ gợi ý Tổ in theo luật engine (CN / lễ không tính sản lượng); dòng gạch không in số chia | DepartmentsPage.tsx, KhoanTheoToTab.tsx |
| L-SX-42 (?) | Bỏ luật chặn bật Giao hàng dựa trên cờ `has_piece_work` đã chết | department_service.py |

Vá 27 → 41 → 29 một lượt trong `KhoanKyService.tinh` (cùng gốc: lần ghi bị loại trước khi vào sổ).

### Đợt 7 — Phạm vi Kinh doanh và Giao hàng (lộ / ghi dữ liệu ngoài phạm vi)
| Mã | Vá | File chính |
|---|---|---|
| L-VAI-01 | Lập báo giá từ phiếu: so chủ khách (`chu_cua`), không so người lập | routers/quotations.py |
| L-VAI-05 | `quote_id_for_phieu` kiểm phạm vi | routers/quotations.py |
| L-VAI-04 | Tạo đơn từ báo giá kiểm `can_access` báo giá | order_service.py |
| L-VAI-06 | Gợi ý tái bản chặn khách ngoài phạm vi | routers/phieu_tinh_gia.py |
| L-VAI-15, 16 | Giao hàng: lập yêu cầu và "còn phải giao" kiểm `can_access` đơn | delivery.py, delivery_service.py |
| L-VAI-14 (?) | Phụ xe thấy chuyến có tên mình | delivery_repo.py, delivery_service.py |
| L-VAI-09 | Điều chuyển khách sang sale phòng con (cây phòng, không phải đúng một phòng) | routers/customers.py |
| L-VAI-43 (?) | Ô lọc NV phụ trách theo nhóm dùng chung | routers/customers.py |
| L-VAI-07 | Toast "đủ cọc" tới sale chủ khách hiện tại | orders.py, accounting.py |
| L-VAI-17 | SSE hoá đơn gửi nhóm bỏ mã chứng từ | accounting.py |

Cùng khuôn: mọi đường có `order_id` / `quotation_id` / `customer_id` trên URL phải qua `can_access` của chứng từ
nguồn. Chung một bộ test phạm vi.

### Đợt 8 — Báo giá, đơn bán, hoá đơn, tiền
| Mã | Vá | File chính |
|---|---|---|
| L-VAI-27 (?) | Giá gõ tay cho markup ≥1000 % hiện 500 "mất mạng" | quotation_service.py |
| L-VAI-30 | Rào kê thiếu biên 1 đ như rào CK | exception_gate.py |
| L-VAI-32 | Tạo báo giá từ phiếu dùng `_cong_tong` (tổng lệch sau lần sửa đầu) | quotation_service.py |
| L-VAI-34 | Đặt cọc về 0 thì thật sự hết cọc | order_service.py |
| L-VAI-36 | Tiền có thể cấn cộng cả tiền hoá đơn huỷ đã về quỹ đơn | DonHangBanPage.tsx |
| L-VAI-37 | Trạng thái "Cọc thu vượt tổng đơn" thay vì "Đã ghi đủ hoá đơn" | ban_hang_cho_thu_chi.py + 2 màn |
| L-VAI-35 (?) | Huỷ phiếu thu của hoá đơn đã chi CK / kê | accounting_service.py |
| L-VAI-40 (?) | Hoa hồng còn tính trên cọc của đơn huỷ đã trả lại | hoa_hong_service.py |
| L-VAI-38 (?) | Làm tròn tiền cọc | coc.py |
| L-VAI-29 (?), 31 (?) | Cột "Người lập" / ai nhận kết quả duyệt | BaoGiaPage.tsx, quotations.py |
| L-VAI-42 | Câu lỗi / nhật ký tiền dùng `so_vn` (dời sang `services/dinh_dang.py`) | accounting_service.py, purchase_service.py |
| L-VAI-39 | Ô ngày: Enter ngoài khoảng trả về chữ cũ | ChonNgay.tsx |

### Đợt 9 — Bàn tổ, dừng máy, KCS
| Mã | Vá | File chính |
|---|---|---|
| L-VAI-13 | KCS "Chờ đóng lệnh" 9 s: tách ĐẾM khỏi DỰNG DÒNG, chỉ dựng dòng trang hiện tại | san_xuat/kcs.py |
| L-VAI-45 | Máy chủ chậm thì bàn tổ không hiện "Tất cả 0" | ThucHienSxPage.tsx |
| L-SX-10 | `may_cua_to` gồm cả máy tổ đứng (`may_thuoc_to`) | dung_may_repo.py |
| L-SX-18 (?) | Tổ B báo máy hư khi tổ A đang chạy | dung_may_repo.py, dung_may.py, BaoDungMayModal.tsx |
| L-SX-25 | Ô ngày dừng máy theo ngày xưởng | BaoDungMayModal.tsx |
| L-SX-26 (?) | Nút lý do chọn sẵn, cao 44 px | BaoDungMayModal.tsx, thuc-hien-sx.css |
| L-SX-30, 40 | Hộp ghi sản lượng nói giá theo công thức, không in đơn giá / giá cố định thô; đơn vị "tờ" | board.py, schemas/san_xuat.py, ThsxExecPanels.tsx |
| L-SX-09, 13 | Không chớp "Không tải được …" lúc đang nạp (cờ lỗi thật) | ThsxDrawer.tsx, ThucHienSxPage.tsx, XepLichPage.tsx, XlNgan.tsx |
| L-VAI-46 (?) | Giao người đang chạy việc khác | thsxTinhTrangNguoi.ts |
| L-VAI-11 (?) | Danh sách người tổ khác (94 người) cho thợ chỉ Xem | san_xuat/board.py |
| L-VAI-47 (?) | Đề nghị vật tư từ bàn tổ mang tổ nào | san_xuat/vat_tu_de_nghi.py |

### Đợt 10 — Phát hành, vật tư tự lập, kho
| Mã | Vá | File chính |
|---|---|---|
| L-SX-11 | Phát hành cập nhật đổi tổ cho cả bước loại Tổ | release_update.py |
| L-SX-12 (?) | Lệnh đã phát hành chưa chạy dời lịch mà xưởng không nhận | XlNgan.tsx |
| L-SX-15 | Bước có vật tư định mức 0 vẫn bắt tổ tự xin | vat_tu_tu_lap.py |
| L-SX-14 (?) | Yêu cầu đã xuất một phần của lệnh bị thu hồi | stock_voucher_service.py |
| L-SX-16 | Bàn tổ không cộng số của yêu cầu kho đã huỷ, hiện lý do huỷ | board.py, san_xuat_san_luong_repo.py |
| L-SX-07 | Sửa số xuất nhầm đẩy sự kiện xuống bàn tổ (`_bao_san_xuat`) | kho_voucher.py |

### Đợt 11 — Danh mục, quyền, nhật ký, real-time cấu hình
| Mã | Vá | File chính |
|---|---|---|
| L-SX-02 | Nhân bản công đoạn có máy / vật tư 500 | cong_doan_service.py |
| L-SX-01 (?) | Nút Nhân bản công đoạn hệ thống | CatalogListPage.tsx |
| L-SX-39 (?) | Giá giấy / bậc khoán lộ cho người không có ô Xem giá | vat_lieu_kho.py, cong_doan.py, PermissionMatrix.tsx |
| L-SX-38 | Nhật ký: nhãn đối tượng + chi tiết tiếng Việt "từ → sang", ghi cờ Tổ in | audit_registry.py + 5 nơi ghi |
| L-VAI-49 | Đổi cấp trên của tổ đẩy SSE, thanh bên tự nạp | rbac.py, AppShell.tsx |
| L-VAI-21 | Duyệt / từ chối đề nghị hồ sơ báo người gửi | employees.py, AppShell.tsx |
| L-VAI-44 | Câu xoá nhóm dùng chung đúng với người ở hai nhóm | NhomDungChungPopover.tsx |
| L-VAI-18 (?) | Ô In phiếu | ma trận quyền / accounting.py |
| (kèm) | Lỗi 500 hiện "Không kết nối được máy chủ": middleware bắt lỗi chung đặt TRONG CORS. Gốc chung của L-SX-02, L-VAI-27 | main.py |

### Không vá code
- L-VAI-03, L-VAI-26: nhật ký phiếu cũ hiện ở phiếu mới vì DB bản sao đặt lại sequence sau khi xoá dữ liệu.
  Lần sau dọn dữ liệu thì xoá luôn `audit_logs` theo target, hoặc đừng đặt lại sequence.
- L-VAI-02: trợ lý không thấy khách — sửa cấu hình (xem §3).
- L-VAI-19: "Kế toán kho chỉ Xem bị coi là người kho" là đúng luật 24/09; chỉ ca thử đặt quyền P22 sai hình vai.
- L-VAI-08: "41.8910 đ" là hai số (số cũ gạch + số mới) đọc dính; muốn thì chèn "→".
- L-SX-05, L-SX-08: chưa rõ gốc bằng đọc code. Bấm lại kèm tab Network trước khi vá; vá mò dễ che lỗi thật.

## 3. Câu cần chủ chốt

Mỗi câu kèm phương án ĐỀ NGHỊ (ít đổi logic nhất, trừ khi trái luật chủ đã chốt). Chủ chỉ cần trả lời câu
nào muốn khác đề nghị; còn lại vá theo đề nghị.

Sản xuất / lệnh
1. L-SX-04 — bỏ tay bước Cắt giấy cuộn / Tề do nguồn giấy dựng: **chặn, bảo đổi Nguồn giấy** (đề nghị) / cho bỏ rồi máy tự gỡ nguồn.
2. L-SX-21 — cắt cuộn đúng khổ in: **vẫn chèn bước Tề** (đề nghị, sửa một dòng) / không Tề, Cắt ra thẳng tờ in.
3. L-SX-03 — vật tư thiếu ĐVT: **chặn lúc tạo lệnh, nêu tên món** (đề nghị) / cho tạo, chỉ cảnh báo.
4. L-SX-01 — nhân bản công đoạn hệ thống (TGI…): **giữ ẩn nút, sửa lại ca GS04** (đề nghị) / cho nhân bản.
5. L-SX-12 — lệnh đã phát hành, chưa việc nào chạy, dời lịch: **hiện "Phát hành cập nhật"** (đề nghị, máy chủ đã sẵn) / khoá ô giờ, bắt thu hồi.
6. L-SX-14 — yêu cầu đã xuất một phần của lệnh bị thu hồi: **chặn xuất tiếp tới khi phát hành lại** (đề nghị) / chốt ở số đã xuất.
7. L-SX-43 — phiên chạy liền từ kỳ trước: **`bat_dau` không lùi vào kỳ lương đã chốt** (đề nghị) / không lùi quá 0h hôm nay.

Bàn tổ / dừng máy
8. L-SX-18 — tổ B báo máy hư khi tổ A đang chạy: **chỉ hiện "Đang chạy LSX… của tổ A" và toast cho tổ A, không tự dừng việc tổ A** (đề nghị, không nới quyền) / tạm dừng mọi việc trên máy.
9. L-SX-26 — mở hộp Báo dừng máy: **chọn sẵn "Máy hư"** (đề nghị) / không chọn sẵn, ẩn phần dưới.
10. L-VAI-46 — một người tham gia hai việc đang chạy cùng lúc: **được, như luật máy chủ 10/10; FE bỏ chặn** (đề nghị) / không, chặn ở máy chủ.
11. L-VAI-11 — ai lấy được danh sách người tổ khác: **ai ghi được sản lượng ở tổ** (đề nghị) / chỉ tổ trưởng.
12. L-VAI-47 — đề nghị vật tư từ bàn tổ mang tổ: **trên hồ sơ người bấm (giữ luật 11/10)** (đề nghị) / tổ của việc.
13. L-VAI-14 — phụ xe: **thao tác chuyến như tài xế** (đề nghị, một điều kiện lọc) / chỉ xem.

Khoán / lương
14. L-SX-27 — lần ghi ở công đoạn chưa khai Khoán báo cho tổ nào: **chỉ tổ đã có lần ghi có Khoán hoặc có người ăn lương khoán** (đề nghị) / mọi tổ (ngập cảnh báo).
15. L-SX-33 — cộng thêm của người chuyển tổ giữa kỳ: **hiện và sửa ở tổ đã gõ** (đề nghị) / đi theo người sang tổ mới.
16. L-SX-34 — công thức khoán ra tiền âm: **giữ âm, cảnh báo trước chốt** (đề nghị, đúng luật "công thức tường minh") / kẹp về 0.
17. L-SX-42 — cờ `has_piece_work` chặn bật Giao hàng: **bỏ luật chặn** (đề nghị, không migration) / giữ luật, migration dọn cờ.
18. L-SX-36 — luật Tổ in: xác nhận **luật engine 21/10 (ngày CN / lễ tổ in không tính sản lượng)** thay chữ 15/09.
19. L-VAI-41 — có "Bảng lương tháng" mà không có "Xem cấu hình lương": **thấy số, ô không bấm được** (đề nghị, không đổi quyền) / mở ngăn soi.
20. L-SX-39 — giá mua giấy + bậc khoán công đoạn có phải giá vốn cần ô Xem giá: **có — thêm ô Xem giá ở hai danh mục, cấp sẵn cho vai đang sửa được** (đề nghị theo luật "tiền chỉ người có quyền xem", nhưng là mục đổi nhiều nhất: cần migration dữ liệu quyền và rà màn Tính giá) / không, để như cũ.

Kinh doanh / kế toán
21. L-VAI-02 — trợ lý kinh doanh thấy khách: **đưa trợ lý vào nhóm dùng chung với từng sale** (đề nghị, không sửa code) / đổi vai sang Cả phòng.
22. L-VAI-43 — sale "Của tôi" gán khách cho người cùng nhóm: **chỉ lọc được, không gán** (đề nghị) / gán được.
23. L-VAI-27 — markup >999,99 %: **chặn, báo gõ nhầm** (đề nghị) / nới cột (migration).
24. L-VAI-38 — làm tròn tiền cọc: **giữ như hiện nay** (đề nghị) / nửa lên.
25. L-VAI-29 — cột "Người lập" ở danh sách báo giá: **đổi nhãn thành "NV phụ trách"** (đề nghị) / hiện người bấm tạo.
26. L-VAI-31 — kết quả duyệt báo giá: **chỉ báo sale phụ trách như nay** (đề nghị) / báo cả người lập.
27. L-VAI-35 — huỷ phiếu thu của hoá đơn đã chi CK / kê: **chặn, bắt huỷ phiếu chi CK trước** (đề nghị, chép đúng luật huỷ hoá đơn) / cảnh báo rồi cho huỷ.
28. L-VAI-40 — hoa hồng trên cọc của đơn huỷ: **bỏ khoản của đơn đã huỷ** (đề nghị, một điều kiện) / chỉ trừ phần đã trả lại khách (cọc bị giữ vẫn tính).
29. L-VAI-18 — ô "In phiếu": **chỉ là nút giao diện, đổi nhãn ô** (đề nghị) / giấu nội dung, tách endpoint bản in.
30. L-SX-49 — chi CK / kê trả khách có thuộc sổ phải thu (kỳ công nợ đã khoá thì chặn) không: **có, xét theo ngày phiếu chi** (đề nghị, sửa một hàm xếp phân hệ) / có, xét theo ngày hoá đơn / không.

Kỳ đã chốt
31. L-SX-48 — phiếu thu lùi ngày vào tháng có kỳ lương (hoa hồng) đã chốt: **chặn, bảo mở kỳ lương** (đề nghị, cùng kiểu kỳ công nợ) / chỉ cảnh báo / đẩy khoản hoa hồng sang kỳ mở kế tiếp.
32. L-SX-44 — cho nghỉ việc (`resign`) và điều chuyển lùi ngày vào kỳ lương đã chốt: **cho nghỉ việc vẫn được (giấy nghỉ hay về muộn), điều chuyển thì chặn** (đề nghị) / chặn cả hai.

## 4. Rủi ro chung khi vá

- Đợt 2 và Đợt 7 đổi hành vi API (chặn thêm): grep người gọi trước, test cũ đang đi đường bị chặn phải sửa theo.
- L-SX-23 / L-SX-22 (khoá dòng) SQLite bỏ qua `FOR UPDATE`: pytest chỉ thử được nối tiếp, ca đồng thời phải bấm lại trên Postgres.
- Đợt 6 đụng tiền khoán: mỗi lỗi có test số tiền trước / sau; chạy lại ngăn soi + sổ Khoán theo tổ trên DB dev.
- L-VAI-13 (KCS): đo thời gian trước / sau trên cùng DB dev; giữ thứ tự dòng.

- L-SX-45 xoá dòng lương: chỉ xoá người thuộc phạm vi người bấm và không có gì `co_dong` giữ; test cả ca có sửa tay.
- L-SX-48: chặn cứng làm kế toán không ghi được tiền về lùi ngày khi kỳ lương đã chốt — phải mở kỳ, đúng ý chặn.

## 5. Phân công thực hiện (hai phiên song song, chia theo FILE để không đụng nhau)

Mỗi phiên một worktree, một nhánh tách từ dev; điều phối review rồi merge về dev.

Nền chung (phiên A làm commit ĐẦU TIÊN, phiên B cherry-pick về trước khi đụng tới):
`services/ky_luong_guard.py` (hàm kiểm kỳ lương) + `services/dinh_dang.py` (dời `so_vn`, `luoi_vat_tu` import lại).

Phiên A — nhánh `fix/e2e-2510-a` (sản xuất, lương, khoán):
- Đợt 1 trừ L-VAI-28, 33. Đợt 2 trọn (gồm L-VAI-10).
- Đợt 4: nền + L-SX-43, 47, 22, 23, 24.
- Đợt 5 trừ L-SX-46 (gồm L-VAI-24, 25, 41). Đợt 6 trọn.
- Đợt 9 trọn (gồm L-VAI-13, 45, 46, 11, 47).
- Đợt 10: L-SX-12, 16 (XlNgan, board.py).
- Đợt 11: L-SX-02, 01, 39, 38 (phần ghi nhật ký ở `employee_service` để phiên B).

Phiên B — nhánh `fix/e2e-2510-b` (nhân sự, kinh doanh, kế toán, kho):
- Đợt 1: L-VAI-28, 33. Đợt 3 trọn (gồm L-SX-28; L-SX-44 sau khi cherry-pick nền; chữ nhật ký chuyển trạng thái của L-SX-38).
- Đợt 4: L-SX-48, 49. Đợt 5: L-SX-46. Đợt 7, Đợt 8 trọn.
- Đợt 10: L-SX-11, 15, 14, 07.
- Đợt 11: L-VAI-49, 21, 44, 18 + middleware lỗi 500 trong CORS (`main.py`).

File chung hai bên đều thêm dòng (dễ đụng khi merge, điều phối tự gỡ): `frontend/src/api/client.ts`,
`frontend/src/lib/suKienNhom.ts`, `backend/app/audit_registry.py`.

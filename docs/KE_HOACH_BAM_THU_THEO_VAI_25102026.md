# Kế hoạch bấm thử end-to-end theo từng vai — phân quyền và phạm vi (25/10/2026)

Tài liệu này kiểm hệ thống từ chỗ ngồi của từng người dùng. Mỗi vai được hỏi bốn câu:
1. Thanh bên của vai có đúng các màn được cấp không?
2. Vai có làm trọn được phần việc của mình trong luồng không?
3. Vai có thấy hoặc làm được việc ngoài phạm vi không, kể cả gõ thẳng URL, gọi API, xuất Excel, xem badge
   hay nhận thông báo?
4. Thông báo tức thời có tới đúng người nhận không, và chuyện gì xảy ra khi không ai đủ quyền nhận?

Logic nghiệp vụ (tính giá, khoán, giấy…) đã nằm ở `KE_HOACH_BAM_THU_E2E_25102026.md`, ở đây không lặp lại.

Nguồn: ma trận quyền thật trên DB dev `svn_erp_trong` (66 vai), cộng kết quả đọc code dev tại `05768728`.
Câu báo trong ngoặc kép chép từ code. Cột "Code" ghi tên file và dòng, tìm bằng tên file.

Cột "Loại":
- **C** = vai phải làm được.
- **R** = ranh giới phạm vi, kiểm xem đúng chỗ dừng.
- **X** = phải bị chặn.

Ca "gọi API" chỉ dùng để chứng minh máy chủ chặn khi giao diện đã ẩn nút; phải ghi rõ là đi tắt. Ca có ghi
"(NL-…)" là chỗ đọc code nghi đang lọt, chi tiết ở mục 7.

Chủ đã chốt KHÔNG kiểm bốn chỗ sau, vì người được cấp các quyền quản trị này được tin cậy:
- Đặt lại mật khẩu (kể cả của Giám đốc).
- Sửa ma trận quyền, nhân bản vai.
- Gán vai trò, kể cả tự gán hoặc tự chuyển phòng rồi tự gán.
- Tự sửa cho chính mình: dòng lương, mức lương, số TK, chấm bù.

---

## 0. Cách chạy

### Môi trường
- Bản sao DB `svn_erp_vai`, chép từ `svn_erp_trong`, có Redis riêng, backend 8010, frontend 5174, `SEED_DEMO=false`.
- Không đụng DB dev.
- Tối đa 5 trình duyệt cùng lúc. Mỗi đợt mở 2–4 vai cạnh nhau để nhìn thông báo đi từ vai này sang vai kia.
- Thao tác bằng chuột và phím thật. Ghi theo mã ca: Đạt / Lỗi / Không làm được trên giao diện.

### Dựng tổ chức thử
Dựng trên bản sao, qua màn Phòng ban và Hồ sơ nhân sự, bằng tài khoản Giám đốc:
- Tạo phòng con **"E2E KD nhóm 1"** dưới Phòng Kinh Doanh, rồi nhân bản vai "sale" sang phòng đó.
  Phòng con này dùng để kiểm "Cả phòng" có tính cả cây con không.
- Mỗi persona dưới đây có một hồ sơ nhân viên tiền tố `E2E` kèm tài khoản, đặt đúng phòng, gán đúng vai đang có.
- Vai chưa ai giữ thì vẫn gán thử để kiểm, vì đây là các vai sẽ có người dùng thật khi lên prod.

### Persona

| Mã | Persona | Vai | Phòng / tổ | Ghi chú phạm vi đang cấp trên dev |
|---|---|---|---|---|
| P01 | E2E Giám đốc | Giám đốc | Ban giám đốc | Tất cả mọi màn, 26 tổ đủ ba quyền |
| P02 | E2E TP Kinh doanh | Trưởng phòng kinh doanh | Phòng Kinh Doanh | Báo giá, Đơn bán "Cả phòng"; duyệt đặc thù |
| P03 | E2E Sale A | sale | Phòng Kinh Doanh | "Của tôi" |
| P04 | E2E Sale B | sale | Phòng Kinh Doanh | "Của tôi" |
| P05 | E2E Sale C | sale (bản nhân bản) | E2E KD nhóm 1 | "Của tôi" |
| P06 | E2E Trợ lý KD | Trợ lý kinh doanh | Phòng Kinh Doanh | Tính giá, Báo giá, Đơn, Kế hoạch SX, Xếp lịch, 6 danh mục |
| P07 | E2E Kế hoạch | kế hoạch | Phòng kỹ thuật | Kế hoạch SX, Kế hoạch vật tư, Xếp lịch |
| P08 | E2E KCS trưởng | KCS trưởng | Thành phẩm / KCS | Như kế hoạch + bàn tổ Thành phẩm / KCS; KHÔNG có màn KCS |
| P09 | E2E Thủ kho | Tổ trưởng cắt - thu mua - thủ kho | Cắt (nhóm cha) | Kho "Tất cả", Mua hàng, NCC; bàn tổ Thực hiện + Xác nhận |
| P10 | E2E TT Dán | Tổ trưởng SX - Dán | Dán (nhóm cha) | 30 tổ "Cả phòng", Thực hiện + Xác nhận |
| P11 | E2E TT Dán nhóm 1 | Tổ trưởng SX - Dán - nhóm 1 | Dán - nhóm 1 (lá) | như trên |
| P12 | E2E TT Bế | Tổ trưởng SX - Tổ bế | Tổ bế (nhóm cha) | như trên |
| P13 | E2E Thợ In 4 màu | Thợ SX - Nhóm thợ in máy 4 màu | Nhóm thợ in máy 4 màu | 30 tổ "Cả phòng", chỉ Thực hiện lệnh. Tổ In không có tổ trưởng nào |
| P14 | E2E Thợ Dán nhóm 1 | Thợ SX - Dán - nhóm 1 | Dán - nhóm 1 | như trên |
| P15 | E2E Thợ TP thử việc | Thợ SX - Thành phẩm - thử việc | Thành phẩm - thử việc | chỉ tổ của mình |
| P16 | E2E NV cán màng | nhân viên tổ cán màng | Tổ Cán màng | tổ 16 đủ ba quyền, "Của tôi"; không có Trang chủ |
| P17 | E2E Tài xế / E2E Phụ xe | Nhân viên giao hàng | Giao hàng | Giao hàng "Của tôi" |
| P18 | E2E HCNS | admin | Phòng HCNS | Nhân sự, Chấm công, Nghỉ phép, Tăng ca, Lương "Tất cả" |
| P19 | E2E KT trưởng | kế toán trưởng | Kế toán | Đơn mua hàng: Xem + Duyệt, phạm vi đang lưu "Của tôi" (NL-KT01) |
| P20 | E2E KT bán hàng | Kế toán bán hàng | Kế toán | chưa ai giữ: Phiếu thu, Phiếu chi, xem Đơn |
| P21 | E2E KT tổng hợp | Kế toán tổng hợp | Kế toán | chưa ai giữ: Phiếu thu/chi, TK ngân hàng, Tài sản, xem công nợ |
| P22 | E2E KT kho | Kế toán kho | Kế toán | chưa ai giữ: xem Kho, Báo cáo kho |
| P23 | E2E QL giao hàng | Quản lý giao hàng | Giao hàng | chưa ai giữ |
| P24 | E2E Thợ sửa chữa | Thợ sửa chữa | Sản xuất | chưa ai giữ: Sửa chữa máy, Phiếu bảo trì |
| P25 | E2E QC | QC | Sản xuất | chưa ai giữ |
| P26 | E2E Chưa có vai | (không vai) | Phòng HCNS | `role_id` rỗng |
| P27 | E2E Không phòng | sale | (không phòng) | phạm vi "Cả phòng" tự lùi về "Của tôi" |

---

## 1. Luật phạm vi đọc được từ code

Một chữ "Cả phòng" mang ba nghĩa khác nhau tuỳ màn. Đây là nguồn lệch dễ gặp nhất khi test.

| Màn | "Của tôi" là | "Cả phòng" là | Ghi chú |
|---|---|---|---|
| Khách hàng, Tính giá, Báo giá, Đơn bán, Báo cáo kinh doanh | Chủ = sale đang phụ trách KHÁCH, đọc lúc truy vấn (chưa có khách thì người lập); gồm cả nhóm dùng chung | Chủ ngồi ở phòng mình **và cây con** | Đổi người phụ trách khách thì mọi chứng từ của khách đi theo ngay |
| Giao hàng | Yêu cầu mình lập, hoặc chuyến mình chở | Phòng của người lập **lúc lập**, đúng một phòng | Tab chuyến với "Của tôi" chỉ lọc theo tài xế (NL-GH01) |
| Yêu cầu mua hàng | Mình lập (ở danh sách) | Đúng phòng đề nghị, không cây con | Mở theo mã chỉ kiểm phòng (NL-MH01) |
| Đơn mua hàng (`ke_toan`) | Mình lập | Người lập cùng đúng phòng | Giao diện hiện khoá "Tất cả" nhưng máy chủ đọc giá trị lưu thật (NL-KT01) |
| Mua hàng, Phiếu thu, Phiếu chi, TK ngân hàng, Tài sản, Quy trình KD, Báo cáo kho, Báo cáo thu chi, Xếp lịch, Kế hoạch vật tư, KCS, Sửa chữa máy, Phiếu bảo trì, mọi danh mục | Máy chủ ép "Tất cả" khi lưu | | |
| Công nợ phải thu / phải trả, Báo cáo công nợ | Máy chủ không đọc phạm vi | | Ai được cấp đều thấy mọi khách / NCC |
| Kế hoạch SX, Hồ sơ lệnh, Theo dõi SX | Đơn của mình, theo chủ đơn (sale phụ trách) | Chủ đơn ở phòng mình + cây con | Người xưởng chọn "Cả phòng" gần như không thấy lệnh nào, vì sale không ngồi ở xưởng |
| Bàn tổ `to_sx_<tổ>` | Việc mình có phân công đang hiệu lực | Ngồi TẠI hoặc TRÊN tổ đó thì thấy cả vùng. Ngồi DƯỚI thì thấy cây con của mình. Ngồi nhánh khác thì không thấy gì | Vai có 30 dòng tổ chỉ thấy tổ mình ngồi và tổ con của nó |
| Kho (Yêu cầu nhập xuất) | Yêu cầu mình tạo | Mình tạo, hoặc tổ/phòng đứng tên yêu cầu thuộc cây con phòng mình | Yêu cầu tự lập từ bàn tổ đứng tên TỔ của công đoạn |
| Nhân sự, Chấm công, Nghỉ phép, Tăng ca, Đi muộn, Lương | Hồ sơ gắn tài khoản mình | Phòng mình + cây con, theo phòng HIỆN TẠI của nhân viên | Không có "phòng tại kỳ": chuyển tổ giữa tháng thì dòng tháng cũ đổi người quản lý |
| Nhật ký | Máy chủ ép "Tất cả", chỉ che dòng theo màn đọc được | | |

Thêm bốn luật chung:
- **Ô chi tiết tự bật Xem.** Bật bất kỳ ô chi tiết nào thì máy chủ tự bật luôn Xem của màn đó.
- **Ô luôn có cho mọi vai:** Xem Lương; Xem + Thao tác ở Chấm công, Nghỉ phép, Tăng ca. Người chưa có vai thì không có ô nào.
- **Chuyển phòng nhân viên thì vai bị gỡ** (`role_id` rỗng). Vai chỉ gán được cho người cùng phòng với vai.
- **Thiếu quyền:** gọi API sẽ ra 403 "Bạn không có quyền thực hiện thao tác này". Bản ghi ngoài phạm vi đa số trả 404 để không lộ là có bản ghi.

## 2. Ai nhận thông báo tức thời

| Sự kiện | Người nhận theo code | Trên DB dev thực tế là ai |
|---|---|---|
| Báo giá chờ duyệt "🔔 Báo giá X chờ bạn duyệt" | Người có Duyệt đặc thù, lọc theo phòng của NGƯỜI SOẠN lúc trình | P02 (nếu người soạn ở Phòng KD hoặc cây con), P01 |
| Kết quả duyệt "✓ … đã được duyệt" / "✕ … bị từ chối" | Chỉ người soạn, không phải sale chủ khách | |
| Đơn chờ cọc "🔔 Đơn hàng X chờ ghi cọc" | Người có Phiếu thu Thêm + Xem đơn, theo phòng sale đứng tên | Chỉ P01; vai kế toán chưa ai giữ |
| Đủ cọc "🔔 Đơn X đã đủ cọc — chuyển xuống sản xuất được rồi" | `sale_user_id` chụp lúc tạo đơn | Sale cũ nếu đã đổi người phụ trách (NL-BH05) |
| Hoá đơn chờ thu / thu đủ chờ chi CK-kê | Phiếu thu hoặc Phiếu chi Thêm, không lọc phòng | Chỉ P01 |
| Yêu cầu mua mới | Mọi người đọc Mua hàng, không xét phạm vi | P09, P01 |
| Đơn mua chờ duyệt "Có đơn mua hàng X chờ xử lý" | Mọi người đọc Đơn mua hàng, không cần ô Duyệt | P19, P01 |
| Phát hành: yêu cầu xuất mới | "Người kho" (Kho Thêm, hoặc Xem mà không Đề nghị) có phạm vi phủ tổ đứng tên | P09, P01 |
| Đề xuất giao / KCS báo lỗi | Người có Xác nhận sản lượng TRỌN tổ nhận, trừ người bấm | Tổ In không có tổ trưởng nên chỉ P01 nhận |
| Giao việc | Thợ được giao; phát hành tự giao cả tổ thì KHÔNG báo từng thợ | |
| Báo máy hỏng | Mọi tài khoản đang hoạt động có Sửa chữa máy Sửa, không xét phòng | Chỉ P01 |
| Đơn nghỉ / tăng ca / đi muộn mới (chấm đỏ) | Người duyệt có phạm vi phủ phòng NV; người duyệt "Của tôi" không bao giờ có chấm | |
| Yêu cầu cập nhật hồ sơ, Chốt kỳ lương | Không có báo nào | |
| Đổi quyền / đổi vai | Người giữ vai nhận `quyen_doi`, menu nạp lại | Sửa cây phòng ban KHÔNG bắn sự kiện (NL-HT04) |

---

## 3. Mọi vai — đăng nhập, phiên, đổi quyền

| Mã | Loại | Persona | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|---|
| CH01 | C | P01–P25 | Thanh bên đúng ma trận | Đăng nhập từng persona, chụp thanh bên | Đúng các mục của mục 6, không thừa không thiếu | Sidebar.tsx |
| CH02 | X | Bất kỳ | Gõ URL màn không được cấp | Gõ đường dẫn màn khác | Không vào được; API 403 "Bạn không có quyền thực hiện thao tác này" | deps.py:666 |
| CH03 | R | P03 tab đang mở | GĐ đổi vai P03 | P01 Gán vai trò | P03 nhận `quyen_doi`, menu nạp lại không cần F5 | user_admin_service.py:145 |
| CH04 | R | P11 tab đang mở | GĐ bỏ tick một ô trong ma trận vai | Sửa ma trận phân quyền | Người giữ vai bị chặn ngay ở request kế tiếp; panel tự rút | role_service.py:535 |
| CH05 | R | P13 tab đang mở | Sửa cây phòng ban (đổi cấp trên tổ) | Phòng ban → Đổi cấp trên | Menu và kênh tổ phải cập nhật. Code nghi giữ cũ tới khi F5 (NL-HT04) | department_service.py:93 |
| CH06 | X | P04 tab đang mở | Bị khoá tài khoản | P18 Khoá | Request kế tiếp: 403 "Tài khoản đã bị khóa". Kiểm kênh SSE còn nhận tin không (NL-HT05) | deps.py:143 |
| CH07 | X | P04 | Bị thu hồi phiên | Thu hồi mọi phiên | 401, bị đăng xuất | deps.py:140 |
| CH08 | X | P14 | Bị cho nghỉ việc | P18 Đổi trạng thái → Nghỉ việc | Phiên chết; đăng nhập lại: "Tên đăng nhập hoặc mật khẩu không đúng" | employee_service.py:924 |
| CH09 | R | P14 | Tuyển lại người từng bị khoá tay | Khoá → cho nghỉ → Tuyển lại | Không được tự mở khoá. Code nghi tự mở (NL-HT07) | employee_service.py:934 |
| CH10 | R | P26 | Người chưa có vai | Đăng nhập | Menu gần như trống, không có "Hồ sơ của tôi"; gửi đơn nghỉ bị 403. Cần chủ chốt có muốn vậy không | rbac_service.py:217 |
| CH11 | R | P27 | Người không có phòng, phạm vi "Cả phòng" | Mở Khách hàng, Tính giá | Chỉ thấy của mình | customer_repo.py:115 |
| CH12 | C | Mọi vai | Hồ sơ của tôi | Đổi tên hiển thị | "Tên hiển thị lấy từ hồ sơ nhân sự — nhờ HCNS cập nhật." | profile_service.py:64 |
| CH13 | C | Mọi vai | Phiếu lương kỳ chưa công bố | Tab Phiếu lương, đổi tháng trên URL | Rỗng, không lộ số | payroll.py:1320 |
| CH14 | R | P13 | Người khác xin tạm ứng | Mở DevTools → SSE | Không được nhận tên người xin. Code nghi gửi kèm `code` (NL-HT10) | payroll.py:390 |
| CH15 | R | Mọi vai | Xem Nhật ký nếu có | Nhật ký | Không lộ số tiền lương/tạm ứng của người khác (NL-HT03) | activity_service.py:84 |

---

## 4. Theo từng vai

### 4.1 P01 Giám đốc

Vai duy nhất đang làm được KCS, thu chi, công nợ, sửa chữa máy và nhận mọi toast "không ai khác nhận".

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| GD01 | C | Thấy mọi tổ, mọi nhóm | Thanh bên Tổ sản xuất | Cây đủ nhóm cha → tổ lá | quyen_to.py:198 |
| GD02 | C | Duyệt báo giá mọi phòng | P05 trình → P01 Duyệt | Có toast; P05 nhận "✓ Báo giá X đã được duyệt" | quotations.py:733 |
| GD03 | C | KCS cả chuỗi (vai duy nhất có màn KCS) | KCS → kiểm → gửi nhập kho → đóng lệnh | Chạy trọn; nếu không có P01 thì chuỗi tắc ở KCS | kcs.py:92 |
| GD04 | C | Nhận báo máy hỏng (không ai giữ Thợ sửa chữa) | P11 báo máy hư | Chỉ P01 nhận "⚠️ ‹máy› đang dừng vì hỏng" | ky_thuat_may_service.py:465 |
| GD05 | C | Thu cọc, hoá đơn, chi CK/kê | Luồng kế toán | Chỉ P01 nhận mọi toast hàng chờ | ban_hang_cho_thu_chi.py:145 |
| GD06 | R | Tự duyệt đơn nghỉ của mình (phạm vi Tất cả) | Nghỉ phép → Duyệt | Cho phép (đúng thiết kế) | leave_service.py:430 |
| GD07 | R | Tự duyệt đơn mua mình lập | Duyệt | Cho phép | purchase_service.py:3081 |
| GD08 | C | Xoá vai còn người giữ | Xóa vai | 409 "Không thể xóa: còn N người dùng đang giữ vai trò này. Hãy chuyển họ sang vai trò khác trước." | role_service.py:36 |
| GD09 | R | Xoá cưỡng chế vai còn người | Xóa vai (force) | Mọi người giữ vai về "chưa có vai"; nhật ký có dòng | role_service.py:274 |
| GD10 | C | Đổi người phụ trách khách | Khách hàng → Điều chuyển A→B | Phiếu tính giá, báo giá, đơn biến khỏi P03, hiện ở P04 ngay | org_scope.py:73 |

### 4.2 P02 Trưởng phòng kinh doanh

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| TP01 | C | Thấy báo giá, đơn của cả phòng và phòng con | Báo giá, Đơn hàng bán | Có của P03, P04, P05 (P05 ở phòng con) | org_scope.py:24 |
| TP02 | C | Duyệt báo giá của sale trong phòng | P03 "Trình duyệt" → P02 nhập lý do → Duyệt | P02 có chấm đỏ + toast; P03 nhận "✓ …" | quotations.py:733,768 |
| TP03 | X | Duyệt báo giá có chủ khách ở phòng khác | Gọi API approval | 404 "Không tìm thấy báo giá." | quotation_service.py:1080 |
| TP04 | R | Trợ lý (phòng khác) soạn báo giá cho khách của P03 | Trình duyệt | Badge của P02 tăng nhưng không có chấm đỏ hay toast; kết quả về người soạn, P03 không nhận (NL-BH03) | quotations.py:735 |
| TP05 | R | Điều chuyển khách sang P05 (phòng con) | Tick khách → Điều chuyển | 400 "Nhân viên đích phải thuộc phòng của bạn." dù P02 có thấy khách phòng con (NL-BH02) | customers.py:420 |
| TP06 | R | Sale chuyển phòng sau khi trình | P18 điều chuyển P03 | Chấm đỏ ở lại phòng cũ, badge theo phòng mới; P02 mất chứng từ của P03 | quotations.py:735 |
| TP07 | X | Báo cáo kinh doanh | Gõ URL | Vai không có màn này: 403. Cần chủ chốt TP có cần màn này không | |
| TP08 | R | Bị tắt Duyệt đặc thù khi đang mở báo giá | P01 sửa ma trận | Panel duyệt tự rút; bấm thì 403 | role_service.py:535 |
| TP09 | R | Báo giá trả giá vốn | DevTools xem JSON báo giá | Có `total_cost`, `margin`. Cần chủ chốt vai KD có được thấy không (NL-BH06) | quotations.py:323 |

### 4.3 P03/P04/P05 Sale ("Của tôi")

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| SA01 | C | Danh bạ chỉ khách của mình và nhóm dùng chung | Khách hàng | P03 không thấy khách P04 | customer_repo.py:110 |
| SA02 | X | URL khách của P04 | Gõ id khách P04 | 404 "Không tìm thấy khách hàng." | customers.py:1685 |
| SA03 | X | Xuất Excel danh bạ | Xuất Excel | Chỉ khách trong phạm vi | customers.py:657 |
| SA04 | R | Nhóm dùng chung: ô lọc NV phụ trách | Mở ô lọc | Phải có tên bạn cùng nhóm. Code nghi thiếu (NL-BH09) | customers.py:352 |
| SA05 | R | Kiểm trùng MST khách của người khác | Gõ MST đã có | Cảnh báo có mã + tên khách ngoài phạm vi. Cần chủ chốt | customers.py:472 |
| SA06 | X | Đổi Sale phụ trách qua form Sửa (vai có ô Điều chuyển nhưng "Của tôi") | Sửa → Sale → Lưu | Phải chặn như ở nút Điều chuyển ("Bạn không có quyền điều chuyển khách hàng."). Code nghi cho qua (NL-BH02) | customer_service.py:469 |
| SA07 | X | Sửa chính sách tài chính | Ô chính sách | 403 "Bạn không có quyền thiết lập chính sách tài chính khách hàng." | customers.py:1110 |
| SA08 | R | Tạo khách gán sale khác qua API | POST khách với sale khác | Hiện tạo được, khách biến khỏi danh bạ người tạo. Cần chủ chốt | customer_service.py:314 |
| SA09 | X | Phiếu tính giá chọn khách ngoài phạm vi | Chọn khách | 403 "Khách hàng này không nằm trong phạm vi bạn được xem." | ptg_khach_hang_service.py:49 |
| SA10 | X | Thiếu "Xem chi tiết giá vốn" (sale chỉ Xem tính giá) | Mở phiếu tính giá | Chỉ tổng và 3 rổ; JSON không có dòng diễn giải. Gợi ý tái bản: 403 | phieu_tinh_gia.py:656 |
| SA11 | X | Tái bản với khách của P04 | Gọi `/san-pham-tai-ban?customer_id=` khách P04 | Phải 404. Code nghi trả thành phẩm (NL-BH07) | phieu_tinh_gia.py:611 |
| SA12 | R | Trợ lý lập phiếu tính giá cho khách P03 | P03 bấm "Lập báo giá" | Phải tạo được. Code nghi 404 "Không tìm thấy phiếu tính giá." (NL-BH01) | quotations.py:575 |
| SA13 | X | PDF báo giá của P04 | Gọi URL PDF | 404 "Không tìm thấy báo giá." | quotations.py:848 |
| SA14 | X | Tạo đơn từ báo giá đã chốt của P04 | Gọi POST đơn với báo giá P04 | Phải 404. Code nghi tạo được (NL-BH04) | order_service.py:592 |
| SA15 | X | URL đơn của P04 | Gõ id | 404 "Không tìm thấy đơn hàng" | order_service.py:539 |
| SA16 | R | Sửa tham số lọc thành "Tất cả" | `view_scope=all` trên URL | Máy chủ kẹp về "Của tôi" | orders.py:79 |
| SA17 | X | Thu cọc / huỷ hoá đơn | Ngăn đơn | Nút ẩn; API 403 | DonHangBanPage.tsx:165,576 |
| SA18 | R | Mã báo giá của phiếu tính giá người khác | `/quotations/by-phieu/{id}` | Nên 404. Code nghi trả mã (NL-BH10) | quotations.py:601 |
| SA19 | R | SSE hoá đơn | DevTools → SSE | Không được nhận mã đơn ngoài phạm vi (NL-BH10) | accounting.py:150 |
| SA20 | R | Yêu cầu giao do trợ lý lập cho đơn của P03 | Ngăn đơn → Giao hàng | Hiện không thấy. Cần chủ chốt | delivery.py:592 |
| SA21 | R | P05 ở phòng con | P02 mở Báo giá | P02 thấy báo giá của P05 | org_scope.py:24 |
| SA22 | R | Sale nghỉ việc | P18 cho nghỉ P04 | Khách vẫn gắn P04 tới khi chạy "Điều chuyển theo nhân viên nguồn" | customers.py:437 |

### 4.4 P06 Trợ lý kinh doanh

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| TL01 | C | Soạn báo giá cho khách của sale | Tính giá → Báo giá | Đơn đứng tên chủ khách, không phải trợ lý | order_service.py:663 |
| TL02 | R | Kết quả duyệt | P02 duyệt báo giá trợ lý soạn | Toast về P06, P03 không nhận (NL-BH03) | quotations.py:769 |
| TL03 | C | Sửa 6 danh mục | Giấy, Công đoạn… → Lưu | Lưu được; phạm vi danh mục ép Tất cả | role_service.py:464 |
| TL04 | R | Khách hàng chỉ Xem | Bấm Sửa khách | Nút ẩn; API 403 | |
| TL05 | C | Xếp lịch, Kế hoạch SX (vai KD có quyền sản xuất) | Mở Xếp lịch → Phát hành | Phát hành chỉ khi có ô "Phát hành lịch". Cần chủ xem lại vai này có nên xếp lịch không | xep_lich.py:266 |

### 4.5 P07 Kế hoạch, P08 KCS trưởng

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| KH01 | C | Phát hành | Xếp lịch → "Phát hành" | Thủ kho P09 nhận "Yêu cầu xuất mới chờ cấp"; chấm đỏ kênh tổ | vat_tu_tu_lap.py:175 |
| KH02 | R | Xếp lịch thấy mọi lệnh, Kế hoạch SX thì không | Phát hành lệnh của khách phòng khác → mở Kế hoạch SX lệnh đó | Phát hành được, nhưng GET lệnh: 404 "Không tìm thấy lệnh sản xuất" (NL-SX01) | xep_lich.py:110; lsx.py:137 |
| KH03 | X | Hồ sơ lệnh của sale phòng khác | Mở Hồ sơ lệnh | 403 "Lệnh sản xuất ngoài phạm vi của bạn" | lenh_sx/pham_vi.py:87 |
| KH04 | R | Kế hoạch SX "Của tôi" | Mở Kế hoạch SX | Người xưởng không phải chủ đơn nên gần như trống. Cần chủ chốt phạm vi đúng cho vai kế hoạch | lenh_sx/pham_vi.py:31 |
| KH05 | X | Thiếu "Phát hành lịch" | Phát hành | 403 câu chung | xep_lich.py:266 |
| KH06 | X | Thiếu "Đóng lệnh thiếu" | "Đóng lệnh" khi còn việc chưa xong | 403 "… để đóng khi còn việc chưa xong." | dong_lenh.py:137 |
| KC01 | X | P08 vào màn KCS | Gõ URL KCS | 403 "Bạn không có quyền xem KCS." | kcs.py:87 |
| KC02 | X | P08 ghi lần kiểm | Gọi API kiểm | 403 "Bạn không có quyền thao tác KCS." | kcs.py:92 |
| KC03 | R | P08 xem báo cáo KCS qua quyền tổ | Báo cáo KCS | Chỉ số liệu tổ Thành phẩm / KCS; Xuất Excel 403 | kcs_bao_cao.py:89 |
| KC04 | C | P08 ở bàn tổ Thành phẩm / KCS | Giao việc, ghi, xác nhận, lĩnh vật tư | Làm được (vai có đủ ba quyền ở tổ này) | |
| KC05 | R | P08 sửa Xếp lịch | Kéo lệnh | Làm được. Cần chủ xem lại: KCS trưởng có nên xếp lịch không | |

### 4.6 P09 Tổ trưởng cắt - thu mua - thủ kho

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| TK01 | C | Nhận yêu cầu xuất khi phát hành | P07 phát hành | Một chuông + toast "🔔 LSX…: N yêu cầu xuất mới chờ lập phiếu" | vat_tu_tu_lap.py:163 |
| TK02 | C | Lập phiếu, ghi sổ | Yêu cầu nhập xuất → Lập phiếu xuất → ghi sổ | Bàn tổ của tổ xin tự đổi chip | |
| TK03 | R | Hộp yêu cầu gồm mọi kho | Mở "Phiếu từ yêu cầu" | Thấy và lập phiếu được ở mọi kho, kể cả kho không có dòng `ton_kho_` (NL-KHO03) | kho_request.py:446 |
| TK04 | C | Nhận yêu cầu mua mới | P11 gửi Yêu cầu mua | "Có yêu cầu mua hàng X mới từ phòng ban" | purchases.py:357 |
| TK05 | C | Lập phiếu mua → gửi duyệt | Mua hàng | P19 và P01 nhận "Có đơn mua hàng X chờ xử lý" | purchases.py:851 |
| TK06 | R | P19 không thấy đơn của P09 | P19 mở Đơn mua hàng | Phải thấy để duyệt. Trên dev, P19 lưu phạm vi "Của tôi" nên hộp trống và duyệt ra 404 (NL-KT01) | purchase_service.py:2474 |
| TK07 | X | Huỷ phiếu đã gửi duyệt | Huỷ phiếu | Nút ẩn; API "Chi huy duoc phieu nhap do chinh minh lap. Phieu da gui duyet thi nguoi duyet quyet." | purchase_service.py:4098 |
| TK08 | C | Ghi đợt giao (có kho Đề nghị) | Ghi đợt giao → Lưu | Tự tạo yêu cầu nhập; chính P09 nhận tin kho | |
| TK09 | R | Bàn tổ: chỉ nhóm Cắt | Thanh bên Tổ sản xuất | Xả cuộn 1, 2, Cắt 1, 2 (P09 ngồi ở nhóm Cắt); không thấy tổ In, Dán | quyen_to.py:202 |
| TK10 | R | Badge đợt quá hạn | Thanh bên Thu mua | = 0 vì không có Xem Đơn mua hàng | purchase_service.py:2571 |
| TK11 | C | Khoá kỳ kho | Báo cáo kho → Khóa kỳ | Cần "Khóa kỳ + tính giá kỳ"; P09 có Báo cáo kho Thao tác. Kiểm có ô này không | kho_baocao.py:78 |

### 4.7 P10/P11/P12 Tổ trưởng SX

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| TT01 | C | P11 (tổ lá) thấy đúng 1 bàn | Thanh bên | Chỉ "Dán - nhóm 1", không có nhóm cha | quyen_to.py:202,267 |
| TT02 | R | P10 ngồi ở nhóm Dán | Thanh bên | Nhóm Dán + 8 tổ con (nhóm 1–4, 6, Gỡ hàng, Cột dây, thử việc). Bấm vào nhóm: không có bàn | quyen_to.py:205,252 |
| TT03 | R | P10 nhận toast đề xuất giao của mọi tổ con | Tổ con bấm "Đề xuất giao" | Có toast | quyen_to.py:413 |
| TT04 | X | P11 gõ URL bàn tổ In | `team_id`=tổ In | 403 "Ngoài phạm vi tổ được phép xem." | board.py:57 |
| TT05 | X | P11 bắt đầu việc tổ In qua API | Gọi bat-dau | 403 "Bạn không có quyền Thực hiện lệnh ở tổ này" | thuc_thi.py:76 |
| TT06 | X | Lĩnh vật tư (không vai tổ trưởng nào có ô Kho) | "Đề nghị vật tư" | Nút ẩn; API 403. Hệ quả: tổ không sửa được số xin của yêu cầu tự lập, không nhập lại vật tư thừa | ThsxExecPanels.tsx:167; san_xuat.py:644 |
| TT07 | C | Sửa số, xác nhận nhận bàn giao, "Đã xem" lỗi KCS | Các nút tương ứng | Làm được ở tổ mình | |
| TT08 | X | Báo máy hư (không có Báo máy hỏng) | "Báo dừng máy" → Máy hư | Hộp chỉ có phần lương; API 403 "Bạn không có quyền Báo hỏng (Sửa chữa máy) ở tổ này" | dung_may.py:118 |
| TT09 | C | Báo dừng máy chỉ tính lương | "Báo dừng máy" → ngày đã qua | Lưu được | |
| TT10 | X | Báo dừng máy ở nhóm cha | Gọi API với id nhóm Dán | 400 "Đây là tổ cha (chỉ là nhóm) — báo dừng máy ở từng tổ con." | dung_may.py:193 |
| TT11 | C | Duyệt nghỉ phép / tăng ca của tổ | Nghỉ phép → Duyệt | Kiểm vai tổ trưởng có ô Duyệt không; có thì duyệt được người trong tổ (P10: cả tổ con) | leave_repo.py:97 |
| TT12 | X | Tự duyệt đơn nghỉ của mình | Duyệt đơn mình | "Không tự duyệt đơn nghỉ của chính mình — nhờ cấp trên duyệt." | leave_service.py:432 |
| TT13 | X | Duyệt đơn tổ khác bằng id | Gọi API duyệt | "Nhân viên này ngoài phạm vi quản lý của bạn." | leave_service.py:396 |
| TT14 | R | NV chuyển vào tổ ngày 15, có đơn chờ ngày 5–6 | Duyệt | Tổ trưởng mới duyệt được, tổ trưởng cũ mất đơn. Cần chủ chốt | leave_repo.py:99 |
| TT15 | R | Thợ chuyển tổ giữa việc | P18 điều chuyển P14 sang tổ khác | Thợ vẫn có phân công ở việc cũ, ô chọn người không còn tên. Cần chủ chốt có rút phân công không (NL-SX05) | thuc_thi.py:270 |

### 4.8 P13/P14 Thợ SX, P15 thợ thử việc, P16 nhân viên cán màng

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| TH01 | C | Thợ "Cả phòng" làm được mọi việc của tổ | "Bắt đầu" việc chưa giao cho mình | Được | quyen_to.py:202 |
| TH02 | R | Thợ giao/rút người khác | "Giao người" / "Rút người" | Được. Thợ rút được cả tổ trưởng khỏi việc. Cần chủ chốt | thuc_thi.py:149 |
| TH03 | X | Thợ sửa số | API sua-so (nút ẩn) | 403 "Bạn không có quyền thực hiện thao tác này" | san_xuat.py:838 |
| TH04 | R | Thợ ghi sản lượng tự đề xuất giao dù không có Xác nhận | "Ghi sản lượng" ở bước có 1 chặng sau | Code nghi tạo bàn giao, cùng tổ cùng lệnh thì tự xác nhận (NL-SX02). Cần chủ chốt | san_luong.py:360 |
| TH05 | X | Thợ đề xuất giao bằng tay | API handovers | 403 câu chung | san_xuat.py:877 |
| TH06 | R | Tổ In không có tổ trưởng | P13 ghi xong, bước sau ở tổ Cán | Tổ Cán xác nhận bình thường; nhưng bàn giao vào tổ In, toast và lỗi KCS của tổ In chỉ tới P01 | quyen_to.py:401 |
| TH07 | R | Thợ báo sự cố qua đường cũ | Gọi API su-co | Phải chặn như "Báo máy hỏng". Code nghi tạo được yêu cầu sửa (NL-SX03) | san_xuat.py:749 |
| TH08 | R | Thợ thấy danh sách người của mọi tổ | Gọi API danh sách ứng viên hỗ trợ | Code nghi trả cả danh sách (NL-SX06) | board.py:834 |
| TV01 | R | P15 được tổ trưởng Thành phẩm giao vào việc của tổ Thành phẩm | P08 giao P15 | P15 có phân công nhưng không thấy việc: "Ngoài phạm vi tổ được phép xem." (NL-SX05) | thuc_thi.py:174 |
| CM01 | C | P16 chỉ thấy việc được giao | Mở bàn Tổ cán màng | Chỉ việc có phân công; badge đếm đúng | san_xuat_repo.py:829 |
| CM02 | X | P16 mở việc chưa giao | URL việc | 403 "Chỉ xem được việc đã giao cho mình." | board.py:1257 |
| CM03 | R | P16 bị rút giữa chừng | Tổ trưởng "Rút người" → P16 F5 | Việc biến mất; lịch sử, tệp lệnh 403 | lich_su_viec.py:88 |
| CM04 | R | Câu báo khi việc chưa giao | Mở việc qua bàn giao | "Việc này chưa giao cho bạn — quyền Thực hiện lệnh của bạn ở tổ này là “Của tôi”, chỉ áp cho việc được giao." | ThsxCotPhai.tsx:380 |
| CM05 | X | P16 báo dừng máy (cần Xác nhận TRỌN tổ) | Nút ẩn; API | 403 "Bạn không có quyền Xác nhận sản lượng ở tổ này" | dung_may.py:111 |
| CM06 | R | P16 xác nhận nhận bàn giao vào việc của mình | Ngăn việc → "Xác nhận" | Được, nhưng không có trong hộp "chờ xác nhận" và không nhận toast (NL-SX07) | ban_giao.py:308 |
| CM07 | X | P16 "Đã xem" lỗi KCS | API da-xem | 403 "Bạn không có quyền Xác nhận sản lượng ở tổ này" | kcs.py:585 |
| CM08 | R | Chấm đỏ tổ cho việc không phải của mình | Một việc khác có lỗi KCS | Chấm đỏ hiện, mở ra không có dòng mới | thong_bao_man.py:136 |
| CM09 | R | Tài khoản chưa nối hồ sơ nhân viên | Mở bàn | Bàn trống, mọi nút ghi 403 | board.py:66 |
| TH09 | C | Thợ: chấm công, nghỉ phép, tăng ca, phiếu lương của tôi | Từng màn | Chỉ dữ liệu của mình; tab Bảng công tháng và Bảng lương ẩn | attendance.py:628; payroll.py:973 |
| TH10 | X | Thợ xin tạm ứng khi tài khoản chưa gắn hồ sơ | Tạm ứng của tôi → Gửi | 400 "Tài khoản chưa gắn hồ sơ nhân sự." | payroll.py:920 |

### 4.9 P17 Nhân viên giao hàng, P23 Quản lý giao hàng

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| GH01 | C | Tài xế chỉ thấy chuyến mình chở | Tab Đơn giao hàng | Không thấy chuyến người khác | delivery.py:796 |
| GH02 | C | Kho xuất xong báo tài xế | P09 ghi sổ xuất | "Kho đã xuất hàng cho chuyến của bạn — bắt đầu giao được rồi." | delivery_notify.py:120 |
| GH03 | X | Yêu cầu của chuyến người khác | URL yêu cầu | 403 "Bạn không có quyền xem yêu cầu giao hàng này" | delivery_service.py:161 |
| GH04 | X | Xếp chuyến | Gọi API plans | 403 | delivery.py:195 |
| GH05 | X | Tab Nhân viên giao hàng | Gõ URL | Tab ẩn; API 403 | GiaoHangPage.tsx:105 |
| GH06 | R | Phụ xe | Mở chuyến có mình là phụ xe | Kiểm phụ xe có thấy chuyến không (code lọc theo tài xế) | delivery.py:796 |
| GH07 | R | P23 "Cả phòng": yêu cầu của phòng con; người lập chuyển phòng | Tab Yêu cầu giao | Không thấy phòng con; yêu cầu ở lại phòng cũ | delivery_service.py:146 |
| GH08 | X | Tạo yêu cầu giao cho đơn ngoài phạm vi | Gọi POST | Phải chặn. Code nghi tạo được (NL-GH02) | delivery_service.py:463 |
| GH09 | R | "Còn phải giao" của đơn bất kỳ | `/orders/{id}/con-phai-giao` | Nên 404. Code nghi lộ dòng hàng (NL-GH02) | delivery.py:703 |
| GH10 | R | Tài xế được cấp Xem đơn | JSON đơn | Có giá vốn, CK, kê. Cần chủ chốt (NL-BH06) | schemas/order.py:21 |

### 4.10 P18 admin HCNS

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| HC01 | C | Quản hồ sơ toàn công ty | Hồ sơ nhân sự | Thấy mọi người (phạm vi Tất cả) | employee_repo.py:122 |
| HC02 | X | Gán vai phòng khác | Tab Tài khoản → Vai trò | 400 "Vai trò không thuộc phòng của người dùng" | user_admin_service.py:136 |
| HC06 | C | Tự khoá mình | Khóa tài khoản | 400 "Không thể tự khóa tài khoản của mình" | user_admin_service.py:228 |
| HC07 | X | Tự cho mình nghỉ việc (đi vòng chốt tự khoá) | Đổi trạng thái → Nghỉ việc | PHẢI chặn (NL-HT07) | employee_service.py:885 |
| HC08 | C | Tự thu hồi phiên | Thu hồi mọi phiên | 400 "Không thể tự thu hồi phiên của tài khoản chính mình" | user_admin_service.py:303 |
| HC09 | X | Cho tài khoản `admin` hệ thống nghỉ | Cho nghỉ | "Hồ sơ này đang gắn tài khoản quản trị hệ thống — không cho nghỉ việc…" | employee_service.py:893 |
| HC10 | R | Không có Xem lương: xem hồ sơ, xuất Excel | Xem; Xuất Excel | Số BHXH, MST, TK, ngân hàng trống. CCCD, địa chỉ vẫn hiện; cần chủ chốt | employee_service.py:131 |
| HC11 | X | Thêm hồ sơ kèm lương khi không có Sửa lương | Thêm nhân viên | 403, câu hiện không dấu "Ban khong co quyen khai muc luong ban dau cho nhan vien." (NL-HT11) | employees.py:461 |
| HC13 | C | Duyệt yêu cầu cập nhật hồ sơ | Duyệt | Không ai được báo tức thời (NL-HT09) | employees.py:608 |
| HC14 | C | Chốt kỳ công | Chốt kỳ công | Làm được (phạm vi Tất cả). Vai "Cả phòng" nhận "Chốt kỳ công là việc của cả công ty — …" | attendance.py:157 |
| HC15 | C | Tính lại, chốt, công bố, thu hồi, đã chi lương | Tab Bảng lương | Được. NLĐ nhận "Phiếu lương MM/YYYY đã công bố…"; bấm Chốt không báo ai | phieu_luong_mo.py:36 |
| HC16 | X | Xuất file chuyển khoản kỳ nháp | bank.xlsx | 409 "Kỳ lương còn nháp — chốt kỳ rồi mới xuất file chuyển khoản." | payroll.py:1308 |
| HC17 | R | Tự duyệt đơn nghỉ / tạm ứng của mình (Tất cả) | Duyệt | Cho phép. Cần chủ chốt có giữ không | leave_service.py:430 |
| HC18 | R | Liên kết tài khoản `admin` mồ côi vào một hồ sơ | Gọi API account với user_id | Code nghi đổi phòng tài khoản nhưng giữ vai cũ (NL-HT12) | employee_service.py:1152 |
| HC19 | R | Phòng ban chỉ Xem | Sửa phòng | Nút ẩn. Nếu có Sửa: sửa được đơn giá km, % tài xế, cờ lương khoán, không cần ô Lương (NL-HT13) | rbac.py:347 |

### 4.11 P19 kế toán trưởng, P20–P22 vai kế toán (gán thử)

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| KT01 | C | P19 duyệt đơn mua của P09 | Đơn mua hàng → Duyệt | Phải làm được; P09 nhận "Đơn mua hàng X đã được duyệt". Trên dev, phạm vi lưu "Của tôi" nên hộp trống, duyệt ra 404 (NL-KT01) | purchase_service.py:2474 |
| KT02 | R | P19 nhận toast đơn chờ duyệt | P09 gửi duyệt | Có toast dù hộp trống: lệch giữa thông báo và hộp | thong_bao_man.py:23 |
| KT03 | X | P19 lập phiếu chi NCC | Lập phiếu chi | 403 (không có Phiếu chi Thêm). Vậy sau khi duyệt, chỉ P01 trả tiền NCC được | accounting.py:1193 |
| KT04 | C | P20 thu cọc ở màn Phiếu thu | Phiếu thu → Đơn hàng chờ thu → tick cọc | Được (phiếu thu ép Tất cả) | |
| KT05 | R | P20 thu cọc ở ngăn đơn, Đơn bán chỉ Xem "Của tôi" | Mở đơn của sale | 404 "Không tìm thấy đơn hàng"; chấm đỏ chờ cọc không tới | order_service.py:840 |
| KT06 | C | P20 chi CK/kê | Phiếu chi → Chờ chi CK / kê | Nhận "🔔 Hóa đơn X đã thu đủ, chờ chi chiết khấu/kê" một lần | chi_ck_ke.py:150 |
| KT07 | R | P21 xem công nợ phải thu | Công nợ phải thu | Thấy mọi khách (không có phạm vi) | accounting.py:349 |
| KT08 | R | Vai không có "In phiếu chi" | Nút In ẩn; xem JSON phiếu | Dữ liệu vẫn trả đủ (NL-KT02) | accounting.py:1172 |
| KT09 | R | Phiếu thu cũ trạng thái chờ | Xác nhận đã thu | Ô này đã gỡ khỏi ma trận nên không cấp được; ngoài vai cũ không ai bấm được (NL-KT02) | accounting.py:1685 |
| KT10 | X | Huỷ phiếu thu thiếu ô Huỷ | Gọi API | 403 | accounting.py:1705 |
| KT11 | R | Báo cáo kinh doanh "Tất cả" mà Đơn bán "Của tôi" | Báo cáo kinh doanh → Excel | Liệt kê đơn mọi sale kèm cọc, CK, kê. Cần chủ chốt có đúng ý không | bao_cao_kinh_doanh.py:80 |
| KT12 | X | P22 thiếu "Xem giá thành" | Báo cáo kho | Không có đơn giá; tab Giá gốc 403 | kho_baocao.py:95 |
| KT13 | R | P22 có Kho Xem mà không Đề nghị | Mở Kho | Bị coi là "người kho": có tab "Phiếu từ yêu cầu", badge chờ cấp, nhận chuông yêu cầu mới | kho_request.py:71 |
| KT14 | X | Khoá kỳ công nợ, chuyển mục thu chi khi thiếu Thao tác | Nút tương ứng | Nút ẩn; API 403 | accounting.py:709 |

### 4.12 P24 Thợ sửa chữa, P25 QC (gán thử)

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| SC01 | C | Có người giữ Thợ sửa chữa | P11 báo máy hư | P24 và P01 nhận toast; P24 "Tiếp nhận" → P11 nhận kết quả | ky_thuat_may_service.py:535 |
| SC02 | R | Vai có Sửa chữa máy Thêm mà không Sửa | Tiếp nhận / Từ chối | Tiếp nhận được; Từ chối 403; không nhận toast báo hỏng (NL-SC01) | ky_thuat_may.py:416 |
| SC03 | X | Sửa lời báo của người khác | Gọi PUT yêu cầu | 403 "Chỉ người đã gửi yêu cầu này mới sửa được." | ky_thuat_may.py:310 |
| SC04 | R | Người chỉ có "Báo máy hỏng" | Mở Sửa chữa máy | Thấy mọi yêu cầu, mọi phiếu và badge "chờ tiếp nhận" (ô chi tiết tự bật Xem) | role_service.py:451 |
| QC01 | R | P25 không có màn KCS | Gõ URL KCS | 403. Cần chủ chốt vai QC làm KCS hay không | kcs.py:87 |

### 4.13 Nhóm dùng chung (khối Kinh doanh)

Luật theo code:
- **Tác dụng:** hai người cùng nhóm thì "Của tôi" nới thành "của tôi + người cùng nhóm".
- **Phạm vi áp dụng:**
  - Chỉ áp ở bốn màn Khách hàng, Tính giá, Báo giá, Đơn bán, và chỉ khi vai đang để "Của tôi".
  - Ba màn đọc theo đơn bán cũng ăn theo: Báo cáo kinh doanh, Kế hoạch SX, Hồ sơ lệnh / Theo dõi SX.
- **Không nâng quyền:** ô quyền vẫn tính theo vai của chính người thao tác.
- **Ai được tạo nhóm:** người có ô "Quản lý phân quyền" ở Phòng ban. Nút nằm ở màn Phòng ban.
- **Nhiều nhóm:** một người ở nhiều nhóm thì lấy hợp các nhóm. Không bắc cầu: A–B và B–C không làm A thấy C.

| Mã | Loại | Use case | Thao tác | Phải thấy | Code |
|---|---|---|---|---|---|
| ND01 | C | Gộp nhóm | P01 → Phòng ban → nhóm dùng chung → tạo "VAI nhóm 3-4" gồm P03, P04 | Nhóm hiện 2 người; Nhật ký có "Gộp nhóm dùng chung “VAI nhóm 3-4”: …" | nhom_dung_chung.py:57 |
| ND02 | X | Tên nhóm trùng | Tạo lại tên "VAI nhóm 3-4"; đổi tên nhóm khác thành tên này | "Đã có nhóm tên “VAI nhóm 3-4”" | nhom_dung_chung.py:67,95 |
| ND03 | X | Không có ô Quản lý phân quyền | P18 (Phòng ban) và P02 mở Phòng ban | Không thấy nút nhóm; gọi API tạo nhóm: 403 | nhom_dung_chung.py:29 |
| ND04 | C | Thấy chứng từ bạn cùng nhóm | P03 mở Khách hàng, Tính giá, Báo giá, Đơn bán | Thấy khách và chứng từ của P04 (khách P04 phụ trách); trước khi gộp thì không | customer_repo.py:112; quotation_repo.py:180; order_repo.py:214 |
| ND05 | C | Ba màn ăn theo đơn bán | P03 mở Báo cáo kinh doanh (nếu có), Kế hoạch SX / Hồ sơ lệnh của đơn P04 | Đơn và lệnh của P04 hiện; xuất Excel cũng có | pham_vi.py:45; bao_cao_kinh_doanh.py:80 |
| ND06 | R | Ghi trên chứng từ bạn cùng nhóm | P03 sửa báo giá nháp của P04, trình duyệt, tạo đơn từ báo giá P04 đã chốt | Ghi nhận hành vi: phạm vi "Của tôi" nới cả việc SỬA, không chỉ xem. Cần chủ chốt có đúng ý không | quotation_repo.py:233 |
| ND07 | R | Ô lọc NV phụ trách | P03 mở ô lọc ở Khách hàng | Phải có tên P04 (NL-BH09) | customers.py:352 |
| ND08 | R | Lịch hẹn | P03 → Khách hàng → Lịch hẹn | Có nút "Của tôi / Cả nhóm"; người không thuộc nhóm nào thì không có nút | customer_service.py:1104 |
| ND09 | X | Nhóm không lan sang màn khác | P03 mở Nghỉ phép, Lương, Hồ sơ của P04 (URL/API); Giao hàng: yêu cầu P04 lập | Không thấy gì của P04 | org_scope.py:47 |
| ND10 | R | Không bắc cầu | Thêm nhóm "VAI nhóm 3-6" gồm P03, P06 | P03 thấy của P04 và P06; P04 KHÔNG thấy của P06; P06 KHÔNG thấy của P04 | org_scope.py:60 |
| ND11 | R | Khác phòng gộp được | Nhóm gồm P04 và P05 (phòng con) | P04 thấy chứng từ P05 và ngược lại; P02 ("Cả phòng") không đổi gì | nhom_dung_chung.py (CỐ Ý không gắn phòng) |
| ND12 | R | Chỉ áp khi "Của tôi" | P06 (Trợ lý) nếu có màn ở "Cả phòng"/"Tất cả" vào nhóm | Thấy y như trước khi vào nhóm | org_scope.py:57 |
| ND13 | R | Chứng từ chưa có khách | P04 lập phiếu tính giá chưa chọn khách | P03 cùng nhóm thấy phiếu (rơi về người lập) | org_scope.py:68 |
| ND14 | R | Điều chuyển khách ra ngoài nhóm | P01 chuyển một khách của P04 sang P05 (ngoài nhóm 3-4) | P03 và P04 mất ngay khách đó cùng mọi phiếu/báo giá/đơn của nó | org_scope.py:73 |
| ND15 | R | Rút người / xoá nhóm khi tab đang mở | P03 đang mở báo giá của P04 → P01 rút P04 khỏi nhóm (rồi thử xoá nhóm) | Hộp xoá: "2 người trong nhóm sẽ trở lại chỉ thấy dữ liệu của chính mình."; request kế tiếp của P03 vào báo giá đó 404. Ghi lại màn có tự cập nhật không hay phải F5 | NhomDungChungPopover.tsx:549 |
| ND16 | R | Thông báo theo nhóm | P04 trình duyệt; P02 duyệt; P04 tạo đơn chờ cọc, thu đủ cọc | Ghi ai nhận toast: theo code chỉ người soạn / sale đứng tên, P03 cùng nhóm KHÔNG nhận. Cần chủ chốt có muốn bạn cùng nhóm nhận không | quotations.py:769; orders.py:475 |
| ND17 | R | Một người hai nhóm, gỡ một nhóm | P03 ở 3-4 và 3-6, xoá nhóm 3-6 | P03 còn thấy P04, mất P06 | org_scope.py:61 |
| ND18 | R | Người trong nhóm nghỉ việc | P18 cho P04 nghỉ (chỉ persona thử) | P03 vẫn thấy khách còn gán P04 tới khi điều chuyển khách; ghi lại hành vi | |

---

## 5. Chuỗi bàn giao nhiều vai

Mỗi chuỗi chạy với 3–5 persona mở cùng lúc. Ở từng bước, ghi: ai bấm; ai nhận badge/toast trong vài giây mà
không F5; ai KHÔNG được nhận.

| Mã | Chuỗi | Các bước, kèm người phải nhận |
|---|---|---|
| CB01 | Bán hàng | P06 soạn phiếu tính giá cho khách P03 → P03 "Lập báo giá" (SA12) → P03 trình → P02 nhận, duyệt → P03 nhận "✓" → khách chốt, P03 tạo đơn → P01 (hoặc P20) nhận "Đơn chờ ghi cọc" → thu cọc → P03 nhận "đủ cọc" → P07 lập lệnh |
| CB02 | Sản xuất | P07 phát hành → P09 một chuông → P09 xuất kho → chip bàn tổ P13 tự đổi → P13 bắt đầu, ghi → tổ Cán (P11 không phải; tổ trưởng Cán) nhận đề xuất giao → xác nhận → … → P01 làm KCS (KC01: P08 không làm được) → nhập kho thành phẩm |
| CB03 | Giao và thu | P03 lập yêu cầu giao → P23 (gán thử) / P01 xếp chuyến → P09 xuất → P17 nhận "Kho đã xuất hàng…" → giao → P01 / P20 ghi hoá đơn → thu → nhận "thu đủ, chờ chi CK/kê" → chi |
| CB04 | Mua hàng | P11 yêu cầu mua → P09 nhận → lập phiếu mua → gửi duyệt → P19 nhận toast nhưng hộp trống (NL-KT01) → P01 duyệt → P09 ghi đợt giao → P09 nhận yêu cầu nhập → nhập kho → P01 lập phiếu chi NCC (P19 không lập được, KT03) |
| CB05 | Sửa chữa | P11 báo dừng máy chỉ tính lương (không có Báo hỏng) → thử lại với P01 báo máy hư → P24 (gán thử) nhận → tiếp nhận → P11 nhận kết quả → đóng phiếu → việc trên máy mở lại |
| CB06 | Nhân sự | P14 xin nghỉ → P11 nhận chấm đỏ → duyệt → P14 thấy kết quả. Lặp với P15 (tổ thử việc) xem ai duyệt. P11 tự xin nghỉ → P10 (nhóm cha) duyệt được |
| CB07 | Lương | P18 tính lại → công bố → P13, P14 nhận "Phiếu lương … đã công bố" → mở phiếu lương của mình. P18 thu hồi → nhận "…đã được thu hồi để sửa." |
| CB08 | Đổi người giữa chừng | Lúc CB01 đang ở bước chờ duyệt: P01 đổi người phụ trách khách sang P04 → kiểm badge, chấm đỏ, toast "đủ cọc" đi về ai (TP06, NL-BH05). Lúc CB02 đang chạy: P18 điều chuyển P14 sang tổ khác → kiểm phân công, menu, quyền (TT15) |

---

## 6. Thanh bên phải thấy theo vai (dev)

Mọi vai đều có thêm Hồ sơ của tôi, Chấm công, Nghỉ phép, Tăng ca, Lương. Riêng P16 không có Trang chủ.

| Vai | Mục thanh bên |
|---|---|
| Giám đốc | Tất cả, trừ Bài ghép (đang ẩn bằng cờ) |
| Trưởng phòng kinh doanh, sale | Quy trình KD, Tính giá, Báo giá, Đơn hàng bán, Khách hàng |
| Trợ lý kinh doanh | Như trên, cộng Kế hoạch SX, Kế hoạch vật tư, Xếp lịch, Yêu cầu mua, 6 danh mục |
| kế hoạch, KCS trưởng | Kế hoạch SX, Hồ sơ lệnh, Theo dõi SX, Kế hoạch vật tư, Xếp lịch. KCS trưởng thêm tổ Thành phẩm / KCS |
| Tổ trưởng cắt - thu mua - thủ kho | Kế hoạch SX, Kế hoạch vật tư, Xếp lịch, Tổ (nhóm Cắt), Sửa chữa máy, Yêu cầu mua, Mua hàng, NCC, Yêu cầu nhập xuất, 5 kho, Báo cáo kho, Khai báo kho, Thiết bị |
| Tổ trưởng SX | Kế hoạch SX, Kế hoạch vật tư, Xếp lịch, Tổ của mình (+ tổ con), Sửa chữa máy, Yêu cầu mua, Yêu cầu nhập xuất, Thiết bị, Nội quy |
| Thợ SX | Kế hoạch SX, Kế hoạch vật tư, Xếp lịch, Tổ của mình, Sửa chữa máy, Nội quy |
| Nhân viên giao hàng | Giao hàng, Nội quy |
| admin HCNS | Phòng ban, Hồ sơ nhân sự, Chấm công, Nghỉ phép, Tăng ca, Lương, Nội quy |
| kế toán trưởng | Đơn mua hàng |

---

## 7. Nghi lỗi phân quyền đọc từ code

Mức độ:
- **Nặng:** lộ tiền/lương, lọt phạm vi hàng loạt, hoặc người thật trên dev bị kẹt việc.
- **Vừa:** lọt phạm vi khi gọi thẳng theo mã, hoặc thông báo sai người.
- **Nhẹ:** chữ nghĩa, giao diện lệch máy chủ.

### Nặng

| Mã | Nghi lỗi | Code | Ca |
|---|---|---|---|
| NL-KT01 | Đơn mua hàng: giao diện khoá "Tất cả" nhưng máy chủ đọc giá trị lưu. Kế toán trưởng trên dev đang lưu "Của tôi" nên hộp trống, duyệt đơn người khác ra 404 | PermissionMatrix.tsx:1093; role_service.py:50; purchase_service.py:2474 | KT01, CB04 |
| NL-HT03 | Nhật ký: Xem Lương luôn bật cho mọi vai, nên ai xem được Nhật ký đều đọc số tiền tạm ứng, khoản lương của mọi người. Dòng "mốc lương" lộ ở tab hoạt động hồ sơ | activity_service.py:84; employees.py:889 | CH15 |
| NL-BH06 | Giá vốn, CK, kê không được cắt ở máy chủ: báo giá trả `total_cost`, `margin`; đơn trả `cost_snapshot`, CK, kê cho mọi người có Xem. Cờ "xem công nợ", "xem chiết khấu" không route nào hỏi | quotations.py:323; schemas/order.py:21 | TP09, GH10 |
| NL-KHO01 | Tiếp nhận, huỷ, chuẩn bị yêu cầu kho không kiểm phạm vi. Danh sách và chi tiết phiếu kho không lọc. Lập phiếu không kiểm dòng kho `ton_kho_` | kho_request.py:763-824; kho_voucher.py:393-498 | TK03 |

### Vừa

| Mã | Nghi lỗi | Code | Ca |
|---|---|---|---|
| NL-BH01 | Lập báo giá từ phiếu tính giá kiểm theo người lập phiếu, lệch luật chủ khách | quotations.py:575 | SA12 |
| NL-BH02 | Điều chuyển khách: form Sửa không chặn vai "Của tôi"; vai "Cả phòng" chỉ so đúng một phòng, không gồm phòng con | customer_service.py:469; customers.py:420 | SA06, TP05 |
| NL-BH03 | Chấm đỏ và toast quyết định báo giá đi theo người soạn; badge số và quyền duyệt theo chủ khách | quotations.py:735,769; quotation_repo.py:190 | TP04, TL02 |
| NL-BH04 | Tạo đơn bỏ qua phạm vi báo giá nguồn | order_service.py:592 | SA14 |
| NL-BH05 | Toast "đủ cọc" bắn cho sale chụp lúc tạo đơn, không theo chủ khách hiện tại | orders.py:475 | CB08 |
| NL-BH07 | Gợi ý tái bản không kiểm khách trong phạm vi | phieu_tinh_gia.py:611 | SA11 |
| NL-GH01 | Tab chuyến với "Của tôi" chỉ lọc theo tài xế, lệch với chi tiết và hướng dẫn ma trận | delivery.py:796 | GH01, GH06 |
| NL-GH02 | Tạo yêu cầu giao không kiểm phạm vi đơn; "còn phải giao" không lọc | delivery_service.py:463; delivery.py:703 | GH08, GH09 |
| NL-MH01 | Mở yêu cầu mua theo mã chỉ kiểm phòng, bỏ qua "Của tôi" | purchase_service.py:1834 | ca kèm CB04 |
| NL-MH02 | Toast yêu cầu mua mới và đơn mua chờ duyệt không xét phạm vi hay ô Duyệt | AppShell.tsx:919-930 | TK04, KT02 |
| NL-KHO03 | Thông báo, badge, hộp yêu cầu kho không lọc theo kho nào; thông báo gửi cả tài khoản đã khoá | rbac_repo.py:470-510 | TK03 |
| NL-SX01 | Xếp lịch không theo phạm vi Kế hoạch SX: phát hành được lệnh không thấy ở Kế hoạch SX | xep_lich.py:110 | KH02 |
| NL-SX02 | Ghi sản lượng tự đề xuất giao, bỏ qua quyền Xác nhận sản lượng | san_luong.py:360 | TH04 |
| NL-SX03 | Đường báo sự cố cũ tạo yêu cầu sửa chữa mà không cần "Báo máy hỏng" | san_xuat.py:749 | TH07 |
| NL-SX05 | Phân công nhận nhân viên tổ khác; chuyển phòng không rút phân công cũ | thuc_thi.py:174,270 | TV01, TT15 |
| NL-SX07 | Người "Của tôi" xác nhận được bàn giao nhưng không có hộp chờ và toast | board.py:782; quyen_to.py:401 | CM06 |
| NL-SX08 | Tổ lá thành tổ cha vẫn giữ quyền cũ, phủ tổ con mới. Tổ rời khối sản xuất thì quyền bị xoá vĩnh viễn | quyen_to.py:157-199 | thêm vào CB02 |
| NL-HT04 | Sửa cây phòng ban không bắn `quyen_doi` | department_service.py:93 | CH05 |
| NL-HT05 | SSE chỉ kiểm lúc nối: bị khoá hay thu hồi phiên vẫn nhận tin. Khoá tài khoản không gửi sự kiện, tab chỉ ăn 403 tới khi token hết hạn | quotations.py:506; user_admin_service.py:225 | CH06 |
| NL-HT07 | Tự cho mình nghỉ việc đi vòng chốt tự khoá; tuyển lại thì tự mở khoá tài khoản bị khoá tay | employee_service.py:885-937 | HC07, CH09 |
| NL-HT16 | Danh sách tài khoản (`/users`, phiên, IP đăng nhập) không lọc phạm vi | rbac.py:545-720 | |
| NL-HT10 | SSE tạm ứng mang tên người xin, gửi tới mọi ai xem được nhóm nhân sự (gồm thợ) | payroll.py:390 | CH14 |
| NL-HT12 | Liên kết tài khoản có sẵn đổi phòng tài khoản nhưng không gỡ vai | employee_service.py:1152 | HC18 |
| NL-HT13 | Phòng ban Sửa đổi được đơn giá km, % tài xế, cờ lương khoán; Đặt trưởng phòng đổi người nhận tiền tổ trưởng, không cần ô Lương | rbac.py:347; khoan_ky.py:686 | HC19 |
| NL-HT14 | Phạm vi lương, nghỉ phép, tăng ca, Khoán theo tổ theo phòng HIỆN TẠI; cảnh báo chốt và danh sách tổ ở Khoán theo tổ lộ tên tổ ngoài phạm vi | payroll_service.py:2511; khoan_theo_to.py:63 | TT14 |
| NL-SC01 | Người nhận báo hỏng dùng cột Sửa, tiếp nhận dùng Thêm, từ chối dùng Sửa: hai cột có thể lệch | ky_thuat_may_service.py:465; ky_thuat_may.py:416 | SC02 |

### Nhẹ

| Mã | Nghi lỗi | Code | Ca |
|---|---|---|---|
| NL-BH09 | Ô lọc NV phụ trách của vai "Của tôi" thiếu nhóm dùng chung | customers.py:352 | SA04 |
| NL-BH10 | Lộ nhẹ: mã báo giá qua `by-phieu`, tên khách qua kiểm trùng, mã đơn qua SSE hoá đơn, tệp đính kèm chỉ kiểm theo module | quotations.py:601; accounting.py:150; files.py:28 | SA18, SA19 |
| NL-KT02 | "In phiếu chi/thu" chỉ chặn ở giao diện; ô "Xác nhận đã thu" không còn cấp được mà máy chủ vẫn đòi | accounting.py:1172,1685 | KT08, KT09 |
| NL-SX06 | Thợ "Của tôi" gọi được danh sách người của mọi tổ | board.py:702,834 | TH08 |
| NL-HT09 | Không có báo tức thời cho yêu cầu cập nhật hồ sơ và Chốt kỳ lương | employees.py:608 | HC13 |
| NL-HT11 | Câu báo không dấu ở employees.py:465 và :851 | employees.py | HC11 |
| NL-HT15 | Giao diện lệch máy chủ: nút Tính lại hiện cho vai "Cả phòng" (máy chủ chặn); form Cấp tài khoản hiện ô Vai trò cho người không có Gán vai; hint ma trận còn nhắc "chốt giấy", "xác nhận đã nhận vật tư" đã gỡ | BangLuongTab.tsx:436; AccountTab.tsx:175; PermissionMatrix.tsx:940 | |
| NL-KHO04 | Cờ "Tiếp nhận yêu cầu, lập phiếu" không route nào hỏi; ghi sổ gác bằng Thêm | rbac_service.py:58; kho_voucher.py:512 | TK02 |

---

## 8. Cấu hình vai trên dev nên xem lại

Đây không phải lỗi code. Chúng là chỗ người thật sẽ bị kẹt nếu lên prod với ma trận hiện tại.

- **Kế toán:** ngoài Giám đốc, không ai lập được phiếu thu, phiếu chi hay xem công nợ. Ba vai kế toán chưa có
  người. Kế toán trưởng chỉ duyệt đơn mua, và đang bị NL-KT01 chặn nốt.
- **KCS:** chỉ Giám đốc có màn KCS. KCS trưởng thì lại có quyền sửa Xếp lịch, Kế hoạch SX, trùng hẳn vai kế hoạch.
- **Sửa chữa máy:** không ai nhận báo hỏng ngoài Giám đốc. Không tổ trưởng nào có "Báo máy hỏng", nên tổ chỉ
  báo dừng máy để tính lương.
- **Kho ở bàn tổ:** không thợ hay tổ trưởng nào có ô Kho. Tổ không sửa được số xin của yêu cầu tự lập, không
  nhập lại vật tư thừa.
- **Tổ không có tổ trưởng:**
  - Tổ In và 5 nhóm máy in không có tổ trưởng. Tổ bồi cũng không có.
  - Nhóm Cắt chỉ có vai thủ kho kiêm.
  - Ở các tổ này, đề xuất giao và lỗi KCS chỉ báo tới Giám đốc.
- **Duyệt đơn nghỉ / tăng ca:** kiểm vai tổ trưởng có ô Duyệt không. Không có thì đơn của thợ chỉ HCNS và Giám đốc duyệt.
- **Phạm vi Kế hoạch SX của vai xưởng:** phạm vi tính theo chủ đơn, nên vai xưởng để "Cả phòng" sẽ không thấy
  lệnh nào. Cần chủ chốt vai xưởng nên để phạm vi gì.

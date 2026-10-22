# Máy thuộc tổ — công đoạn lấy máy qua tổ, bước chọn tổ thì máy đi theo tổ

Ngày: 22/10/2026. Trạng thái: thiết kế, CHƯA code. Làm cả BE lẫn FE.

## 1. Vì sao

Bước In của LSX26-0003 (DB dev) đang giao **Nhóm thợ in máy 2 màu** nhưng gắn máy **IN-02 Máy in
4 màu Mitsubishi 79×109**. Ở xưởng không có cảnh đó: thợ đứng máy của tổ mình.

Nguyên nhân: tổ và máy của bước là hai ô độc lập, lấy từ hai nguồn, không gì ràng buộc nhau.
- Máy = ô "Máy in" của phiếu tính giá (`lsx_service._may_mac_dinh`, `lsx_service.py:623`).
- Tổ = tổ mặc định của công đoạn (`CongDoan.to_mac_dinh_id`, `lsx_service.py:1348`).
- Danh mục máy (`may_thiet_bi`) không có gì nói máy thuộc tổ nào. Công đoạn khai danh sách tổ
  (`cong_doan_to`) và danh sách máy (`cong_doan_may`) rời nhau.

Hệ quả: việc lên nhầm bàn tổ, khoán tính nhầm tổ (giá khoán theo `san_xuat_cong_viec.department_id`,
`san_luong.py:321`, `khoan_ky.py:253`), tổ thấy phiếu sửa của máy không phải của mình.

## 2. Luật chủ dự án chốt (22/10/2026)

1. **Máy đi theo tổ, ở MỌI công đoạn** (không riêng In). Mọi máy khai thuộc tổ nào.
2. **Một máy thuộc được NHIỀU tổ; một tổ giữ được nhiều máy.** Khi chọn, máy đã thuộc tổ khác thì
   hiện tên tổ đó lên cho biết — không chặn.
3. **Khai ở form MÁY** (màn Thiết bị & Máy móc): ô "Tổ đứng máy", chọn nhiều.
4. **Form công đoạn bỏ hai khối:** dải "Máy làm được công đoạn này" (lọc nhóm máy) và nút
   "+ Chọn máy cho công đoạn". Bảng "Máy chạy được công đoạn này" tự hiện máy của các tổ đã tick ở
   "Phòng ban / Tổ phụ trách".
5. **Bước của lệnh: chọn tổ thì ô máy chỉ mời máy của tổ đó.**
6. **Tiền in khi tính giá vẫn đi theo máy** — phiếu tính giá giữ cách chọn máy và ra giá.
7. **Máy hư thì tổ ăn tiền (Báo dừng máy) rồi thợ sang PHỤ tổ khác; việc dở để đó** chờ sửa. Không
   có thao tác chuyển việc sang tổ khác.

## 3. Mục tiêu / Không làm / Cấm

Mục tiêu: không còn bước (ở lệnh, bài ghép) hay công việc (ở bàn tổ) mang máy không thuộc tổ của nó.

Không làm: không đổi phiếu tính giá, khoán, Báo dừng máy, Báo sự cố, bảng Xếp lịch; không thêm
thao tác chuyển việc sang tổ khác.

Cấm (làm vậy là hỏng dù chạy được):
- Lưu được bước/công việc có máy không thuộc tổ của nó.
- Bỏ tick tổ ở công đoạn hay gỡ tổ khỏi máy mà MẤT số khai riêng của cặp công đoạn × máy (cách đo
  giờ chạy, cách tính giá) — tick/gán lại phải thấy lại số cũ.
- Migration tự điền tổ cho máy hay tự sửa lệnh/công việc đang có.

## 4. Thiết kế

### 4.1 Danh mục Máy — ô "Tổ đứng máy" (chọn nhiều)

- Bảng nối mới `may_to (may_id, department_id)`, PK kép, FK `may_thiet_bi.id` ON DELETE CASCADE và
  `departments.id` ON DELETE CASCADE, cột `thu_tu` không cần. Migration `0434`. Cập nhật
  `docs/DB_SCHEMA.md` cùng lúc.
- Chỉ nhận tổ LÁ của Khối Sản xuất (cùng luật `cong_doan_service._kiem_to`, `:212`).
- Form máy (`CFG_MAY`, `rebuildCatalogConfigs.tsx:238`), nhóm "Thông tin chung", cạnh "Nhóm máy":
  ô chọn nhiều dạng chip giống ô "Phòng ban / Tổ phụ trách" của công đoạn (`fields/ToMulti.tsx`),
  nhãn "Tổ đứng máy". Để trống được (máy chưa vào tổ nào).
- Lưới danh sách máy thêm cột "Tổ đứng máy" (tên các tổ). Máy chưa thuộc tổ nào hiện "—".
- Excel danh mục Máy (`catalog_excel_specs.py`) thêm cột "Tổ đứng máy" (tên tổ, phân cách như các
  cột nhiều giá trị đang có).

### 4.2 Gỡ tổ khỏi máy / bỏ tick tổ ở công đoạn khi còn việc

Chủ dự án chốt 22/10: **không chặn** — tổ và máy là ẢNH CHỤP. Bước của lệnh chụp lúc tạo
(`lsx_cong_doan.department_id`, "đổi danh mục sau không lay lệnh đã tạo"), công việc chụp lúc phát
hành. Gỡ tổ khỏi máy hay bỏ tick tổ ở công đoạn chỉ ảnh hưởng lệnh/bước tạo SAU đó; lệnh và việc đang
có giữ nguyên, bước bị lệch chỉ hiện cảnh báo ở băng "Danh mục đã đổi" (§4.10), không tự sửa.

### 4.3 Máy của công đoạn = máy của các tổ đã tick

- **Máy của công đoạn** `cd` = máy còn dùng thuộc ít nhất một tổ trong `cd.department_ids`. Một máy
  thuộc hai tổ đều tick thì hiện MỘT dòng.
- Thứ tự: theo `cong_doan_may.thu_tu` (dòng đầu = máy mặc định, như "Đặt mặc định" hôm nay).
- Công đoạn KHÔNG tick tổ nào ⇒ giữ hành vi hôm nay: dùng nguyên các dòng `cong_doan_may` đã khai,
  không ràng buộc tổ (cùng lối "không khai = không ràng buộc" của ô tổ). Thực tế công đoạn nào cũng
  có tổ; nhánh này để công đoạn cũ chưa khai tổ không gãy. *Quyết định của người viết khi lập plan.*
- Số khai riêng của cặp (`cong_thuc_gio`, `cong_thuc_gia`, `thu_tu`) VẪN lưu ở `cong_doan_may`.
  Máy vào phạm vi (gán tổ cho máy, hoặc tick tổ ở công đoạn) ⇒ máy chủ tự tạo dòng còn thiếu (công
  thức trống, xếp cuối). Máy ra khỏi phạm vi ⇒ dòng nằm im, KHÔNG xoá, không ai đọc; vào lại phạm vi
  là thấy lại số cũ.
- Một hàm duy nhất ở service, vd. `may_cua_cong_doan(db, cd) -> list[(MayThietBi, CongDoanMay|None)]`.
  MỌI chỗ đang đọc `cd.may_lam_duoc` (12 file BE: `lsx_service`, `bai_ghep_service`,
  `xep_lich_service`, `san_xuat/thuc_thi`, `lsx_tong_quan`, `cong_doan_service`, `cong_doan_repo`,
  `catalog_excel*`, `nhat_ky_danh_muc`, schema…) chuyển sang hàm này. Trường `may_lam_duoc` trả ra
  API giữ TÊN và HÌNH DẠNG nhưng là danh sách đã lọc theo tổ — để FE đang đọc nó (phiếu tính giá
  `mayIn`, `LsxDetailView`, `lsxBuoc.mayChonDuoc`) tự đúng.
- **Bỏ lọc theo nhóm máy** (`nhom_may_cho_phep`): gỡ khỏi UI và mọi nhánh logic (`bai_ghep_service.
  may_ngoai_cong_doan`, `thuc_thi.may_doi_duoc`, `lsxBuoc.mayChonDuoc`, `BaiGhepBuocChungForm`).
  Cột giữ trong DB, ghi DB_SCHEMA "không còn đọc" (*quyết định của người viết*: không DROP cho an
  toàn với staging/prod đang chạy bản cũ lúc deploy).

### 4.4 Form công đoạn (FE)

`CFG_CONG_DOAN` (`rebuildCatalogConfigs.tsx:418`), nhóm "Lệnh sản xuất":
- Bỏ ô `nhom_may_cho_phep` (`:515`) và nút/ô chọn "+ Chọn máy cho công đoạn" trong
  `fields/MayCuaCongDoan.tsx`. Bỏ nút xoá dòng (🗑) — muốn bớt máy thì bỏ tick tổ hoặc gỡ tổ ở máy.
- Bảng "Máy chạy được công đoạn này" dựng theo §4.3 và cập nhật NGAY khi tick/bỏ tick tổ trên form
  (chưa cần lưu). Mỗi dòng thêm tên tổ của máy (các tổ đã tick mà máy thuộc). Vẫn sửa được "Cách đo
  giờ chạy", "Cách tính giá", "Đặt mặc định" như hôm nay.
- Câu dưới bảng: "Máy hiện theo tổ đã tick. Thêm máy vào tổ ở danh mục Thiết bị & Máy móc."
- Máy server: `cong_doan_service` (`:236-269`) bỏ kiểm "máy phải nằm trong danh sách chọn", nhận
  `may_lam_duoc` từ form CHỈ để lưu số khai riêng của cặp; dòng ngoài phạm vi tổ ⇒ bỏ qua.

### 4.5 Luật chung cho bước và công việc

Một bước/công việc chạy máy với tổ `T`, máy `M` là hợp lệ khi `M` thuộc `T` (bảng `may_to`) và `M`
nằm trong máy của công đoạn. Công đoạn không tick tổ nào ⇒ không kiểm cặp (§4.3). `T` trống ⇒ hợp lệ khi lưu nháp, nhưng không phát hành được (bước máy
phải có tổ; thêm vào kiểm "Còn thiếu" nếu chưa có). Một hàm ở service, mọi nơi dưới đây gọi nó.

**Máy chọn được cho bước của tổ `T`** = máy của công đoạn thuộc `T`, theo thứ tự §4.3.

**Máy mặc định cho bước của tổ `T`** = máy mặc định của công đoạn nếu nó thuộc `T`, không thì máy
đầu tiên chọn được của `T`, không có thì trống.

**Hiện tổ khác khi chọn máy** (luật 2): ở mọi ô chọn máy (drawer bước, bài ghép, Đổi máy ở bàn tổ),
máy còn thuộc tổ khác thì dòng chữ phụ "cũng thuộc: <tên tổ>".

### 4.6 Tạo lệnh và gộp bài ghép

`_default_buoc` / `_may_mac_dinh` (`lsx_service.py:1488`, `:623`):
- Bước IN có máy từ phiếu tính giá, máy đó nằm trong máy của công đoạn ⇒ máy = máy phiếu; tổ = tổ
  mặc định nếu máy thuộc tổ đó, không thì tổ ĐẦU TIÊN (theo thứ tự tổ của công đoạn) có máy đó.
  LSX26-0003 với IN-02 ⇒ nhóm 4 màu.
- Còn lại (bước khác, hoặc máy phiếu không thuộc công đoạn) ⇒ tổ = tổ mặc định, máy = máy mặc định
  của tổ đó (§4.5).
- `mac_dinh_buoc` (`lsx_service.py:1865`) trả `department_id` + `may_id_goi_y` theo cùng luật.
- **Bổ sung 23/10/2026 (chủ dự án):** công đoạn có tick tổ mà KHÔNG tổ nào có máy còn dùng chạy nó
  ⇒ bước ở kế hoạch mặc định loại **Tổ** (không phải Máy) — `may_to.to_khong_may`, áp ở routing
  xem trước lúc tạo lệnh. Ở bảng bước, đổi bước máy sang công đoạn như vậy thì bước chuyển thành
  bước tổ (`congDoanKhongMay`). Bước thuê ngoài giữ nguyên. Lượt chung bài ghép kế thừa loại của
  bước lệnh nên đi theo.

Gộp bước chung bài ghép (`bai_ghep_service.py:784`, hôm nay cố ý để trống tổ, điền máy bằng
`_may_cho_luot_chung`): máy điền sẵn có tổ trong công đoạn ⇒ tổ chung = tổ đầu tiên có máy đó; không
thì để trống như hôm nay. *Quyết định của người viết.*

### 4.7 Kế hoạch sửa bước (lệnh và bài ghép)

FE — `LsxBuocDrawer.tsx`, `LsxRoutingTable.tsx`, `BaiGhepBuocChungForm.tsx`:
- Ô Máy chỉ mời "máy chọn được cho tổ đang chọn" (§4.5), kèm "cũng thuộc…". Máy đang gán mà KHÔNG
  thuộc tổ đang chọn thì nói "— thuộc <tổ>" / "Máy này không thuộc tổ đang chọn, máy của <tổ>"
  (23/10/2026: "cũng thuộc" nghe như máy thuộc cả tổ đang chọn).
- Form lượt chung bài ghép lọc + xếp máy y như ngăn bước lệnh: sơ đồ trả `may_chon_duoc` (máy còn
  dùng của công đoạn, máy "Đặt mặc định" đầu), không mời máy ngoài công đoạn (23/10/2026).
- Đổi tổ (`doiTo`, `LsxRoutingTable.tsx:387`): máy đang gán không thuộc tổ mới ⇒ nhảy về máy mặc
  định của tổ mới (§4.5), không có thì trống.
- Đổi công đoạn (`doiCongDoan`, `:308`): áp luật tạo lệnh §4.6.
- Tổ không có máy nào ⇒ ô máy trống + dòng chữ nhỏ "Tổ này chưa có máy chạy công đoạn này".
- Danh sách máy cho FE: thêm danh sách tổ (`to_ids`) vào payload `/api/may-thiet-bi` (và endpoint
  `may-chon` hẹp của bàn tổ) là đủ để lọc và hiện "cũng thuộc".

BE — cổng thật:
- `replace_routing` (`lsx_service.py:3189`) và `lap_ke_hoach_buoc_chung` (`bai_ghep_service.py:881`):
  bước máy có cặp không hợp lệ ⇒ 400 "Máy <mã> không thuộc <tổ>. Chọn máy của <tổ> hoặc đổi tổ."
  Hôm nay `may_id` được nhận không kiểm gì (`:3254-3256`).
- Chỉ kiểm khi bước MỚI hoặc tổ/máy/công đoạn THAY ĐỔI so với bản đang lưu (cùng cách kiểm tổ ở
  `:3236-3242`) — lệnh cũ đang lệch vẫn lưu được các sửa khác.
- Bước máy có công việc ĐÃ bắt đầu (đang chạy/tạm dừng/xong): từ chối đổi tổ hoặc máy, câu lỗi
  "Việc đã bắt đầu ở bàn tổ — đổi máy ở bàn tổ". Chi tiết lệnh gửi cờ `da_bat_dau` từng bước để
  ngăn bước khoá sẵn ô tổ/máy và hiện đúng câu đó (23/10/2026), khỏi chọn xong mới ăn lỗi lúc Lưu.

### 4.8 Phát hành và phát hành cập nhật

- Phát hành lần đầu (`snapshot.py:416-417`) chép tổ + máy từ bước — đúng nếu bước đúng.
- **Lỗ đang có (đã kiểm):** "Phát hành cập nhật" hôm nay KHÔNG đưa máy lẫn tổ xuống công việc, ở mọi
  bước. Máy lấy từ `_lich_nguon` (`release_update.py:87`); lệnh xếp ở bàn Xếp lịch cấp lệnh không có
  dòng `xep_lich_cong_doan` nên nhánh dự phòng trả `may_id=None` (`:104`) ⇒ `if may_id is not None`
  (`:388`) không bao giờ đúng. `department_id` không có dòng nào chép.
- Không trái với ảnh chụp: đây là khi NGƯỜI KẾ HOẠCH sửa tổ/máy trong bước của lệnh rồi bấm cập
  nhật (lệnh đổi), không phải danh mục đổi.
- Sửa: công việc CHƯA bắt đầu của bước máy ⇒ chép cả `department_id` lẫn `may_id` từ bước kế hoạch
  (`lsx_cong_doan` / `bai_ghep_cong_doan`). Việc đổi tổ ⇒ rời bàn tổ cũ, sang bàn tổ mới, đẩy SSE cho
  cả hai bàn. Việc đã bắt đầu không đổi (đã chặn từ lúc lưu bước, §4.7). Việc gia công ngoài giữ
  nguyên như hôm nay.

### 4.9 Bàn tổ — "Đổi máy"

- `may_doi_duoc` (`thuc_thi.py:469`): chỉ mời máy của công đoạn thuộc tổ của việc
  (`cv.department_id`), bỏ máy đang gán, kèm "cũng thuộc…". Không còn máy nào ⇒ hộp hiện "Tổ không
  còn máy khác chạy công đoạn này. Việc chờ máy sửa xong." (luật 7).
- `doi_may` (`thuc_thi.py:504`): máy mới không hợp lệ theo §4.5 ⇒ 400. Hôm nay hàm này không kiểm
  công đoạn lẫn tổ.

### 4.10 Dữ liệu đang có

- Migration chỉ tạo bảng `may_to`; KHÔNG điền tổ cho máy, KHÔNG sửa lệnh/công việc, KHÔNG xoá dòng
  `cong_doan_may`.
- Ngay sau migration mọi máy chưa thuộc tổ nào ⇒ mọi công đoạn chưa có máy, phiếu tính giá chưa mời
  máy in nào. Người dùng điền "Tổ đứng máy" cho máy ở màn Thiết bị (dev: 5 máy in theo tên —
  IN-01 → 2 màu, IN-02 → 4 màu, IN-03 → 5 màu, IN-04 → 6 màu, IN-06 → 7 màu; máy bế, dán, cán… do
  chủ xưởng chỉ). Điền xong, dòng `cong_doan_may` cũ hiện lại với số cũ.
- Bước đang lệch (như LSX26-0003) hiện cảnh báo ở băng "Danh mục đã đổi" — thêm nhánh vào
  `_soi_danh_muc` cạnh `may_canh_bao` (`lsx_service.py:3113`): "Máy <mã> không thuộc <tổ>". Không tự
  sửa.
- Prod DB trắng ⇒ không có dữ liệu cũ phải lo.
- Seed (`seed_rebuild.py`, `import_danh_muc_prod.py`) vẫn ghi `nhom_may_cho_phep` — cột còn, không ai
  đọc, vô hại; không khai `may_to` (người dùng tự khai).

## 5. Kiểm chứng

Test backend (pytest nhắm file):
- Máy của công đoạn = hợp máy các tổ đã tick; máy chung hai tổ hiện một dòng; bỏ tick tổ rồi tick
  lại ⇒ số cách đo giờ / cách tính giá còn nguyên.
- Tạo lệnh từ phiếu chọn IN-02 (thuộc nhóm 4 màu) ⇒ bước In nhóm 4 màu. Máy thuộc 2 tổ ⇒ ưu tiên
  tổ mặc định, rồi tổ đầu theo thứ tự.
- `replace_routing` / `lap_ke_hoach_buoc_chung` từ chối cặp lệch; lệnh cũ lệch vẫn lưu được khi chỉ
  sửa ô khác; từ chối đổi tổ/máy khi việc đã bắt đầu.
- Phát hành cập nhật: đổi tổ+máy bước ⇒ việc chưa bắt đầu đổi cả hai.
- `may_doi_duoc` chỉ trả máy cùng tổ; `doi_may` sang máy tổ khác ⇒ 400.
- Gỡ tổ khỏi máy ⇒ lệnh và công việc đang có KHÔNG đổi; bước lệch hiện cảnh báo.
- Guard DB_SCHEMA xanh.

Bấm thử UI trên dev-browser (bắt buộc theo CLAUDE.md), ghi rõ từng bước:
khai "Tổ đứng máy" cho IN-01 (2 màu), IN-02 (4 màu + 5 màu) → mở công đoạn In, thấy bảng máy theo
tổ, không còn dải nhóm máy và nút chọn máy; bỏ tick nhóm 4 màu thì IN-02 vẫn còn (vì thuộc 5 màu),
bỏ thêm 5 màu thì IN-02 rụng; tick lại thấy số cũ → tạo lệnh từ phiếu máy IN-02 ⇒ bước In về nhóm 4
màu → trong drawer đổi tổ sang 2 màu, máy nhảy về IN-01, ô máy chỉ còn máy 2 màu → phát hành → bàn
tổ 4 màu không thấy việc, bàn tổ 2 màu thấy → bắt đầu → Đổi máy chỉ mời máy của nhóm 2 màu (hoặc báo
không còn máy khác).

## 6. Để builder tự quyết

- Tên hàm, nơi đặt (service), hình dạng payload `to_ids`.
- Câu chữ cảnh báo, miễn nói rõ máy nào, tổ nào.
- Cách gom đổi FE cho `MayCuaCongDoan.tsx` (sửa tại chỗ hay tách bảng chỉ đọc + ô sửa).

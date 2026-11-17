# Gia công ngoài cho bước chung của bài ghép (đợt 2) — Thiết kế

> **Đã thay bằng `2026-11-13-module-gia-cong-ngoai-design.md`** (module Thuê gia công, bảng `tgc_*`, 13/11/2026). Bảng `gia_cong_ngoai` gỡ ở mg `0481`, cột nhà gia công trên bước gỡ ở mg `0483`. Giữ file này để đọc lịch sử.

**Ngày:** 27/09/2026 · **Trạng thái:** chờ chủ duyệt
**Nối tiếp:** `2026-09-26-gia-cong-ngoai-design.md` §9 — "cùng cơ chế, lần gia công gắn bài ghép
thay vì lệnh; khi làm thì gỡ luôn tab Gia công ngoài cũ của bước chung".

Một câu: **bước chung thuê ngoài của bài ghép cũng là một LẦN GIA CÔNG như đợt 1 — mang đi tờ
ghép, chốt MỘT con số tờ ghép; lúc chốt phần mềm tự chia ra từng lệnh theo số con trên tờ.**

## 1. Hiện trạng (vì sao chưa chạy được)

- Bước chung (`bai_ghep_cong_doan`) chỉ có ô chữ `nha_cung_cap` tự gõ, không chọn được nhà gia
  công trong danh mục; tab "Gia công ngoài" cũ còn các ô ngày dự kiến / hao hụt cho phép / yêu cầu
  kỹ thuật mà đợt 1 đã bỏ.
- Lúc phát hành, công việc của bước chung mang `lsx_id = NULL, bai_ghep_id = …`; hàm gom lần gia
  công bỏ qua mọi bước bị bài ghép phủ ⇒ không sinh lần ⇒ không có nút mang đi / chốt / phiếu chi.
- `gia_cong_ngoai.lsx_id` NOT NULL — lần gia công chỉ biết thuộc MỘT lệnh.
- Lỗi ngầm phát hiện khi khảo sát: lúc **phát hành cập nhật**, `dong_bo_lan_khi_cap_nhat` chỉ nhìn
  công việc có `lsx_id` của lệnh nên bước lệnh thuê ngoài bị bài ghép phủ có thể bị gom thành lần
  rỗng hoặc báo "thiếu nhà gia công". Sửa cùng đợt này.

## 2. Luồng — ví dụ

Bài ghép BG-01 gồm LSX-A (4 con/tờ) và LSX-B (2 con/tờ). Bước chung: In (xưởng) → Cán màng (thuê
ngoài, Tân Phát). Sau đó mỗi lệnh có bước riêng: Bế → KCS.

1. **Lập kế hoạch bài ghép:** ở bước chung Cán màng, loại bước "Thuê ngoài", chọn nhà gia công từ
   danh sách (chỉ NCC tích "Nhận gia công"). Thiếu nhà gia công ⇒ bài ghép "Còn thiếu" không sẵn
   sàng được.
2. **Phát hành:** sinh một lần gia công gắn **bài ghép BG-01** (không gắn lệnh), trạng thái *chờ
   mang đi*.
3. **In chung** ghi mẻ 1.000 tờ, bàn giao sang Cán màng ⇒ lần gia công hiện "chờ mang đi 1.000
   tờ" (y như đợt 1, toast tới người lập kế hoạch).
4. **Mang đi** 1.000 tờ (cho phép nhiều đợt, như đợt 1).
5. **Chốt** 980 tờ. Phần mềm chia: LSX-A nhận 980 × 4 = **3.920 con** ở Bế, LSX-B nhận 980 × 2 =
   **1.960 con** ở Bế. Hộp chốt hiện sẵn bảng chia này trước khi bấm để người chốt thấy.
6. Mỗi lệnh đi tiếp bước riêng như thường. **Phiếu chi** lập theo lần: "Cán màng — Tân Phát —
   BG-01 (LSX-A, LSX-B)", số tiền kế toán tự gõ (không ô đơn giá, theo chốt 27/09).

## 3. Luật

**Gộp dải.** Các bước CHUNG thuê ngoài liền nhau, cùng nhà gia công ⇒ một lần (gửi tờ của bước
đầu, nhận sản phẩm bước cuối). Bước chung và bước riêng **không** gộp chung một lần — hai phạm vi
khác nhau, là hai lần.

**Chốt rẽ ba nhánh theo cái đứng sau lần gia công:**

| Sau lần gia công | Chốt làm gì |
|---|---|
| còn bước chung | một bàn giao sang công việc chung kế tiếp (y đợt 1 `_ve_xuong`) |
| tới bước riêng từng lệnh (điểm toả) | **toả**: mỗi lệnh nhận `số chốt × so_con_tren_to`, dùng lại đúng đường toả sẵn có của In chung (`_toa_san_luong`) — không viết lối chia mới |
| hết bước (bước chung là bước cuối của mọi lệnh) | nhập kho thành phẩm **từng lệnh** theo số đã toả; quy đổi sang đơn vị món như đợt 1 |

**Không có nhánh "giao thẳng cho khách"** cho bài ghép: các lệnh thường thuộc nhiều đơn/khách. Muốn
giao thẳng thì đừng ghép.

**Mang đi.** Có bước chung đứng trước ⇒ chờ bàn giao như đợt 1. Bước chung thuê ngoài đứng đầu bài
(hiếm) ⇒ tự gõ số tờ mang đi.

**Mở lại lần đã chốt.** Như đợt 1 (chặn khi đã có phiếu chi / kho đã lập phiếu), thêm: chặn nếu
**bất kỳ lệnh nào** đã ghi mẻ ở bước nhận phần toả — nêu tên lệnh trong lý do khoá. Không chặn thì
mở lại gỡ sạch phần đã toả của mọi lệnh rồi cho chốt lại.

**Thu hồi phát hành / huỷ.** Không đổi: theo gói phát hành; lần đã mang đi thì chặn thu hồi.

**Trọn gói.** Vẫn chặn lệnh trong bài ghép (không đổi).

## 4. Hiện ở đâu

- **Màn bài ghép:** khối "Gia công ngoài" (tái dùng panel của lệnh, nguồn = bài ghép) với đủ nút
  mang đi / chốt / mở lại.
- **Màn từng lệnh thành viên:** một dòng chỉ đọc "Cán màng đi chung bài ghép BG-01 — Tân Phát —
  đang ở ngoài", bấm sang bài ghép. Không thao tác ở đây để khỏi hai chỗ bấm một việc.
- **Lọc KHSX "Gia công ngoài"** bắt cả lệnh có lần qua bài ghép.
- **Phiếu chi / hàng "Gia công chờ chi":** nhãn bài ghép + danh sách mã lệnh.
- **Real-time:** đổi trạng thái lần ⇒ đẩy tới người xem bài ghép và cả từng lệnh thành viên.

## 5. Quyền

Thao tác lần gia công của bài ghép cần cùng quyền như lần của lệnh **và** phạm vi trên **mọi** lệnh
thành viên (người chỉ có "lệnh của mình" mà bài ghép có lệnh của người khác ⇒ chỉ xem). Tiền gia
công không gác `kho:view_cost` (chốt 27/09).

## 6. Dữ liệu

- `gia_cong_ngoai`: `lsx_id` thành nullable; thêm `bai_ghep_id` (FK `bai_ghep`, RESTRICT); CHECK
  đúng một trong hai có giá trị. Không thêm bảng phân bổ — phần chia từng lệnh đã nằm ở bàn giao /
  kết quả toả sẵn có.
- `bai_ghep_cong_doan`: thêm `nha_cung_cap_id` (FK `suppliers`); cột chữ `nha_cung_cap` giữ làm tên
  do máy chủ ghi (y `lsx_cong_doan`). Gỡ các cột dự kiến cũ (ngày gửi/nhận, vận chuyển/gia công
  ngày, hao hụt cho phép, sl_gui, đơn giá, yêu cầu kỹ thuật) khỏi schema sửa và UI; cột DB bỏ theo
  đúng cách đợt 1 đã xử lý bước lệnh.
- `gop()` bước chung chép `nha_cung_cap_id` từ bước mẫu nếu mọi bước gộp cùng một nhà gia công.
- Migration trong `db_migrations.py`, cập nhật `docs/DB_SCHEMA.md`.

## 7. Không làm

Trọn gói cho bài ghép · giao thẳng từ bài ghép · một lần gộp cả bước chung lẫn bước riêng · chia
tiền phiếu chi theo lệnh (phiếu chi một số cho cả lần).

## 8. Ruling đã tự chốt (sai thì đổi trước khi làm)

1. **Chốt tính theo TỜ ghép, phần mềm tự nhân ra con từng lệnh** — vì nhà gia công trả về tờ đã cán
   chưa cắt; sai (họ trả về đã cắt, đếm theo từng mã) thì phải thêm ô số riêng từng lệnh lúc chốt.
2. **Thao tác chỉ ở màn bài ghép** — tránh hai người bấm hai nơi; sai thì thêm nút trên màn lệnh.
3. **Bỏ giao thẳng** — tốn một nhánh chỉ để phục vụ trường hợp mọi lệnh cùng một dòng đơn.

## 9. Kiểm thử

Test nhắm file cho: gom dải bước chung; chốt toả đúng số (ví dụ §2: 3.920 / 1.960); chốt về bước
chung kế; bước chung cuối ⇒ nhập kho từng lệnh; mở lại bị chặn khi một lệnh đã ghi mẻ; phát hành
cập nhật không sinh lần rỗng. E2E trên UI: dựng bài ghép 2 lệnh từ đơn hàng → phát hành → In chung →
mang đi → chốt → Bế từng lệnh → KCS → nhập kho → giao → phiếu chi.
